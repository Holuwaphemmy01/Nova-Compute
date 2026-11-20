//! Simulation templates. Every template computes one *chunk* deterministically from
//! `ChaCha8Rng::from_seed(chunk_seed(master_seed, index))` and hashes its canonical output
//! bytes with the shared [`crate::chunk_hash`]: `sha256(job_id ‖ index u32 BE ‖ output_bytes)`.
//! The template itself is not in the hash; it is bound through the job (job_id / config_hash).
//!
//! Same determinism rules everywhere: f64 transcendental maths only via `libm`, uniforms from
//! `next_u64() >> 11`, one sequential RNG stream per chunk, no threads, no hash-map iteration,
//! f64 outputs encoded as IEEE-754 bits, little-endian.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Chunk, KernelError, Params, chunk_hash, to_hex};

pub mod ising;
pub mod sir;

pub use ising::{IsingChunk, IsingParams};
pub use sir::{SirChunk, SirParams};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Template {
    #[serde(rename = "neutron_slab")]
    NeutronSlab,
    #[serde(rename = "ising_2d")]
    Ising2D,
    #[serde(rename = "sir_epidemic")]
    SirEpidemic,
}

impl Template {
    pub fn parse(s: &str) -> Result<Self, KernelError> {
        match s {
            "neutron_slab" => Ok(Template::NeutronSlab),
            "ising_2d" => Ok(Template::Ising2D),
            "sir_epidemic" => Ok(Template::SirEpidemic),
            _ => Err(KernelError::InvalidParams("unknown template (neutron_slab, ising_2d, sir_epidemic)")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Template::NeutronSlab => "neutron_slab",
            Template::Ising2D => "ising_2d",
            Template::SirEpidemic => "sir_epidemic",
        }
    }
}

/// Validated, defaults-filled parameters for a job and the `trials` value of each chunk.
#[derive(Clone, Debug, PartialEq)]
pub struct JobSpec {
    pub params: Value,
    /// Trials per chunk derived from the params (Ising: meas_sweeps, SIR: runs_per_chunk);
    /// `None` for the neutron template, whose trials are chosen by the job.
    pub trials: Option<u32>,
}

/// Validates template params for a job of `chunks` chunks and fills in defaults.
/// For Ising, `n_temps` is the chunk count.
pub fn job_spec(t: Template, params: &Value, chunks: u32) -> Result<JobSpec, KernelError> {
    match t {
        Template::NeutronSlab => {
            let p: Params = serde_json::from_value(params.clone()).map_err(|_| KernelError::InvalidParams("expected { thickness_cm, mfp_cm, absorb_prob }"))?;
            p.validate()?;
            Ok(JobSpec { params: serde_json::to_value(p).unwrap(), trials: None })
        }
        Template::Ising2D => {
            let mut v = params.clone();
            if let Some(o) = v.as_object_mut() {
                o.insert("n_temps".into(), json!(chunks));
            }
            let p = IsingParams::from_value(&v)?;
            Ok(JobSpec { trials: Some(p.meas_sweeps), params: p.to_value() })
        }
        Template::SirEpidemic => {
            let p = SirParams::from_value(params)?;
            Ok(JobSpec { trials: Some(p.runs_per_chunk), params: p.to_value() })
        }
    }
}

/// A chunk of any template, advanced in batches. Batching never changes the result.
pub enum Runner {
    Neutron(Box<Chunk>),
    Ising(Box<IsingChunk>),
    Sir(Box<SirChunk>),
}

/// Final output of a chunk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateOutput {
    pub hash: String,
    pub output: Vec<u8>,
}

impl Runner {
    pub fn new(t: Template, params: &Value, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<Self, KernelError> {
        Ok(match t {
            Template::NeutronSlab => {
                let p: Params = serde_json::from_value(params.clone()).map_err(|_| KernelError::InvalidParams("expected { thickness_cm, mfp_cm, absorb_prob }"))?;
                Runner::Neutron(Box::new(Chunk::new(p, job_id, master_seed, index, trials)?))
            }
            Template::Ising2D => Runner::Ising(Box::new(IsingChunk::new(IsingParams::from_value(params)?, job_id, master_seed, index, trials)?)),
            Template::SirEpidemic => Runner::Sir(Box::new(SirChunk::new(SirParams::from_value(params)?, job_id, master_seed, index, trials)?)),
        })
    }

    /// Units of work done / total (neutron: particles, Ising: sweeps, SIR: outbreaks).
    pub fn done(&self) -> u32 {
        match self {
            Runner::Neutron(c) => c.done(),
            Runner::Ising(c) => c.done(),
            Runner::Sir(c) => c.done(),
        }
    }

    pub fn total(&self) -> u32 {
        match self {
            Runner::Neutron(c) => c.trials(),
            Runner::Ising(c) => c.total(),
            Runner::Sir(c) => c.total(),
        }
    }

    pub fn is_done(&self) -> bool {
        self.done() >= self.total()
    }

    /// Advances up to `n` units; returns a JSON progress snapshot for display. Recording display
    /// data never changes how the RNG is consumed.
    pub fn step(&mut self, n: u32, samples: usize) -> Value {
        match self {
            Runner::Neutron(c) => serde_json::to_value(c.step(n, samples)).unwrap(),
            Runner::Ising(c) => c.step(n),
            Runner::Sir(c) => c.step(n, samples),
        }
    }

    pub fn finish(&mut self) -> TemplateOutput {
        match self {
            Runner::Neutron(c) => {
                let r = c.finish();
                TemplateOutput { hash: r.hash, output: c.output_bytes() }
            }
            Runner::Ising(c) => c.finish(),
            Runner::Sir(c) => c.finish(),
        }
    }
}

/// Computes a whole chunk of any template in one call.
pub fn run_chunk(t: Template, params_json: &str, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<TemplateOutput, KernelError> {
    let params: Value = serde_json::from_str(params_json).map_err(|_| KernelError::InvalidParams("params must be a JSON object"))?;
    let mut r = Runner::new(t, &params, job_id, master_seed, index, trials)?;
    Ok(r.finish())
}

/// Hash of already-computed output bytes (what the coordinator checks a worker's claim with).
pub fn output_hash(job_id: &[u8; 32], index: u32, output: &[u8]) -> String {
    chunk_hash(job_id, index, output)
}

/// Decodes a chunk's canonical output bytes into JSON for results and drawing.
pub fn decode_output(t: Template, params: &Value, output: &[u8]) -> Result<Value, KernelError> {
    match t {
        Template::NeutronSlab => {
            let w = read_u32s(output, 3 + crate::HIST_BINS)?;
            Ok(json!({ "transmitted": w[0], "reflected": w[1], "absorbed": w[2], "histogram": w[3..].to_vec() }))
        }
        Template::Ising2D => ising::decode(&IsingParams::from_value(params)?, output),
        Template::SirEpidemic => sir::decode(output),
    }
}

pub(crate) fn read_u32s(b: &[u8], n: usize) -> Result<Vec<u32>, KernelError> {
    if b.len() != 4 * n {
        return Err(KernelError::InvalidParams("output has the wrong length for this template"));
    }
    Ok(b.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect())
}

pub(crate) fn f64_at(b: &[u8], i: usize) -> f64 {
    f64::from_bits(u64::from_le_bytes(b[i..i + 8].try_into().unwrap()))
}

pub(crate) fn hex(b: &[u8]) -> String {
    to_hex(b)
}

/// Reads an optional number field with a default.
pub(crate) fn num(v: &Value, key: &str, default: f64) -> Result<f64, KernelError> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(x) => x.as_f64().filter(|f| f.is_finite()).ok_or(KernelError::InvalidParams("parameters must be finite numbers")),
    }
}

pub(crate) fn int(v: &Value, key: &str, default: u32, min: u32, max: u32, err: &'static str) -> Result<u32, KernelError> {
    let f = num(v, key, default as f64)?;
    if f.fract() != 0.0 || f < min as f64 || f > max as f64 {
        return Err(KernelError::InvalidParams(err));
    }
    Ok(f as u32)
}
