//! # Nova Compute kernel
//!
//! Computes one *chunk* of a Monte Carlo neutron-transport simulation (particles fired
//! into a 2D slab) and returns the tallies plus a SHA-256 hash of them.
//!
//! The same code runs natively (in the coordinator) and in browsers via WebAssembly,
//! and must produce **bit-identical** results everywhere, so two honest workers that
//! compute the same chunk always produce the same hash. To guarantee that:
//!
//! * all transcendental math goes through the pure-Rust [`libm`] crate, never
//!   `f64::ln/cos/sin` (those call the platform's math library);
//! * uniform numbers are built directly from `next_u64()` bits, never from `rand`
//!   distributions (whose algorithms may change between versions);
//! * there is exactly one sequential ChaCha8 stream per chunk, no threads, no time,
//!   no hash-map iteration and no reductions in varying order.
//!
//! Only basic IEEE-754 operations (+ − × ÷, comparisons, `as` casts) and `libm` are
//! used on `f64`, and Rust never fuses multiply-adds implicitly, so results match on
//! x86-64, ARM and wasm32.

#![forbid(unsafe_code)]

use core::f64::consts::PI;
use core::fmt;

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub mod templates;
mod wasm;
pub use wasm::{Simulator, TemplateSimulator};

/// The chunk hash every template shares: `sha256(job_id ‖ index u32 BE ‖ output_bytes)`, hex.
pub fn chunk_hash(job_id: &[u8; 32], index: u32, output: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(job_id);
    h.update(index.to_be_bytes());
    h.update(output);
    to_hex(&h.finalize())
}

/// Number of bins in the collision-depth histogram over `[0, L)`.
pub const HIST_BINS: usize = 64;
/// Maximum collisions per particle; particles that reach it count as absorbed.
pub const MAX_STEPS: u32 = 1000;
/// Particles per `step()` call whose paths are recorded for drawing.
pub const SAMPLES_PER_STEP: usize = 2;

/// Physics parameters of a job.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Params {
    /// Slab thickness L, in cm.
    pub thickness_cm: f64,
    /// Mean free path between collisions, in cm.
    pub mfp_cm: f64,
    /// Probability that a collision absorbs the particle, in `[0, 1]`.
    pub absorb_prob: f64,
}

impl Params {
    pub fn validate(&self) -> Result<(), KernelError> {
        let finite = self.thickness_cm.is_finite() && self.mfp_cm.is_finite() && self.absorb_prob.is_finite();
        if !finite {
            return Err(KernelError::InvalidParams("parameters must be finite numbers"));
        }
        if self.thickness_cm <= 0.0 {
            return Err(KernelError::InvalidParams("thickness_cm must be > 0"));
        }
        if self.mfp_cm <= 0.0 {
            return Err(KernelError::InvalidParams("mfp_cm must be > 0"));
        }
        if !(0.0..=1.0).contains(&self.absorb_prob) {
            return Err(KernelError::InvalidParams("absorb_prob must be in [0, 1]"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KernelError {
    InvalidParams(&'static str),
    InvalidHex(&'static str),
}

impl fmt::Display for KernelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KernelError::InvalidParams(m) => write!(f, "invalid params: {m}"),
            KernelError::InvalidHex(m) => write!(f, "invalid hex: {m}"),
        }
    }
}

impl std::error::Error for KernelError {}

/// What happened to a particle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fate {
    Transmitted,
    Reflected,
    Absorbed,
}

/// Path of one sampled particle in cm, starting at (0, 0). For drawing only.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub fate: Fate,
    pub pts: Vec<[f64; 2]>,
}

/// Running tallies after a `step()`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    pub done: u32,
    pub transmitted: u32,
    pub reflected: u32,
    pub absorbed: u32,
    pub sample_tracks: Vec<Track>,
}

/// Final result of a chunk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkResult {
    pub transmitted: u32,
    pub reflected: u32,
    pub absorbed: u32,
    /// Collision-depth histogram, `HIST_BINS` bins over `[0, L)`.
    pub histogram: Vec<u32>,
    /// Lower-case hex SHA-256 of `job_id ‖ index (u32 BE) ‖ output_bytes`.
    pub hash: String,
}

/// `sha256(master_seed ‖ index as u32 big-endian)`: the 32-byte ChaCha8 seed of a chunk.
pub fn chunk_seed(master_seed: &[u8], index: u32) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(master_seed);
    h.update(index.to_be_bytes());
    h.finalize().into()
}

/// Uniform `f64` in `[0, 1)` from the top 53 bits of one `u64`.
#[inline]
pub(crate) fn uniform(rng: &mut ChaCha8Rng) -> f64 {
    (rng.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0)
}

/// A chunk being computed. Advance it with [`Chunk::step`] in any batch sizes; the
/// result never depends on the batching or on which particles record their paths.
#[derive(Clone)]
pub struct Chunk {
    params: Params,
    rng: ChaCha8Rng,
    job_id: [u8; 32],
    index: u32,
    trials: u32,
    done: u32,
    transmitted: u32,
    reflected: u32,
    absorbed: u32,
    histogram: [u32; HIST_BINS],
}

impl Chunk {
    pub fn new(params: Params, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<Self, KernelError> {
        params.validate()?;
        Ok(Chunk {
            params,
            rng: ChaCha8Rng::from_seed(chunk_seed(master_seed, index)),
            job_id,
            index,
            trials,
            done: 0,
            transmitted: 0,
            reflected: 0,
            absorbed: 0,
            histogram: [0; HIST_BINS],
        })
    }

    pub fn done(&self) -> u32 {
        self.done
    }

    pub fn trials(&self) -> u32 {
        self.trials
    }

    pub fn is_done(&self) -> bool {
        self.done >= self.trials
    }

    /// Simulates up to `n` more particles; the first `samples` of them record their paths.
    pub fn step(&mut self, n: u32, samples: usize) -> Progress {
        let todo = n.min(self.trials - self.done);
        let mut sample_tracks = Vec::new();
        for i in 0..todo {
            let record = (i as usize) < samples;
            let (fate, pts) = self.particle(record);
            if record {
                sample_tracks.push(Track { fate, pts });
            }
        }
        Progress {
            done: self.done,
            transmitted: self.transmitted,
            reflected: self.reflected,
            absorbed: self.absorbed,
            sample_tracks,
        }
    }

    /// Runs any remaining particles and returns the hashed result.
    pub fn finish(&mut self) -> ChunkResult {
        while !self.is_done() {
            self.step(u32::MAX, 0);
        }
        ChunkResult {
            transmitted: self.transmitted,
            reflected: self.reflected,
            absorbed: self.absorbed,
            histogram: self.histogram.to_vec(),
            hash: chunk_hash(&self.job_id, self.index, &self.output_bytes()),
        }
    }

    /// Canonical output: u32 LE transmitted, reflected, absorbed, then `HIST_BINS` × u32 LE bins.
    pub fn output_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 * (3 + HIST_BINS));
        for v in [self.transmitted, self.reflected, self.absorbed] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        for v in self.histogram {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Transports one particle. `record` only adds drawing points; it never changes how
    /// the RNG is consumed (the y coordinate is tracked for drawing only).
    fn particle(&mut self, record: bool) -> (Fate, Vec<[f64; 2]>) {
        let l = self.params.thickness_cm;
        let mfp = self.params.mfp_cm;
        let absorb = self.params.absorb_prob;
        let rng = &mut self.rng;

        let mut x = 0.0_f64;
        let mut y = 0.0_f64;
        let mut theta = (uniform(rng) - 0.5) * PI * 0.9; // toward +x
        let mut pts = if record { vec![[0.0, 0.0]] } else { Vec::new() };
        let mut fate = Fate::Absorbed; // also the outcome after MAX_STEPS

        for _ in 0..MAX_STEPS {
            let d = -libm::log(1.0 - uniform(rng)) * mfp;
            let nx = x + libm::cos(theta) * d;
            if nx >= l {
                if record {
                    let f = (l - x) / (nx - x);
                    pts.push([l, y + libm::sin(theta) * d * f]);
                }
                fate = Fate::Transmitted;
                break;
            }
            if nx <= 0.0 {
                if record {
                    let f = -x / (nx - x);
                    pts.push([0.0, y + libm::sin(theta) * d * f]);
                }
                fate = Fate::Reflected;
                break;
            }
            if record {
                y += libm::sin(theta) * d;
                pts.push([nx, y]);
            }
            x = nx;
            // 0 < x < L here, so the bin is in range; min() guards rounding at the top edge.
            let bin = ((x * HIST_BINS as f64) / l) as usize;
            let slot = &mut self.histogram[bin.min(HIST_BINS - 1)];
            *slot = slot.wrapping_add(1);
            if uniform(rng) < absorb {
                break;
            }
            theta = uniform(rng) * 2.0 * PI;
        }

        self.done += 1;
        match fate {
            Fate::Transmitted => self.transmitted += 1,
            Fate::Reflected => self.reflected += 1,
            Fate::Absorbed => self.absorbed += 1,
        }
        (fate, pts)
    }
}

/// Computes a whole chunk in one call.
///
/// # Panics
/// If `params` are invalid (see [`Params::validate`]). Use [`try_run_chunk`] to get an error instead.
pub fn run_chunk(params: Params, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> ChunkResult {
    try_run_chunk(params, job_id, master_seed, index, trials).expect("invalid kernel params")
}

/// Like [`run_chunk`], but returns an error for invalid params.
pub fn try_run_chunk(params: Params, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<ChunkResult, KernelError> {
    Ok(Chunk::new(params, job_id, master_seed, index, trials)?.finish())
}

pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Result<Vec<u8>, KernelError> {
    fn nibble(c: u8) -> Result<u8, KernelError> {
        match c {
            b'0'..=b'9' => Ok(c - b'0'),
            b'a'..=b'f' => Ok(c - b'a' + 10),
            b'A'..=b'F' => Ok(c - b'A' + 10),
            _ => Err(KernelError::InvalidHex("non-hex character")),
        }
    }
    let b = s.as_bytes();
    if b.len() % 2 != 0 {
        return Err(KernelError::InvalidHex("odd length"));
    }
    b.chunks_exact(2).map(|p| Ok((nibble(p[0])? << 4) | nibble(p[1])?)).collect()
}
