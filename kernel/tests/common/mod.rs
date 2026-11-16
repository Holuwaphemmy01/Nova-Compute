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
