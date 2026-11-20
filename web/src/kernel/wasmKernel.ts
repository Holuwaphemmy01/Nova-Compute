/**
 * The Rust kernel compiled to WebAssembly, running in a Web Worker.
 * `run` implements the SimKernel interface (Simulation lab); `runChunk` / `selfTest` serve the
 * browser worker that earns BCH by computing coordinator chunks.
 */
import type { ToWorker } from "./sim.worker";
import type { RunOptions, SimKernel, SimParams, SimProgress, SimResult } from "./types";
import type { ChunkJob, ChunkOutput, ChunkProgress, Pacing } from "./wasmRun";

export const KERNEL_NAME = "Rust kernel (WebAssembly)";

type FromWorker =
  | { type: "progress"; id: number; progress: unknown }
  | { type: "done"; id: number; result: unknown }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };

interface Pending {
  resolve: (r: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: (p: unknown) => void;
}

const abortError = () => new DOMException("Simulation cancelled", "AbortError");

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export interface WasmKernel extends SimKernel {
  runChunk(job: ChunkJob, opts?: { onProgress?: (p: ChunkProgress) => void; signal?: AbortSignal; pace?: Pacing }): Promise<ChunkOutput>;
  selfTest(): Promise<{ ok: boolean; hash: string; ms: number }>;
  dispose(): void;
}

/** Worker-backed WASM kernel. One request at a time: a new request cancels the old one. */
export function createWasmKernel(): WasmKernel {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  const send = (m: ToWorker) => worker.postMessage(m);

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") {
      p.onProgress?.(m.progress);
      return;
    }
    pending.delete(m.id);
    if (m.type === "done") p.resolve(m.result);
    else if (m.type === "cancelled") p.reject(abortError());
    else p.reject(new Error(m.message));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "The simulation worker failed to start"));
    pending.clear();
  };

  function cancel(id: number) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    send({ type: "cancel", id });
    p.reject(abortError());
  }

  function request<T>(build: (id: number) => ToWorker, onProgress?: (p: never) => void, signal?: AbortSignal): Promise<T> {
    for (const id of [...pending.keys()]) cancel(id);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      pending.set(id, { resolve: resolve as (r: unknown) => void, reject, onProgress: onProgress as (p: unknown) => void });
      signal?.addEventListener("abort", () => cancel(id), { once: true });
      send(build(id));
    });
  }

  return {
    name: KERNEL_NAME,
    run(params: SimParams, options: RunOptions = {}) {
      return request<SimResult>((id) => ({ type: "run", id, params }), options.onProgress as (p: SimProgress) => void, options.signal);
    },
    runChunk(job, opts = {}) {
      return request<ChunkOutput>((id) => ({ type: "chunk", id, job, pace: opts.pace }), opts.onProgress, opts.signal);
    },
    selfTest() {
      return request((id) => ({ type: "selftest", id }));
    },
    dispose() {
      for (const id of [...pending.keys()]) cancel(id);
      worker.terminate();
    },
  };
}

let hashPromise: Promise<string> | null = null;
/** Identifies the exact kernel build: sha256 of the .wasm file this browser runs. */
export function kernelHash(): Promise<string> {
  hashPromise ??= fetch(new URL("./pkg/nova_kernel_bg.wasm", import.meta.url))
    .then((r) => r.arrayBuffer())
    .then((b) => crypto.subtle.digest("SHA-256", b))
    .then((d) => `nova-kernel/0.1 wasm sha256:${Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("")}`);
  return hashPromise;
}
