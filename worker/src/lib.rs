//! Native Nova Compute provider.
//!
//! Computes leased pieces with the same `nova_kernel::templates::run_chunk` the coordinator uses
//! and the browser's WASM `TemplateSimulator` wraps, so the output bytes and the hash
//! `sha256(job_id ‖ index u32 BE ‖ output_bytes)` are identical bit for bit.

use nova_kernel::templates::{self, Template};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// A piece of work from `POST /work/next` (docs/api.md).
#[derive(Clone, Debug, Deserialize)]
pub struct Lease {
    pub assignment_id: String,
    pub job_id: String,
    pub index: u32,
    pub master_seed: String,
    pub template: String,
    pub params: Value,
    pub trials: u32,
    /// Lease deadline, unix milliseconds.
    pub deadline: i64,
}

/// What gets submitted to `POST /work/{assignment_id}/result`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Computed {
    pub hash: String,
    pub output_hex: String,
}

/// Runs one piece exactly as the browser does: template + JSON params + job id (hex) +
/// master seed (hex) + index + trials.
pub fn compute(template: &str, params: &Value, job_id_hex: &str, master_seed_hex: &str, index: u32, trials: u32) -> Result<Computed, String> {
    let t = Template::parse(template).map_err(|e| format!("template: {e:?}"))?;
    let job_id: [u8; 32] = hex::decode(job_id_hex)
        .map_err(|_| "job_id is not hex".to_string())?
        .try_into()
        .map_err(|_| "job_id must be 32 bytes".to_string())?;
    let seed = hex::decode(master_seed_hex).map_err(|_| "master_seed is not hex".to_string())?;
    let out = templates::run_chunk(t, &params.to_string(), job_id, &seed, index, trials).map_err(|e| format!("kernel: {e:?}"))?;
    Ok(Computed { hash: out.hash, output_hex: hex::encode(out.output) })
}

pub fn compute_lease(l: &Lease) -> Result<Computed, String> {
    compute(&l.template, &l.params, &l.job_id, &l.master_seed, l.index, l.trials)
}

/// Golden inputs shared with kernel/tests/common/mod.rs and web/src/kernel/wasmRun.test.ts.
pub struct Golden {
    pub template: &'static str,
    pub params: Value,
    pub index: u32,
    pub trials: u32,
    pub hash: &'static str,
}

pub const GOLDEN_JOB_ID: &str = "0000000000000000000000000000000000000000000000000000000000000000";
/// hex("0xNOVA2026")
pub const GOLDEN_SEED_HEX: &str = "30784e4f564132303236";

pub fn goldens() -> Vec<Golden> {
    vec![
        Golden {
            template: "neutron_slab",
            params: json!({ "thickness_cm": 10.0, "mfp_cm": 3.0, "absorb_prob": 0.18 }),
            index: 7,
            trials: 10_000,
            hash: "26b1ba63e890f7348ddab97872a95b5f11e6cfee533228373c9a6ed2a1976ba6",
        },
        Golden {
            template: "ising_2d",
            params: json!({ "L": 16, "t_min": 1.5, "t_max": 3.5, "n_temps": 8, "eq_sweeps": 200, "meas_sweeps": 300 }),
            index: 3,
            trials: 300,
            hash: "807cf2d044969af31d7f5223e015bf4b6a0c203d40a730ebc41657d35ebb4129",
        },
        Golden {
            template: "sir_epidemic",
            params: json!({ "population": 2000, "initial_infected": 5, "r0": 2.5, "recovery_days": 7, "runs_per_chunk": 50 }),
            index: 2,
            trials: 50,
            hash: "e7699424b22f0e077e742eb2a972b57766c58779026090311d58a506fa664b88",
        },
    ]
}

/// Recomputes every golden through [`compute`] (the leased-piece path). Returns the
/// `kernel_hash` to register with: `nova-kernel/0.1 native sha256:<sha256 of the golden hashes>`.
/// The coordinator stores this string; it does not need to equal the browser's WASM-file hash.
pub fn self_test() -> Result<String, String> {
    let mut h = Sha256::new();
    for g in goldens() {
        let got = compute(g.template, &g.params, GOLDEN_JOB_ID, GOLDEN_SEED_HEX, g.index, g.trials)?;
        if got.hash != g.hash {
            return Err(format!("{} golden mismatch: got {}, expected {}", g.template, got.hash, g.hash));
        }
        h.update(got.hash.as_bytes());
    }
    Ok(format!("nova-kernel/0.1 native sha256:{}", hex::encode(h.finalize())))
}
