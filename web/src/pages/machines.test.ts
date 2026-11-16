import { describe, expect, it } from "vitest";
import { BASE_PIECE_MS, PAIR_CODE_TTL_MS, SATS_PER_PIECE, createFakeMachinesApi } from "../api/fake/machines";
import { buildCommands } from "../config/worker";
import { countdown, timeAgo } from "../lib/time";

describe("countdown", () => {
  const t0 = Date.parse("2026-11-16T12:00:00Z");

  it("formats the remaining time as m:ss", () => {
    expect(countdown(t0 + 598_000, t0)).toMatchObject({ expired: false, label: "9:58" });
    expect(countdown(t0 + 65_000, t0).label).toBe("1:05");
    expect(countdown(t0 + 10 * 60_000, t0).label).toBe("10:00");
    expect(countdown(new Date(t0 + 1_500).toISOString(), t0).label).toBe("0:02"); // rounds up partial seconds
  });

  it("switches to expired at and after the deadline", () => {
    expect(countdown(t0, t0)).toMatchObject({ expired: true, label: "0:00" });
    expect(countdown(t0 - 1, t0).expired).toBe(true);
    expect(countdown(t0 + 1, t0).expired).toBe(false);
  });

  it("formats last-seen times", () => {
    expect(timeAgo(new Date(t0 - 5 * 60_000).toISOString(), t0)).toBe("5 min ago");
    expect(timeAgo(new Date(t0 - 10_000).toISOString(), t0)).toBe("just now");
  });
});

describe("worker commands", () => {
  it("substitute the live pairing code on every platform", () => {
    for (const platform of ["linux", "windows", "docker"] as const) {
      const cmds = buildCommands(platform, "NOVA-7K2Q");
      expect(cmds.some((c) => c.includes("pair NOVA-7K2Q"))).toBe(true);
      for (const c of cmds) expect(c).not.toMatch(/\{(CODE|INSTALL_URL|IMAGE)\}/);
    }
    expect(buildCommands("linux", "NOVA-ABCD")[1]).toBe("nova-worker pair NOVA-ABCD");
  });
});

describe("fake machines API", () => {
  function setup() {
    let t = Date.parse("2026-11-16T12:00:00Z");
    const api = createFakeMachinesApi({ now: () => t, latencyMs: 0 });
    return { api, advance: (ms: number) => (t += ms), now: () => t };
  }

  it("issues NOVA-XXXX codes valid for 10 minutes", async () => {
    const { api, now } = setup();
    const { code, expires_at } = await api.createPairCode();
    expect(code).toMatch(/^NOVA-[A-Z2-9]{4}$/);
    expect(Date.parse(expires_at) - now()).toBe(PAIR_CODE_TTL_MS);
  });

  it("earns while online and stops earning while paused", async () => {
    const { api, advance } = setup();
    const m = await api.simulatePairing();
    const pieceMs = (BASE_PIECE_MS * 100) / m.gpu_limit;

    advance(pieceMs * 3);
    const [running] = await api.listMachines();
    expect(running.pieces_finished).toBe(3);
    expect(running.earned_sats).toBe(3 * SATS_PER_PIECE);
    expect(running.particles_per_sec).toBeGreaterThan(0);

    const paused = await api.updateMachine(m.id, { paused: true });
    expect(paused.status).toBe("paused");
    advance(pieceMs * 10);
    const [still] = await api.listMachines();
    expect(still.earned_sats).toBe(3 * SATS_PER_PIECE);
    expect(still.pieces_finished).toBe(3);
    expect(still.particles_per_sec).toBe(0);

    await api.updateMachine(m.id, { paused: false });
    advance(pieceMs);
    const [resumed] = await api.listMachines();
    expect(resumed.pieces_finished).toBe(4);
  });

  it("changes the GPU limit and removes machines", async () => {
    const { api } = setup();
    const a = await api.simulatePairing();
    const b = await api.simulatePairing();
    expect((await api.updateMachine(a.id, { gpu_limit: 100 })).gpu_limit).toBe(100);
    await api.removeMachine(a.id);
    expect((await api.listMachines()).map((m) => m.id)).toEqual([b.id]);
    await expect(api.removeMachine(a.id)).rejects.toMatchObject({ status: 404 });
  });
});
