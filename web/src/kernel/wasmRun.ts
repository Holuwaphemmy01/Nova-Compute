/**
 * Runs the Rust kernel (compiled to WebAssembly) for the Simulation lab.
 * Used inside the Web Worker (sim.worker.ts) and by the Vitest suite.
 *
 * Lab mapping onto a kernel chunk:
 *   master_seed = UTF-8 bytes of the seed text
 *   job_id      = sha256("nova-lab")
 *   index       = 0
 *   trials      = particles
 * The fingerprint shown in the lab is the kernel's chunk hash.
 */
import init, { initSync, Simulator } from "./pkg/nova_kernel.js";
import type { RunOptions, SimParams, SimProgress, SimResult, Track } from "./types";

let ready: Promise<unknown> | null = null;

/** Loads the WASM module once (fetches nova_kernel_bg.wasm next to the JS glue). */
export function loadKernel(): Promise<unknown> {
  ready ??= init();
  return ready;
}

/** Synchronous init from bytes, for Node/Vitest. */
export function loadKernelSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  ready = Promise.resolve();
}

const utf8 = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

let labJobId: Promise<string> | null = null;
/** sha256("nova-lab") as hex: the fixed job id of every lab run. */
export function labJobIdHex(): Promise<string> {
  labJobId ??= crypto.subtle.digest("SHA-256", utf8.encode("nova-lab")).then((d) => hex(new Uint8Array(d)));
  return labJobId;
}

export interface ChunkArgs {
  params: { thickness_cm: number; mfp_cm: number; absorb_prob: number };
  jobIdHex: string;
  masterSeedHex: string;
  index: number;
  trials: number;
}

export async function labChunkArgs(p: SimParams): Promise<ChunkArgs> {
  return {
    params: { thickness_cm: p.thicknessCm, mfp_cm: p.mfpCm, absorb_prob: p.absorbProb },
    jobIdHex: await labJobIdHex(),
    masterSeedHex: hex(utf8.encode(p.seed)),
    index: 0,
    trials: p.particles,
  };
}

/** Shapes returned by the Rust `Simulator` (snake_case, serialized by serde-wasm-bindgen). */
interface RustProgress {
  done: number;
  transmitted: number;
  reflected: number;
  absorbed: number;
  sample_tracks: Track[];
}
interface RustResult {
  transmitted: number;
  reflected: number;
  absorbed: number;
  histogram: number[];
  hash: string;
}

export interface PacingOptions {
  /** How many progress steps to split the run into. */
  batches?: number;
  /** Pause between batches so the run is visible and stays cancellable. */
  intervalMs?: number;
}

const abortError = () => new DOMException("Simulation cancelled", "AbortError");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs a lab simulation on the WASM kernel in batches, reporting progress after each. */
export async function runWasmSimulation(
  params: SimParams,
  { onProgress, signal, batches = 60, intervalMs = 40 }: RunOptions & PacingOptions = {},
): Promise<SimResult & { histogram: number[] }> {
  await loadKernel();
  const a = await labChunkArgs(params);
  const sim = new Simulator(a.params, a.jobIdHex, a.masterSeedHex, a.index, a.trials);
  try {
    const perBatch = Math.max(1, Math.ceil(a.trials / batches));
    let computeMs = 0;
    let last: SimProgress = { done: 0, transmitted: 0, reflected: 0, absorbed: 0, sampleTracks: [], computeMs: 0 };

    while (sim.done < sim.trials) {
      if (signal?.aborted) throw abortError();
      const t0 = performance.now();
      const p = sim.step(perBatch) as RustProgress;
      computeMs += performance.now() - t0;
      last = { done: p.done, transmitted: p.transmitted, reflected: p.reflected, absorbed: p.absorbed, sampleTracks: p.sample_tracks, computeMs };
      onProgress?.(last);
      if (sim.done < sim.trials && intervalMs > 0) await sleep(intervalMs);
    }
    if (signal?.aborted) throw abortError();

    const t0 = performance.now();
    const r = sim.finish() as RustResult;
    computeMs += performance.now() - t0;
    return {
      done: a.trials,
      transmitted: r.transmitted,
      reflected: r.reflected,
      absorbed: r.absorbed,
      sampleTracks: [],
      computeMs,
      ms: computeMs,
      fingerprint: r.hash,
      histogram: r.histogram,
    };
  } finally {
    sim.free();
  }
}

// ---------------------------------------------------------------- browser worker: real chunks

/** Kernel GOLDEN hash (kernel/tests/common/mod.rs): L=10, mfp=3, absorb=0.18, job_id=0x00*32,
 *  seed "0xNOVA2026", index 7, 10,000 trials. A device that reproduces it computes like everyone else. */
export const GOLDEN = "26b1ba63e890f7348ddab97872a95b5f11e6cfee533228373c9a6ed2a1976ba6";

export interface ChunkJob {
  jobId: string; // hex, 32 bytes
  masterSeed: string; // hex
  index: number;
  trials: number;
  params: { thickness_cm: number; mfp_cm: number; absorb_prob: number };
}

export interface ChunkProgress {
  done: number;
  trials: number;
  sampleTracks: Track[];
}

export interface ChunkOutput {
  hash: string;
  summary: { transmitted: number; reflected: number; absorbed: number; histogram: number[] };
  computeMs: number;
}

const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));

/** Computes one leased chunk as fast as possible, reporting progress ~40 times; cancellable. */
export async function runChunk(job: ChunkJob, { onProgress, signal }: { onProgress?: (p: ChunkProgress) => void; signal?: AbortSignal } = {}): Promise<ChunkOutput> {
  await loadKernel();
  const sim = new Simulator(job.params, job.jobId, job.masterSeed, job.index, job.trials);
  try {
    const perBatch = Math.max(1, Math.ceil(job.trials / 40));
    let computeMs = 0;
    while (sim.done < sim.trials) {
      if (signal?.aborted) throw abortError();
      const t0 = performance.now();
      const p = sim.step(perBatch) as RustProgress;
      computeMs += performance.now() - t0;
      onProgress?.({ done: p.done, trials: job.trials, sampleTracks: p.sample_tracks });
      await yieldToEvents(); // lets cancel messages in
    }
    if (signal?.aborted) throw abortError();
    const t0 = performance.now();
    const r = sim.finish() as RustResult;
    computeMs += performance.now() - t0;
    return { hash: r.hash, summary: { transmitted: r.transmitted, reflected: r.reflected, absorbed: r.absorbed, histogram: r.histogram }, computeMs };
  } finally {
    sim.free();
  }
}

/** Determinism self-test: runs the kernel's GOLDEN input and compares the hash. */
export async function selfTest(): Promise<{ ok: boolean; hash: string; ms: number }> {
  const out = await runChunk({ jobId: "00".repeat(32), masterSeed: hex(utf8.encode("0xNOVA2026")), index: 7, trials: 10_000, params: { thickness_cm: 10, mfp_cm: 3, absorb_prob: 0.18 } });
  return { ok: out.hash === GOLDEN, hash: out.hash, ms: out.computeMs };
}
