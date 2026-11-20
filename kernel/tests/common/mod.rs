//! Checks shared by the native (`cargo test`) and WASM (`wasm-pack test --node`) suites,
//! so both targets assert exactly the same things, including the same GOLDEN hash.
#![allow(dead_code)]

use nova_kernel::{Chunk, ChunkResult, HIST_BINS, Params, run_chunk, try_run_chunk};

/// Hash of the golden input below. Identical on native and wasm32 = proof of determinism.
pub const GOLDEN: &str = "26b1ba63e890f7348ddab97872a95b5f11e6cfee533228373c9a6ed2a1976ba6";

pub const GOLDEN_PARAMS: Params = Params { thickness_cm: 10.0, mfp_cm: 3.0, absorb_prob: 0.18 };
pub const GOLDEN_JOB_ID: [u8; 32] = [0; 32];
pub const GOLDEN_SEED: &[u8] = b"0xNOVA2026";
pub const GOLDEN_INDEX: u32 = 7;
pub const GOLDEN_TRIALS: u32 = 10_000;

pub fn golden() -> ChunkResult {
    run_chunk(GOLDEN_PARAMS, GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS)
}

fn stepped(batch: u32, samples: usize) -> ChunkResult {
    let mut c = Chunk::new(GOLDEN_PARAMS, GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS).unwrap();
    while !c.is_done() {
        c.step(batch, samples);
    }
    c.finish()
}

pub fn check_golden_hash() {
    assert_eq!(golden().hash, GOLDEN);
}

pub fn check_same_inputs_same_hash() {
    let a = golden();
    let b = golden();
    assert_eq!(a, b);
    assert_eq!(a.hash.len(), 64);
}

pub fn check_different_inputs_different_hash() {
    let base = golden().hash;
    let seed = run_chunk(GOLDEN_PARAMS, GOLDEN_JOB_ID, b"0xNOVA2027", GOLDEN_INDEX, GOLDEN_TRIALS);
    let index = run_chunk(GOLDEN_PARAMS, GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX + 1, GOLDEN_TRIALS);
    let mut other_job = GOLDEN_JOB_ID;
    other_job[0] = 1;
    let job = run_chunk(GOLDEN_PARAMS, other_job, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS);
    let params = run_chunk(Params { thickness_cm: 11.0, ..GOLDEN_PARAMS }, GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS);
    for (what, h) in [("seed", seed.hash), ("index", index.hash), ("job_id", job.hash), ("params", params.hash)] {
        assert_ne!(h, base, "changing {what} must change the hash");
    }
}

pub fn check_batching_matches_run_chunk() {
    let expected = golden();
    for batch in [1, 37, 10_000] {
        assert_eq!(stepped(batch, 2), expected, "batch size {batch}");
    }
    // Recording paths for every particle must not change the RNG stream.
    assert_eq!(stepped(500, 500), expected, "recording all paths");
}

pub fn check_counts_sum_to_trials() {
    for trials in [0, 1, 999, GOLDEN_TRIALS] {
        let r = run_chunk(GOLDEN_PARAMS, GOLDEN_JOB_ID, GOLDEN_SEED, 0, trials);
        assert_eq!(r.transmitted + r.reflected + r.absorbed, trials);
        assert_eq!(r.histogram.len(), HIST_BINS);
    }
}

pub fn check_physics_sanity() {
    let thin = run_chunk(Params { thickness_cm: 2.0, ..GOLDEN_PARAMS }, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 20_000);
    let thick = run_chunk(Params { thickness_cm: 20.0, ..GOLDEN_PARAMS }, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 20_000);
    assert!(thick.transmitted < thin.transmitted);
    let clear = run_chunk(Params { absorb_prob: 0.0, ..GOLDEN_PARAMS }, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 5_000);
    assert!(clear.absorbed < 50, "only the step cap can absorb when absorb_prob = 0");
    let wall = run_chunk(Params { absorb_prob: 1.0, ..GOLDEN_PARAMS }, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 5_000);
    assert_eq!(wall.reflected, 0, "every first collision absorbs");
}

pub fn check_sample_tracks() {
    let mut c = Chunk::new(GOLDEN_PARAMS, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 100).unwrap();
    let p = c.step(10, 2);
    assert_eq!(p.sample_tracks.len(), 2);
    assert_eq!(p.done, 10);
    for t in &p.sample_tracks {
        assert_eq!(t.pts[0], [0.0, 0.0]);
    }
}

pub fn check_invalid_params_rejected() {
    for bad in [
        Params { thickness_cm: 0.0, ..GOLDEN_PARAMS },
        Params { mfp_cm: -1.0, ..GOLDEN_PARAMS },
        Params { absorb_prob: 1.5, ..GOLDEN_PARAMS },
        Params { thickness_cm: f64::NAN, ..GOLDEN_PARAMS },
    ] {
        assert!(try_run_chunk(bad, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 10).is_err());
    }
}

// ---------------------------------------------------------------- templates

use nova_kernel::templates::{self, Runner, Template, decode_output};
use serde_json::{Value, json};

pub const GOLDEN_ISING: &str = "807cf2d044969af31d7f5223e015bf4b6a0c203d40a730ebc41657d35ebb4129";
pub const GOLDEN_SIR: &str = "e7699424b22f0e077e742eb2a972b57766c58779026090311d58a506fa664b88";

/// Ising golden input: L=16, T range 1.5..3.5 over 8 temperatures, chunk 3, 200 + 300 sweeps.
pub fn ising_params() -> Value {
    json!({ "L": 16, "t_min": 1.5, "t_max": 3.5, "n_temps": 8, "eq_sweeps": 200, "meas_sweeps": 300 })
}
pub const ISING_INDEX: u32 = 3;
pub const ISING_TRIALS: u32 = 300;

/// SIR golden input: N=2000, I0=5, r0=2.5, 7 recovery days, chunk 2, 50 outbreaks.
pub fn sir_params() -> Value {
    json!({ "population": 2000, "initial_infected": 5, "r0": 2.5, "recovery_days": 7, "runs_per_chunk": 50 })
}
pub const SIR_INDEX: u32 = 2;
pub const SIR_TRIALS: u32 = 50;

pub fn ising_golden() -> templates::TemplateOutput {
    templates::run_chunk(Template::Ising2D, &ising_params().to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, ISING_INDEX, ISING_TRIALS).unwrap()
}

pub fn sir_golden() -> templates::TemplateOutput {
    templates::run_chunk(Template::SirEpidemic, &sir_params().to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, SIR_INDEX, SIR_TRIALS).unwrap()
}

pub fn check_template_goldens() {
    assert_eq!(ising_golden().hash, GOLDEN_ISING, "Ising golden");
    assert_eq!(sir_golden().hash, GOLDEN_SIR, "SIR golden");
}

/// The neutron template through the generic dispatcher gives exactly the existing GOLDEN.
pub fn check_neutron_via_dispatcher() {
    let params = serde_json::to_string(&GOLDEN_PARAMS).unwrap();
    let out = templates::run_chunk(Template::NeutronSlab, &params, GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS).unwrap();
    assert_eq!(out.hash, GOLDEN);
    let mut r = Runner::new(Template::NeutronSlab, &serde_json::to_value(GOLDEN_PARAMS).unwrap(), GOLDEN_JOB_ID, GOLDEN_SEED, GOLDEN_INDEX, GOLDEN_TRIALS).unwrap();
    while !r.is_done() {
        r.step(37, 2);
    }
    assert_eq!(r.finish().hash, GOLDEN);
}

pub fn check_template_streaming_matches_run_chunk() {
    for (t, params, index, trials, expected) in [
        (Template::Ising2D, ising_params(), ISING_INDEX, ISING_TRIALS, ising_golden()),
        (Template::SirEpidemic, sir_params(), SIR_INDEX, SIR_TRIALS, sir_golden()),
    ] {
        for batch in [1, 7, 1000] {
            let mut r = Runner::new(t, &params, GOLDEN_JOB_ID, GOLDEN_SEED, index, trials).unwrap();
            while !r.is_done() {
                r.step(batch, 3); // recording samples must not change the stream
            }
            assert_eq!(r.finish(), expected, "{t:?} batch {batch}");
        }
        assert!(decode_output(t, &params, &expected.output).is_ok());
    }
}

pub fn check_template_inputs_change_hash() {
    let seed = templates::run_chunk(Template::Ising2D, &ising_params().to_string(), GOLDEN_JOB_ID, b"other", ISING_INDEX, ISING_TRIALS).unwrap();
    let idx = templates::run_chunk(Template::Ising2D, &ising_params().to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, ISING_INDEX + 1, ISING_TRIALS).unwrap();
    assert_ne!(seed.hash, GOLDEN_ISING);
    assert_ne!(idx.hash, GOLDEN_ISING);
    let sseed = templates::run_chunk(Template::SirEpidemic, &sir_params().to_string(), GOLDEN_JOB_ID, b"other", SIR_INDEX, SIR_TRIALS).unwrap();
    let sidx = templates::run_chunk(Template::SirEpidemic, &sir_params().to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, SIR_INDEX + 1, SIR_TRIALS).unwrap();
    assert_ne!(sseed.hash, GOLDEN_SIR);
    assert_ne!(sidx.hash, GOLDEN_SIR);
}

pub fn check_template_invalid_params_rejected() {
    let bad = [
        (Template::Ising2D, json!({ "L": 8, "n_temps": 8 })),
        (Template::Ising2D, json!({ "L": 32, "n_temps": 8, "t_min": 3.0, "t_max": 2.0 })),
        (Template::SirEpidemic, json!({ "population": 50 })),
        (Template::SirEpidemic, json!({ "r0": 9 })),
        (Template::SirEpidemic, json!({ "population": 1000, "initial_infected": 1000 })),
    ];
    for (t, p) in bad {
        assert!(Runner::new(t, &p, GOLDEN_JOB_ID, GOLDEN_SEED, 0, 10).is_err(), "{t:?} {p}");
    }
    // Ising chunk index must be a valid temperature index.
    assert!(Runner::new(Template::Ising2D, &ising_params(), GOLDEN_JOB_ID, GOLDEN_SEED, 8, 10).is_err());
}

/// Physics sanity (native only: these are the spec's full-size defaults).
pub fn ising_abs_m_at(t: f64) -> f64 {
    let p = json!({ "L": 32, "t_min": t, "t_max": t, "n_temps": 1, "eq_sweeps": 1000, "meas_sweeps": 2000 });
    let out = templates::run_chunk(Template::Ising2D, &p.to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, 0, 2000).unwrap();
    decode_output(Template::Ising2D, &p, &out.output).unwrap()["abs_m"].as_f64().unwrap()
}

pub fn sir_summary(r0: f64) -> Value {
    let p = json!({ "population": 10000, "initial_infected": 10, "r0": r0, "recovery_days": 7, "runs_per_chunk": 200 });
    let out = templates::run_chunk(Template::SirEpidemic, &p.to_string(), GOLDEN_JOB_ID, GOLDEN_SEED, 0, 200).unwrap();
    decode_output(Template::SirEpidemic, &p, &out.output).unwrap()
}
