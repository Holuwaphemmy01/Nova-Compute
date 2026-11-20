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

#[test]
#[ignore = "prints the template golden hashes"]
fn print_template_goldens() {
    println!("GOLDEN_ISING = {}", common::ising_golden().hash);
    println!("GOLDEN_SIR = {}", common::sir_golden().hash);
}

#[test]
fn template_goldens() {
    common::check_template_goldens();
}

#[test]
fn neutron_golden_unchanged_through_dispatcher() {
    common::check_neutron_via_dispatcher();
}

#[test]
fn template_streaming_matches_run_chunk() {
    common::check_template_streaming_matches_run_chunk();
}

#[test]
fn template_inputs_change_hash() {
    common::check_template_inputs_change_hash();
}

#[test]
fn template_invalid_params_rejected() {
    common::check_template_invalid_params_rejected();
}

#[test]
fn ising_ordered_at_low_t_disordered_at_high_t() {
    let cold = common::ising_abs_m_at(1.5);
    let hot = common::ising_abs_m_at(3.5);
    println!("Ising L=32: <|m|>(T=1.5) = {cold:.4}, <|m|>(T=3.5) = {hot:.4}");
    assert!(cold > 0.9, "T=1.5: {cold}");
    assert!(hot < 0.3, "T=3.5: {hot}");
}

#[test]
fn sir_subcritical_has_no_major_outbreaks_and_r0_3_final_size_near_094() {
    let sub = common::sir_summary(0.8);
    assert!(sub["major_outbreaks"].as_u64().unwrap() <= 2, "r0=0.8: {}", sub["major_outbreaks"]);

    let s = common::sir_summary(3.0);
    let hist: Vec<u64> = s["final_size_hist"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect();
    // Mean final size of the major outbreaks from bin centres (bins are 1/64 wide).
    let (mut n, mut sum) = (0u64, 0.0f64);
    for (b, c) in hist.iter().enumerate() {
        let centre = (b as f64 + 0.5) / 64.0;
        if centre > 0.10 {
            n += c;
            sum += *c as f64 * centre;
        }
    }
    let mean = sum / n as f64;
    println!("SIR r0=3: {n}/200 major outbreaks, mean final size {mean:.3} (theory 0.940)");
    assert!(n > 150, "most outbreaks take off at r0=3: {n}");
    assert!((0.92..=0.96).contains(&mean), "final size {mean}");
}
