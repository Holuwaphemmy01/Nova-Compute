//! Browser API: a streaming wrapper around [`Chunk`] for use from JavaScript.
//! It uses the exact same RNG stream as [`crate::run_chunk`], so results are identical.

use wasm_bindgen::prelude::*;

use crate::{Chunk, Params, SAMPLES_PER_STEP, from_hex};

fn js_err(e: impl core::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

#[wasm_bindgen]
pub struct Simulator {
    chunk: Chunk,
}

#[wasm_bindgen]
impl Simulator {
    /// `params_js`: `{ thickness_cm, mfp_cm, absorb_prob }`.
    /// `job_id_hex`: 64 hex chars (32 bytes). `master_seed_hex`: any even-length hex.
    #[wasm_bindgen(constructor)]
    pub fn new(params_js: JsValue, job_id_hex: &str, master_seed_hex: &str, index: u32, trials: u32) -> Result<Simulator, JsError> {
        let params: Params = serde_wasm_bindgen::from_value(params_js).map_err(js_err)?;
        let job_id: [u8; 32] = from_hex(job_id_hex)
            .map_err(js_err)?
            .try_into()
            .map_err(|_| JsError::new("job_id must be 32 bytes (64 hex characters)"))?;
        let master_seed = from_hex(master_seed_hex).map_err(js_err)?;
        let chunk = Chunk::new(params, job_id, &master_seed, index, trials).map_err(js_err)?;
        Ok(Simulator { chunk })
    }

    /// Simulates up to `n` more particles.
    /// Returns `{ done, transmitted, reflected, absorbed, sample_tracks }`, where
    /// `sample_tracks` holds the paths of up to 2 particles from this call.
    pub fn step(&mut self, n: u32) -> Result<JsValue, JsError> {
        let progress = self.chunk.step(n, SAMPLES_PER_STEP);
        serde_wasm_bindgen::to_value(&progress).map_err(js_err)
    }

    /// Runs any remaining particles. Returns `{ transmitted, reflected, absorbed, histogram, hash }`.
    pub fn finish(&mut self) -> Result<JsValue, JsError> {
        let result = self.chunk.finish();
        serde_wasm_bindgen::to_value(&result).map_err(js_err)
    }

    #[wasm_bindgen(getter)]
    pub fn done(&self) -> u32 {
        self.chunk.done()
    }

    #[wasm_bindgen(getter)]
    pub fn trials(&self) -> u32 {
        self.chunk.trials()
    }
}

/// Generic streaming simulator for every template (same RNG stream as `templates::run_chunk`).
#[wasm_bindgen]
pub struct TemplateSimulator {
    runner: crate::templates::Runner,
    template: crate::templates::Template,
    params: serde_json::Value,
}

fn to_js(v: &impl serde::Serialize) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(js_err)
}

#[wasm_bindgen]
impl TemplateSimulator {
    /// `template`: "neutron_slab" | "ising_2d" | "sir_epidemic"; `params_json`: the job's params
    /// (Ising params include n_temps). `trials`: particles / measurement sweeps / outbreaks.
    #[wasm_bindgen(constructor)]
    pub fn new(template: &str, params_json: &str, job_id_hex: &str, master_seed_hex: &str, index: u32, trials: u32) -> Result<TemplateSimulator, JsError> {
        let t = crate::templates::Template::parse(template).map_err(js_err)?;
        let params: serde_json::Value = serde_json::from_str(params_json).map_err(js_err)?;
        let job_id: [u8; 32] = from_hex(job_id_hex)
            .map_err(js_err)?
            .try_into()
            .map_err(|_| JsError::new("job_id must be 32 bytes (64 hex characters)"))?;
        let master_seed = from_hex(master_seed_hex).map_err(js_err)?;
        let runner = crate::templates::Runner::new(t, &params, job_id, &master_seed, index, trials).map_err(js_err)?;
        Ok(TemplateSimulator { runner, template: t, params })
    }

    /// Advances up to `n` units (particles / sweeps / outbreaks); returns a progress object.
    pub fn step(&mut self, n: u32) -> Result<JsValue, JsError> {
        to_js(&self.runner.step(n, SAMPLES_PER_STEP))
    }

    /// Runs the rest. Returns `{ hash, output (hex), summary }` where summary is the decoded output.
    pub fn finish(&mut self) -> Result<JsValue, JsError> {
        let out = self.runner.finish();
        let summary = crate::templates::decode_output(self.template, &self.params, &out.output).map_err(js_err)?;
        to_js(&serde_json::json!({ "hash": out.hash, "output": crate::to_hex(&out.output), "summary": summary }))
    }

    #[wasm_bindgen(getter)]
    pub fn done(&self) -> u32 {
        self.runner.done()
    }

    #[wasm_bindgen(getter)]
    pub fn total(&self) -> u32 {
        self.runner.total()
    }
}
