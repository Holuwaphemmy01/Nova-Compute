import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Simulator } from "./pkg/nova_kernel.js";
import type { SimParams } from "./types";
import { labJobIdHex, loadKernelSync, runWasmSimulation } from "./wasmRun";

/** Must equal GOLDEN in kernel/tests/common/mod.rs. */
const GOLDEN = "26b1ba63e890f7348ddab97872a95b5f11e6cfee533228373c9a6ed2a1976ba6";

const base: SimParams = { thicknessCm: 10, mfpCm: 3, absorbProb: 0.18, particles: 10_000, seed: "0xNOVA2026" };
const fast = { batches: 1, intervalMs: 0 };
const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

beforeAll(() => {
  loadKernelSync(readFileSync(new URL("./pkg/nova_kernel_bg.wasm", import.meta.url)));
});

describe("WASM kernel in the web app", () => {
  it("is the same build as the Rust crate: reproduces the GOLDEN hash", () => {
    const sim = new Simulator({ thickness_cm: 10, mfp_cm: 3, absorb_prob: 0.18 }, "00".repeat(32), hex("0xNOVA2026"), 7, 10_000);
    for (const n of [1, 37, 999]) sim.step(n);
    const r = sim.finish() as { hash: string };
    sim.free();
    expect(r.hash).toBe(GOLDEN);
  });

  it("uses sha256('nova-lab') as the lab job id", async () => {
    expect(await labJobIdHex()).toBe(createHash("sha256").update("nova-lab").digest("hex"));
  });

  it("gives the same fingerprint for the same seed, however the run is batched", async () => {
    const a = await runWasmSimulation(base, fast);
    const b = await runWasmSimulation(base, { batches: 97, intervalMs: 0 });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect([b.transmitted, b.reflected, b.absorbed]).toEqual([a.transmitted, a.reflected, a.absorbed]);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a different fingerprint for a different seed or parameters", async () => {
    const a = await runWasmSimulation(base, fast);
    for (const change of [{ seed: "0xNOVA2027" }, { thicknessCm: 11 }, { mfpCm: 3.5 }, { absorbProb: 0.2 }, { particles: 9_999 }]) {
      const b = await runWasmSimulation({ ...base, ...change }, fast);
      expect(b.fingerprint, JSON.stringify(change)).not.toBe(a.fingerprint);
    }
  });

  it("accounts for every particle, so percentages sum to 100%", async () => {
    for (const particles of [1_000, 10_000, 50_000]) {
      const r = await runWasmSimulation({ ...base, particles }, fast);
      expect(r.transmitted + r.reflected + r.absorbed).toBe(particles);
      expect(r.histogram).toHaveLength(64);
    }
  });

  it("reports sample tracks that start at the wall face", async () => {
    const tracks: { pts: [number, number][] }[] = [];
    await runWasmSimulation({ ...base, particles: 1_000 }, { batches: 5, intervalMs: 0, onProgress: (p) => tracks.push(...p.sampleTracks) });
    expect(tracks).toHaveLength(10);
    for (const t of tracks) expect(t.pts[0]).toEqual([0, 0]);
  });

  it("can be cancelled", async () => {
    const ctrl = new AbortController();
    const run = runWasmSimulation(base, { batches: 50, intervalMs: 5, signal: ctrl.signal });
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
