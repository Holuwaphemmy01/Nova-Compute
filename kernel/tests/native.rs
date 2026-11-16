//! Native suite: `cargo test -p nova-kernel`.
#![cfg(not(target_arch = "wasm32"))]

mod common;

#[test]
fn golden_hash() {
    common::check_golden_hash();
}

#[test]
fn same_inputs_same_hash() {
    common::check_same_inputs_same_hash();
}

#[test]
fn different_inputs_different_hash() {
    common::check_different_inputs_different_hash();
}

#[test]
fn batching_matches_run_chunk() {
    common::check_batching_matches_run_chunk();
}

#[test]
fn counts_sum_to_trials() {
    common::check_counts_sum_to_trials();
}

#[test]
fn physics_sanity() {
    common::check_physics_sanity();
}

#[test]
fn sample_tracks() {
    common::check_sample_tracks();
}

#[test]
fn invalid_params_rejected() {
    common::check_invalid_params_rejected();
}

#[test]
#[ignore = "prints the golden hash; run with --ignored --nocapture when the spec changes"]
fn print_golden() {
    println!("GOLDEN = {}", common::golden().hash);
}
