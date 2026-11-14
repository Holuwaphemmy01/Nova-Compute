/**
 * Runs the simulation off the main thread so the page never freezes.
 * Protocol (main → worker): { type: "run", id, params } | { type: "cancel", id }
 * Protocol (worker → main): { type: "progress" | "done" | "cancelled" | "error", id, ... }
 * Starting a new run cancels any run still in progress.
 */
import { runSimulation } from "./tsKernel";
import type { SimParams } from "./types";

export type ToWorker = { type: "run"; id: number; params: SimParams } | { type: "cancel"; id: number };

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

  try {
    const result = await runSimulation(msg.params, {
      signal: ctrl.signal,
      onProgress: (progress) => ctx.postMessage({ type: "progress", id: msg.id, progress }),
    });
    ctx.postMessage({ type: "done", id: msg.id, result });
  } catch (err) {
    if (ctrl.signal.aborted) ctx.postMessage({ type: "cancelled", id: msg.id });
    else ctx.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    runs.delete(msg.id);
  }
};
