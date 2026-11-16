/**
 * The Simulation lab's kernel: the Rust kernel compiled to WebAssembly, running in a
 * Web Worker. Implements the SimKernel interface from ./types.
 */
import type { ToWorker } from "./sim.worker";
import type { RunOptions, SimKernel, SimParams, SimProgress, SimResult } from "./types";

export const KERNEL_NAME = "Rust kernel (WebAssembly)";

type FromWorker =
  | { type: "progress"; id: number; progress: SimProgress }
  | { type: "done"; id: number; result: SimResult }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };

interface Pending {
  resolve: (r: SimResult) => void;
  reject: (e: unknown) => void;
  onProgress?: (p: SimProgress) => void;
}

const abortError = () => new DOMException("Simulation cancelled", "AbortError");

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Worker-backed WASM kernel. One run at a time: a new run cancels the old one. */
export function createWasmKernel(): SimKernel & { dispose(): void } {
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
    for (const p of pending.values()) p.reject(new Error(e.message || "Simulation worker failed"));
    pending.clear();
  };

  function cancel(id: number) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    send({ type: "cancel", id });
    p.reject(abortError());
  }

  return {
    name: KERNEL_NAME,
    run(params: SimParams, options: RunOptions = {}) {
      for (const id of [...pending.keys()]) cancel(id);
      const id = nextId++;
      return new Promise<SimResult>((resolve, reject) => {
        if (options.signal?.aborted) return reject(abortError());
        pending.set(id, { resolve, reject, onProgress: options.onProgress });
        options.signal?.addEventListener("abort", () => cancel(id), { once: true });
        send({ type: "run", id, params });
      });
    },
    dispose() {
      for (const id of [...pending.keys()]) cancel(id);
      worker.terminate();
    },
  };
}
