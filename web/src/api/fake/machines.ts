/**
 * In-memory fake of the Machines API, same shapes as the real coordinator.
 * Earnings are computed lazily from the clock on each read, so the fake needs no timers
 * and tests can drive it with an injected clock.
 */
import { ApiError } from "../errors";
import type { GpuLimit, Machine, MachinePatch, MachinesApi, PairCode } from "../machines";

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
export const SATS_PER_PIECE = 1200;
/** Time to finish one piece at 100% GPU; slower at lower limits. */
export const BASE_PIECE_MS = 3000;
const BASE_SPEED = 1_475_000; // particles/s at 100%

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

interface Entry {
  machine: Machine;
  lastTick: number;
  carry: number; // ms of progress towards the next piece
}

export interface FakeOptions {
  now?: () => number;
  random?: () => number;
  latencyMs?: number;
}

const LIMITS: GpuLimit[] = [50, 80, 100];

export function createFakeMachinesApi({
  now = () => Date.now(),
  random = Math.random,
  latencyMs = 120,
}: FakeOptions = {}): MachinesApi & { simulatePairing(): Promise<Machine> } {
  const entries = new Map<string, Entry>();
  let counter = 0;

  const delay = () => (latencyMs > 0 ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());
  const iso = (t: number) => new Date(t).toISOString();
  const copy = (m: Machine): Machine => ({ ...m });

  function speed(limit: GpuLimit, t: number) {
    const wobble = 1 + 0.04 * Math.sin(t / 1300) + 0.015 * Math.sin(t / 370);
    return Math.round(((BASE_SPEED * limit) / 100) * wobble);
  }

  /** Brings a machine's counters up to time t. */
  function advance(e: Entry, t: number) {
    const m = e.machine;
    if (m.status === "online") {
      const pieceMs = (BASE_PIECE_MS * 100) / m.gpu_limit;
      const elapsed = Math.max(0, t - e.lastTick) + e.carry;
      const pieces = Math.floor(elapsed / pieceMs);
      e.carry = elapsed - pieces * pieceMs;
      m.pieces_finished += pieces;
      m.earned_sats += pieces * SATS_PER_PIECE;
      m.particles_per_sec = speed(m.gpu_limit, t);
      m.last_seen = iso(t);
    } else {
      m.particles_per_sec = 0;
    }
    e.lastTick = t;
  }

  function get(id: string): Entry {
    const e = entries.get(id);
    if (!e) throw new ApiError(404, `Machine ${id} not found`);
    return e;
  }

  return {
    async createPairCode(): Promise<PairCode> {
      await delay();
      let suffix = "";
      for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
      return { code: `NOVA-${suffix}`, expires_at: iso(now() + PAIR_CODE_TTL_MS) };
    },

    async listMachines() {
      await delay();
      const t = now();
      return [...entries.values()].map((e) => {
        advance(e, t);
        return copy(e.machine);
      });
    },

    async updateMachine(id: string, patch: MachinePatch) {
      await delay();
      const e = get(id);
      const t = now();
      advance(e, t);
      if (patch.gpu_limit !== undefined) {
        if (!LIMITS.includes(patch.gpu_limit)) throw new ApiError(400, "gpu_limit must be 50, 80 or 100");
        e.machine.gpu_limit = patch.gpu_limit;
      }
      if (patch.paused !== undefined && e.machine.status !== "offline") {
        e.machine.status = patch.paused ? "paused" : "online";
        e.carry = 0;
      }
      advance(e, t); // refresh speed for the new state
      return copy(e.machine);
    },

    async removeMachine(id: string) {
      await delay();
      get(id);
      entries.delete(id);
    },

    async simulatePairing() {
      await delay();
      const t = now();
      counter++;
      const id = `m_${counter}_${Math.floor(random() * 0xffffff).toString(16)}`;
      const machine: Machine = {
        id,
        name: "[MACHINE NAME]",
        gpu: "[GPU MODEL]",
        vram_gb: 8,
        backend: "vulkan",
        status: "online",
        self_test: "passed",
        particles_per_sec: speed(80, t),
        pieces_finished: 0,
        earned_sats: 0,
        gpu_limit: 80,
        last_seen: iso(t),
      };
      entries.set(id, { machine, lastTick: t, carry: 0 });
      return copy(machine);
    },
  };
}
