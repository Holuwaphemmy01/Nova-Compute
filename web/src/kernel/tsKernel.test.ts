import { describe, expect, it } from "vitest";
import { Simulation, fingerprint, runSimulation } from "./tsKernel";
import type { SimParams } from "./types";

const base: SimParams = { thicknessCm: 10, mfpCm: 3, absorbProb: 0.18, particles: 10_000, seed: "0xNOVA2026" };
const fast = { batches: 1, intervalMs: 0 };

describe("TypeScript reference kernel", () => {
  it("gives identical counts and fingerprint for the same params and seed", async () => {
    const a = await runSimulation(base, fast);
    const b = await runSimulation(base, fast);
    expect([a.transmitted, a.reflected, a.absorbed]).toEqual([b.transmitted, b.reflected, b.absorbed]);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on how the run is batched", async () => {
    const one = await runSimulation(base, fast);
    const many = await runSimulation(base, { batches: 97, intervalMs: 0, samplesPerBatch: 2 });
    expect(many.fingerprint).toBe(one.fingerprint);
  });

  it("gives a different fingerprint for a different seed", async () => {
    const a = await runSimulation(base, fast);
    const b = await runSimulation({ ...base, seed: "0xNOVA2027" }, fast);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("gives a different fingerprint when any parameter changes", async () => {
    const a = await runSimulation(base, fast);
    for (const change of [{ thicknessCm: 11 }, { mfpCm: 3.5 }, { absorbProb: 0.2 }, { particles: 9_999 }]) {
      const b = await runSimulation({ ...base, ...change }, fast);
      expect(b.fingerprint, JSON.stringify(change)).not.toBe(a.fingerprint);
    }
  });

  it("accounts for every particle, so percentages sum to 100%", async () => {
    for (const particles of [1_000, 10_000, 50_000]) {
      const r = await runSimulation({ ...base, particles }, fast);
      expect(r.done).toBe(particles);
      expect(r.transmitted + r.reflected + r.absorbed).toBe(particles);
      const pct = (100 * (r.transmitted + r.reflected + r.absorbed)) / r.done;
      expect(pct).toBeCloseTo(100, 10);
    }
  });

  it("produces physically sensible results", async () => {
    const r = await runSimulation({ ...base, particles: 50_000 }, fast);
    // Thicker walls let fewer particles through.
    const thick = await runSimulation({ ...base, particles: 50_000, thicknessCm: 20 }, fast);
    expect(thick.transmitted).toBeLessThan(r.transmitted);
    // No absorption: nothing is absorbed except particles that hit the step cap.
    const clear = await runSimulation({ ...base, absorbProb: 0 }, fast);
    expect(clear.absorbed).toBeLessThan(clear.done * 0.01);
  });

  it("records sample tracks that start at the wall face and end where the particle exits", () => {
    const sim = new Simulation(base);
    const tracks = sim.step(50, 50);
    expect(tracks).toHaveLength(50);
    for (const t of tracks) {
      expect(t.pts[0]).toEqual([0, 0]);
      const [x] = t.pts[t.pts.length - 1];
      if (t.fate === "transmitted") expect(x).toBeCloseTo(base.thicknessCm, 9);
      if (t.fate === "reflected") expect(x).toBeCloseTo(0, 9);
    }
  });

  it("fingerprints a canonical encoding of params and counts", async () => {
    const counts = { transmitted: 1, reflected: 2, absorbed: 3 };
    const a = await fingerprint(base, counts);
    expect(await fingerprint({ ...base }, { ...counts })).toBe(a);
    expect(await fingerprint(base, { ...counts, absorbed: 4 })).not.toBe(a);
  });

  it("can be cancelled", async () => {
    const ctrl = new AbortController();
    const run = runSimulation(base, { batches: 50, intervalMs: 5, signal: ctrl.signal });
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
