//! 2D Ising model, one temperature per chunk.
//!
//! Periodic L×L lattice of ±1 spins, all +1 at the start. Metropolis updates in sequential
//! row-major site order: ΔE = 2·s·(sum of the 4 neighbours) ∈ {−8,−4,0,4,8}; the spin flips if
//! ΔE ≤ 0, else if u < exp(−ΔE/T) with p4 = libm::exp(−4/T), p8 = libm::exp(−8/T) precomputed.
//! A uniform u is drawn ONLY when ΔE > 0. eq_sweeps equilibration sweeps, then `trials`
//! (= meas_sweeps) measurement sweeps; after each, |m| and e per spin and their squares are
//! accumulated in that fixed order.
//!
//! T_i = t_min + i·(t_max − t_min)/(n_temps − 1)   (T_0 = t_min when n_temps = 1)
//!
//! Output bytes (LE): f64 bits of T, ⟨|m|⟩, ⟨e⟩, χ = N(⟨m²⟩ − ⟨|m|⟩²)/T, C = N(⟨e²⟩ − ⟨e⟩²)/T²,
//! then the final lattice as L·L bits row-major (bit = 1 for +1), LSB-first within each byte.

use rand_chacha::ChaCha8Rng;
use rand_core::SeedableRng;
use serde_json::{Value, json};

use super::{TemplateOutput, f64_at, hex, int, num};
use crate::{KernelError, chunk_hash, chunk_seed, uniform};

#[derive(Clone, Debug, PartialEq)]
pub struct IsingParams {
    pub l: u32,
    pub t_min: f64,
    pub t_max: f64,
    pub n_temps: u32,
    pub eq_sweeps: u32,
    pub meas_sweeps: u32,
}

impl IsingParams {
    pub fn from_value(v: &Value) -> Result<Self, KernelError> {
        if !v.is_object() {
            return Err(KernelError::InvalidParams("params must be a JSON object"));
        }
        let p = IsingParams {
            l: int(v, "L", 32, 16, 64, "L must be an integer in 16..=64")?,
            t_min: num(v, "t_min", 1.5)?,
            t_max: num(v, "t_max", 3.5)?,
            n_temps: int(v, "n_temps", 1, 1, 1024, "n_temps must be an integer in 1..=1024")?,
            eq_sweeps: int(v, "eq_sweeps", 1000, 0, 1_000_000, "eq_sweeps must be an integer in 0..=1,000,000")?,
            meas_sweeps: int(v, "meas_sweeps", 2000, 1, 1_000_000, "meas_sweeps must be an integer in 1..=1,000,000")?,
        };
        if !(p.t_min > 0.0 && p.t_max >= p.t_min && p.t_max <= 100.0) {
            return Err(KernelError::InvalidParams("temperatures must satisfy 0 < t_min <= t_max <= 100"));
        }
        Ok(p)
    }

    pub fn to_value(&self) -> Value {
        json!({ "L": self.l, "t_min": self.t_min, "t_max": self.t_max, "n_temps": self.n_temps, "eq_sweeps": self.eq_sweeps, "meas_sweeps": self.meas_sweeps })
    }

    pub fn temperature(&self, index: u32) -> f64 {
        if self.n_temps <= 1 { self.t_min } else { self.t_min + index as f64 * (self.t_max - self.t_min) / (self.n_temps - 1) as f64 }
    }

    pub fn output_len(&self) -> usize {
        5 * 8 + ((self.l * self.l) as usize).div_ceil(8)
    }
}

pub struct IsingChunk {
    p: IsingParams,
    l: usize,
    t: f64,
    p4: f64,
    p8: f64,
    spins: Vec<i8>,
    rng: ChaCha8Rng,
    job_id: [u8; 32],
    index: u32,
    meas: u32,
    sweeps: u32,
    m: i64,
    e: i64,
    sum_abs_m: f64,
    sum_m2: f64,
    sum_e: f64,
    sum_e2: f64,
}

impl IsingChunk {
    pub fn new(p: IsingParams, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<Self, KernelError> {
        if index >= p.n_temps {
            return Err(KernelError::InvalidParams("chunk index must be < n_temps"));
        }
        if trials == 0 {
            return Err(KernelError::InvalidParams("trials (measurement sweeps) must be >= 1"));
        }
        let l = p.l as usize;
        let n = (l * l) as i64;
        let t = p.temperature(index);
        Ok(IsingChunk {
            l,
            t,
            p4: libm::exp(-4.0 / t),
            p8: libm::exp(-8.0 / t),
            spins: vec![1; l * l],
            rng: ChaCha8Rng::from_seed(chunk_seed(master_seed, index)),
            job_id,
            index,
            meas: trials,
            sweeps: 0,
            m: n,
            e: -2 * n,
            sum_abs_m: 0.0,
            sum_m2: 0.0,
            sum_e: 0.0,
            sum_e2: 0.0,
            p,
        })
    }

    pub fn done(&self) -> u32 {
        self.sweeps
    }

    pub fn total(&self) -> u32 {
        self.p.eq_sweeps + self.meas
    }

    pub fn temperature(&self) -> f64 {
        self.t
    }

    fn sweep(&mut self) {
        let l = self.l;
        for r in 0..l {
            let up = ((r + l - 1) % l) * l;
            let down = ((r + 1) % l) * l;
            let row = r * l;
            for c in 0..l {
                let left = (c + l - 1) % l;
                let right = (c + 1) % l;
                let i = row + c;
                let s = self.spins[i] as i32;
                let nb = self.spins[up + c] as i32 + self.spins[down + c] as i32 + self.spins[row + left] as i32 + self.spins[row + right] as i32;
                let de = 2 * s * nb;
                let flip = if de <= 0 { true } else { uniform(&mut self.rng) < if de == 4 { self.p4 } else { self.p8 } };
                if flip {
                    self.spins[i] = -self.spins[i];
                    self.m -= 2 * s as i64;
                    self.e += de as i64;
                }
            }
        }
        self.sweeps += 1;
        if self.sweeps > self.p.eq_sweeps {
            let n = (l * l) as f64;
            let am = self.m.unsigned_abs() as f64 / n;
            let es = self.e as f64 / n;
            self.sum_abs_m += am;
            self.sum_m2 += am * am;
            self.sum_e += es;
            self.sum_e2 += es * es;
        }
    }

    /// Lattice as L·L bits row-major (1 = +1), LSB-first per byte.
    pub fn packed_lattice(&self) -> Vec<u8> {
        let mut out = vec![0u8; self.spins.len().div_ceil(8)];
        for (i, s) in self.spins.iter().enumerate() {
            if *s > 0 {
                out[i / 8] |= 1 << (i % 8);
            }
        }
        out
    }

    /// Runs up to `n` sweeps. Progress: { done, total, phase, temperature, abs_m, mean_abs_m, lattice }.
    pub fn step(&mut self, n: u32) -> Value {
        let end = self.total().min(self.sweeps.saturating_add(n));
        while self.sweeps < end {
            self.sweep();
        }
        let nsites = (self.l * self.l) as f64;
        let measured = self.sweeps.saturating_sub(self.p.eq_sweeps);
        json!({
            "done": self.sweeps,
            "total": self.total(),
            "phase": if self.sweeps < self.p.eq_sweeps { "equilibrating" } else { "measuring" },
            "temperature": self.t,
            "abs_m": self.m.unsigned_abs() as f64 / nsites,
            "mean_abs_m": if measured > 0 { Value::from(self.sum_abs_m / measured as f64) } else { Value::Null },
            "L": self.l,
            "lattice": hex(&self.packed_lattice()),
        })
    }

    pub fn output_bytes(&self) -> Vec<u8> {
        let n = (self.l * self.l) as f64;
        let k = self.meas as f64;
        let (am, m2, e, e2) = (self.sum_abs_m / k, self.sum_m2 / k, self.sum_e / k, self.sum_e2 / k);
        let chi = n * (m2 - am * am) / self.t;
        let c = n * (e2 - e * e) / (self.t * self.t);
        let mut out = Vec::with_capacity(self.p.output_len());
        for v in [self.t, am, e, chi, c] {
            out.extend_from_slice(&v.to_bits().to_le_bytes());
        }
        out.extend(self.packed_lattice());
        out
    }

    pub fn finish(&mut self) -> TemplateOutput {
        while self.sweeps < self.total() {
            self.sweep();
        }
        let output = self.output_bytes();
        TemplateOutput { hash: chunk_hash(&self.job_id, self.index, &output), output }
    }
}

pub fn decode(p: &IsingParams, b: &[u8]) -> Result<Value, KernelError> {
    if b.len() != p.output_len() {
        return Err(KernelError::InvalidParams("Ising output has the wrong length"));
    }
    Ok(json!({
        "temperature": f64_at(b, 0),
        "abs_m": f64_at(b, 8),
        "e": f64_at(b, 16),
        "chi": f64_at(b, 24),
        "c": f64_at(b, 32),
        "L": p.l,
        "lattice": hex(&b[40..]),
    }))
}
