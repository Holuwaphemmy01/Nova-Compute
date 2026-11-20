/**
 * Runs the WASM kernel off the main thread so the page never freezes.
 * Requests (main → worker):
 *   { type: "run", id, params }        Simulation lab run (paced, for display)
 *   { type: "chunk", id, job, pace? }  a chunk of any template (full speed, or paced for display)
 *   { type: "selftest", id }           determinism self-test (GOLDEN)
 *   { type: "cancel", id }
 * Replies (worker → main): { type: "progress" | "done" | "cancelled" | "error", id, ... }
 * Starting a new request cancels any request still in progress.
 */
import type { SimParams } from "./types";
import { runChunk, runWasmSimulation, selfTest, type ChunkJob, type Pacing } from "./wasmRun";

export type ToWorker =
  | { type: "run"; id: number; params: SimParams }
  | { type: "chunk"; id: number; job: ChunkJob; pace?: Pacing }
  | { type: "selftest"; id: number }
  | { type: "cancel"; id: number };

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const runs = new Map<number, AbortController>();

ctx.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    runs.get(msg.id)?.abort();
    runs.delete(msg.id);
    return;
  }

  for (const ctrl of runs.values()) ctrl.abort();
  runs.clear();
  const ctrl = new AbortController();
  runs.set(msg.id, ctrl);
  const progress = (progress: unknown) => ctx.postMessage({ type: "progress", id: msg.id, progress });

  try {
    const result =
      msg.type === "run"
        ? await runWasmSimulation(msg.params, { signal: ctrl.signal, onProgress: progress })
        : msg.type === "chunk"
          ? await runChunk(msg.job, { signal: ctrl.signal, onProgress: progress, ...msg.pace })
          : await selfTest();
    ctx.postMessage({ type: "done", id: msg.id, result });
  } catch (err) {
    if (ctrl.signal.aborted) ctx.postMessage({ type: "cancelled", id: msg.id });
    else ctx.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    runs.delete(msg.id);
  }
};
