import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GOLDEN, loadKernelSync, runChunk, selfTest } from "../kernel/wasmRun";

// The loop's Web Worker is replaced by the same WASM kernel running in-process.
vi.mock("../kernel/wasmKernel", () => ({
  createWasmKernel: () => ({ runChunk: (job: never, opts: never) => runChunk(job, opts) }),
  isAbort: (e: unknown) => e instanceof DOMException && e.name === "AbortError",
}));

const { browserWorker } = await import("./browserWorker");
const { workerSession } = await import("./workerSession");

beforeAll(() => {
  loadKernelSync(readFileSync(new URL("../kernel/pkg/nova_kernel_bg.wasm", import.meta.url)));
});

afterEach(() => {
  browserWorker.pause();
  vi.unstubAllGlobals();
});

const until = async (cond: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const goldenLease = {
  assignment_id: "a_1",
  job_id: "00".repeat(32),
  index: 7,
  master_seed: Buffer.from("0xNOVA2026").toString("hex"),
  params: { thickness_cm: 10, mfp_cm: 3, absorb_prob: 0.18 },
  trials: 10_000,
  deadline: Date.now() + 60_000,
};

describe("kernel self-test", () => {
  it("reproduces the kernel's GOLDEN hash through the chunk runner", async () => {
    const r = await selfTest();
    expect(r.hash).toBe(GOLDEN);
    expect(r.ok).toBe(true);
  });
});

describe("browser worker loop", () => {
  it("leases, computes with the WASM kernel, submits, waits on 204 and stops on pause", async () => {
    const submitted: { url: string; body: { hash: string; summary: { transmitted: number; reflected: number; absorbed: number; histogram: number[] } } }[] = [];
    let nextCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/work/next")) {
          nextCalls++;
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
          return nextCalls === 1 ? new Response(JSON.stringify(goldenLease), { status: 200 }) : new Response(null, { status: 204 });
        }
        if (url.includes("/work/a_1/result")) {
          submitted.push({ url, body: JSON.parse(init!.body as string) });
          return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: "not_found", message: "nope" } }), { status: 404 });
      }),
    );
    workerSession.set({ workerId: "w_1", token: "tok", payoutAddr: "bchtest:qq" });
    browserWorker.setLimit(100); // no resting between chunks

    browserWorker.start();
    await until(() => submitted.length === 1 && nextCalls >= 2);
    const { hash, summary } = submitted[0].body;
    expect(hash).toBe(GOLDEN);
    expect(summary.transmitted + summary.reflected + summary.absorbed).toBe(10_000);
    expect(summary.histogram).toHaveLength(64);
    expect(browserWorker.get().completedThisSession).toBe(1);
    expect(browserWorker.get().lastOutcome).toBe("accepted");
    expect(browserWorker.get().status).toBe("waiting"); // 204 → waiting 3 s before asking again

    browserWorker.pause();
    expect(browserWorker.get().status).toBe("paused");
    expect(browserWorker.running).toBe(false);
  });

  it("stops and clears the session on 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "missing or invalid credentials" } }), { status: 401 })));
    workerSession.set({ workerId: "w_2", token: "bad", payoutAddr: "bchtest:qq" });
    browserWorker.start();
    await until(() => browserWorker.get().status === "error");
    expect(workerSession.get()).toBeNull();
    expect(browserWorker.get().message).toMatch(/session ended/);
  });
});
