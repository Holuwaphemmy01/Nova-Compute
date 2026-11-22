//! Native worker == browser WASM: every template reproduces the GOLDEN hashes asserted in
//! kernel/tests (native + wasm-pack) and web/src/kernel/wasmRun.test.ts (shipped WASM package).

use nova_worker::{GOLDEN_JOB_ID, GOLDEN_SEED_HEX, Lease, compute, compute_lease, goldens, self_test};

#[test]
fn every_template_matches_its_golden_hash() {
    for g in goldens() {
        let got = compute(g.template, &g.params, GOLDEN_JOB_ID, GOLDEN_SEED_HEX, g.index, g.trials).unwrap();
        assert_eq!(got.hash, g.hash, "{}", g.template);
    }
}

#[test]
fn lease_json_path_matches_too() {
    // Same JSON shape the coordinator sends from POST /work/next.
    let g = &goldens()[1];
    let lease: Lease = serde_json::from_value(serde_json::json!({
        "assignment_id": "a", "job_id": GOLDEN_JOB_ID, "index": g.index, "master_seed": GOLDEN_SEED_HEX,
        "template": g.template, "params": g.params, "trials": g.trials, "deadline": 0
    }))
    .unwrap();
    assert_eq!(compute_lease(&lease).unwrap().hash, g.hash);
}

#[test]
fn output_hex_rehashes_to_the_claimed_hash() {
    // What the coordinator does on submit: sha256(job_id ‖ index u32 BE ‖ output_bytes).
    for g in goldens() {
        let c = compute(g.template, &g.params, GOLDEN_JOB_ID, GOLDEN_SEED_HEX, g.index, g.trials).unwrap();
        let bytes = hex::decode(&c.output_hex).unwrap();
        assert_eq!(nova_kernel::chunk_hash(&[0u8; 32], g.index, &bytes), c.hash);
    }
}

#[test]
fn self_test_passes_and_names_the_kernel() {
    let id = self_test().unwrap();
    assert!(id.starts_with("nova-kernel/0.1 native sha256:") && id.len() <= 128);
}

#[test]
fn bad_inputs_are_errors_not_panics() {
    let g = &goldens()[0];
    assert!(compute("nope", &g.params, GOLDEN_JOB_ID, GOLDEN_SEED_HEX, 0, 10).is_err());
    assert!(compute(g.template, &g.params, "zz", GOLDEN_SEED_HEX, 0, 10).is_err());
    assert!(compute(g.template, &g.params, "00", GOLDEN_SEED_HEX, 0, 10).is_err());
}
