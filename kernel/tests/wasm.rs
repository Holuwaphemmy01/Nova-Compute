//! WASM suite: `wasm-pack test --node kernel`. Runs the same checks as the native
//! suite on wasm32, plus the JS-facing `Simulator` wrapper.
#![cfg(target_arch = "wasm32")]

mod common;

use nova_kernel::{ChunkResult, Progress, Simulator, to_hex};
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn golden_hash() {
    common::check_golden_hash();
}

#[wasm_bindgen_test]
fn same_inputs_same_hash() {
    common::check_same_inputs_same_hash();
}

#[wasm_bindgen_test]
fn different_inputs_different_hash() {
    common::check_different_inputs_different_hash();
}

#[wasm_bindgen_test]
fn batching_matches_run_chunk() {
    common::check_batching_matches_run_chunk();
}

#[wasm_bindgen_test]
fn counts_sum_to_trials() {
    common::check_counts_sum_to_trials();
}

#[wasm_bindgen_test]
fn physics_sanity() {
    common::check_physics_sanity();
}

#[wasm_bindgen_test]
fn invalid_params_rejected() {
    common::check_invalid_params_rejected();
}

/// The JS-facing Simulator, stepped in uneven batches, must hit the GOLDEN hash too.
#[wasm_bindgen_test]
fn simulator_matches_golden() {
    let params = serde_wasm_bindgen::to_value(&common::GOLDEN_PARAMS).unwrap();
    let mut sim = Simulator::new(
        params,
        &to_hex(&common::GOLDEN_JOB_ID),
        &to_hex(common::GOLDEN_SEED),
        common::GOLDEN_INDEX,
        common::GOLDEN_TRIALS,
    )
    .unwrap();
    let mut last: Option<Progress> = None;
    for batch in [1, 37, 999, 10_000].into_iter().cycle() {
        if sim.done() >= sim.trials() {
            break;
        }
        last = Some(serde_wasm_bindgen::from_value(sim.step(batch).unwrap()).unwrap());
    }
    let progress = last.unwrap();
    assert_eq!(progress.done, common::GOLDEN_TRIALS);
    let result: ChunkResult = serde_wasm_bindgen::from_value(sim.finish().unwrap()).unwrap();
    assert_eq!(result.hash, common::GOLDEN);
    assert_eq!(result, common::golden());
}

#[wasm_bindgen_test]
fn template_goldens() {
    common::check_template_goldens();
}

#[wasm_bindgen_test]
fn neutron_golden_unchanged_through_dispatcher() {
    common::check_neutron_via_dispatcher();
}

#[wasm_bindgen_test]
fn template_streaming_matches_run_chunk() {
    common::check_template_streaming_matches_run_chunk();
}

#[wasm_bindgen_test]
fn template_inputs_change_hash() {
    common::check_template_inputs_change_hash();
}

/// The JS-facing TemplateSimulator hits the same goldens.
#[wasm_bindgen_test]
fn template_simulator_matches_goldens() {
    use nova_kernel::TemplateSimulator;
    for (t, params, index, trials, golden) in [
        ("ising_2d", common::ising_params(), common::ISING_INDEX, common::ISING_TRIALS, common::GOLDEN_ISING),
        ("sir_epidemic", common::sir_params(), common::SIR_INDEX, common::SIR_TRIALS, common::GOLDEN_SIR),
    ] {
        let mut sim = TemplateSimulator::new(t, &params.to_string(), &to_hex(&common::GOLDEN_JOB_ID), &to_hex(common::GOLDEN_SEED), index, trials).unwrap();
        while sim.done() < sim.total() {
            sim.step(13).unwrap();
        }
        let r: serde_json::Value = serde_wasm_bindgen::from_value(sim.finish().unwrap()).unwrap();
        assert_eq!(r["hash"], golden, "{t}");
    }
}
