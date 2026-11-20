/* tslint:disable */
/* eslint-disable */

export class Simulator {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Runs any remaining particles. Returns `{ transmitted, reflected, absorbed, histogram, hash }`.
     */
    finish(): any;
    /**
     * `params_js`: `{ thickness_cm, mfp_cm, absorb_prob }`.
     * `job_id_hex`: 64 hex chars (32 bytes). `master_seed_hex`: any even-length hex.
     */
    constructor(params_js: any, job_id_hex: string, master_seed_hex: string, index: number, trials: number);
    /**
     * Simulates up to `n` more particles.
     * Returns `{ done, transmitted, reflected, absorbed, sample_tracks }`, where
     * `sample_tracks` holds the paths of up to 2 particles from this call.
     */
    step(n: number): any;
    readonly done: number;
    readonly trials: number;
}

/**
 * Generic streaming simulator for every template (same RNG stream as `templates::run_chunk`).
 */
export class TemplateSimulator {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Runs the rest. Returns `{ hash, output (hex), summary }` where summary is the decoded output.
     */
    finish(): any;
    /**
     * `template`: "neutron_slab" | "ising_2d" | "sir_epidemic"; `params_json`: the job's params
     * (Ising params include n_temps). `trials`: particles / measurement sweeps / outbreaks.
     */
    constructor(template: string, params_json: string, job_id_hex: string, master_seed_hex: string, index: number, trials: number);
    /**
     * Advances up to `n` units (particles / sweeps / outbreaks); returns a progress object.
     */
    step(n: number): any;
    readonly done: number;
    readonly total: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_simulator_free: (a: number, b: number) => void;
    readonly __wbg_templatesimulator_free: (a: number, b: number) => void;
    readonly simulator_done: (a: number) => number;
    readonly simulator_finish: (a: number) => [number, number, number];
    readonly simulator_new: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly simulator_step: (a: number, b: number) => [number, number, number];
    readonly simulator_trials: (a: number) => number;
    readonly templatesimulator_done: (a: number) => number;
    readonly templatesimulator_finish: (a: number) => [number, number, number];
    readonly templatesimulator_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly templatesimulator_step: (a: number, b: number) => [number, number, number];
    readonly templatesimulator_total: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
