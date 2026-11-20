/**
 * The browser worker: leases chunks from the coordinator, computes them with the WASM kernel in a
 * Web Worker and submits the results, until paused. One instance for the whole app, so earning
 * continues while you move between pages (it stops when the tab closes).
 *
 *   POST /work/next → run kernel → POST /work/{id}/result → rest (GPU limit) → repeat
 *   204 (no work) → wait 3 s · lease expired → next · network error → wait 5 s · 401 → stop
 */
import { useSyncExternalStore } from "react";
import { ApiError, api, humanError, type SubmitOutcome } from "../api/client";
import type { Track as KernelTrack } from "../kernel/types";
import { createWasmKernel, isAbort, type WasmKernel } from "../kernel/wasmKernel";
import type { Track as DrawnTrack } from "./walk";
import { storage } from "./browser";
import { workerSession } from "./workerSession";

export type LoopStatus = "stopped" | "waiting" | "computing" | "submitting" | "resting" | "paused" | "error";

export interface LoopState {
  status: LoopStatus;
  message: string | null;
  current: { jobId: string; index: number; done: number; total: number; template: string; thicknessCm: number; lattice: { L: number; bits: string } | null } | null;
  /** Newest first. */
  tracks: DrawnTrack[];
  completedThisSession: number;
  lastOutcome: SubmitOutcome | null;
  /** Max share of the device to use, 10–100 (%). */
  limit: number;
}

const LIMIT_KEY = "nova.worker.limit";
const NO_WORK_WAIT_MS = 3000;
const ERROR_WAIT_MS = 5000;

let trackId = 1;
const toDrawn = (t: KernelTrack): DrawnTrack => ({ id: trackId++, pts: t.pts, fate: t.fate === "transmitted" ? "t" : t.fate === "reflected" ? "r" : "a" });

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

class BrowserWorker {
  private state: LoopState = {
    status: "stopped",
    message: null,
    current: null,
    tracks: [],
    completedThisSession: 0,
    lastOutcome: null,
    limit: Math.min(100, Math.max(10, Number(storage.get(LIMIT_KEY)) || 60)),
  };
  private listeners = new Set<() => void>();
  private kernel: WasmKernel | null = null;
  private ctrl: AbortController | null = null;

  get = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<LoopState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get running() {
    return this.ctrl !== null && !this.ctrl.signal.aborted;
  }

  setLimit(limit: number) {
    const v = Math.min(100, Math.max(10, Math.round(limit)));
    storage.set(LIMIT_KEY, String(v));
    this.set({ limit: v });
  }

  start() {
    if (this.running) return;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.set({ status: "waiting", message: null });
    void this.loop(ctrl.signal);
  }

  /** Stops right away; an unfinished chunk's lease simply expires and is reassigned. */
  pause() {
    this.ctrl?.abort();
    this.ctrl = null;
    this.set({ status: "paused", current: null, message: null });
  }

  private async loop(signal: AbortSignal) {
    this.kernel ??= createWasmKernel();
    while (!signal.aborted) {
      const session = workerSession.get();
      if (!session) {
        this.set({ status: "error", message: "Set up your GPU first." });
        this.ctrl = null;
        return;
      }
      try {
        this.set({ status: "waiting", current: null });
        const lease = await api.nextWork(session.token, signal);
        if (!lease) {
          await sleep(NO_WORK_WAIT_MS, signal);
          continue;
        }
        const template = lease.template ?? "neutron_slab";
        this.set({
          status: "computing",
          message: null,
          current: { jobId: lease.job_id, index: lease.index, done: 0, total: 1, template, thicknessCm: Number(lease.params.thickness_cm) || 10, lattice: null },
          tracks: template === "neutron_slab" ? this.state.tracks : [],
        });
        const out = await this.kernel.runChunk(
          { template, jobId: lease.job_id, masterSeed: lease.master_seed, index: lease.index, trials: lease.trials, params: lease.params },
          {
            signal,
            onProgress: (p) => {
              const cur = this.state.current;
              if (!cur) return;
              const tracks = (p.sample_tracks as KernelTrack[] | undefined) ?? [];
              const fresh = tracks.map(toDrawn).reverse();
              const lattice = typeof p.lattice === "string" ? { L: Number(p.L), bits: p.lattice } : cur.lattice;
              this.set({ current: { ...cur, done: p.done, total: p.total, lattice }, tracks: [...fresh, ...this.state.tracks].slice(0, 16) });
            },
          },
        );
        this.set({ status: "submitting" });
        const res = await api.submitResult(session.token, lease.assignment_id, out.hash, { output: out.output });
        this.set({ completedThisSession: this.state.completedThisSession + 1, lastOutcome: res.status, current: null });
        // Respect the device limit: at L% use, rest (100/L - 1) × the compute time.
        const rest = out.computeMs * (100 / this.state.limit - 1);
        if (rest > 0) {
          this.set({ status: "resting" });
          await sleep(rest, signal);
        }
      } catch (e) {
        if (signal.aborted || isAbort(e)) return;
        if (e instanceof ApiError && e.status === 401) {
          workerSession.set(null);
          this.set({ status: "error", message: "Your worker session ended. Run the setup again to keep earning.", current: null });
          this.ctrl = null;
          return;
        }
        if (e instanceof ApiError && e.code === "lease_expired") continue;
        this.set({ status: "waiting", message: `${humanError(e)} Retrying in a few seconds…`, current: null });
        try {
          await sleep(ERROR_WAIT_MS, signal);
        } catch {
          return;
        }
      }
    }
  }
}

export const browserWorker = new BrowserWorker();

export function useBrowserWorker(): LoopState {
  return useSyncExternalStore(browserWorker.subscribe, browserWorker.get, browserWorker.get);
}
