/**
 * TEMPORARY TypeScript reference kernel. To be replaced by the Rust kernel compiled
 * to WebAssembly; keep the behaviour behind the SimKernel interface in ./types.
 *
 * Physics: 2D slab of thickness L. Each particle starts at x = 0 heading into the
 * wall (+x). Step length = -ln(u) * mfp. After a step: x >= L -> transmitted,
 * x <= 0 -> reflected; otherwise absorbed with probability absorbProb, else it
 * scatters in a uniformly random direction. At most MAX_STEPS steps per particle.
 */
import {
  MAX_STEPS,
  type Fate,
  type RunOptions,
  type SimKernel,
  type SimParams,
  type SimProgress,
  type SimResult,
  type Track,
} from "./types";

export const KERNEL_NAME = "TypeScript reference kernel";

const utf8 = new TextEncoder();

/** 32-bit FNV-1a over bytes. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32: small, fast, seedable 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG seed derived from the seed string and every physics parameter. */
export function seedFor(p: SimParams): number {
  return fnv1a(utf8.encode(`${p.seed}|${p.thicknessCm}|${p.mfpCm}|${p.absorbProb}|${p.particles}`));
}

/** Stateful run that can be advanced in batches; batching never changes the result. */
export class Simulation {
  done = 0;
  transmitted = 0;
  reflected = 0;
  absorbed = 0;
  readonly params: SimParams;
  private readonly rand: () => number;

  constructor(params: SimParams) {
    validate(params);
    this.params = params;
    this.rand = mulberry32(seedFor(params));
  }

  get finished(): boolean {
    return this.done >= this.params.particles;
  }

  /** Simulates up to `n` more particles. The first `sample` of them record their paths. */
  step(n: number, sample = 0): Track[] {
    const tracks: Track[] = [];
    const end = Math.min(this.params.particles, this.done + n);
    for (let i = 0; this.done < end; i++) {
      const track = this.particle(i < sample);
      if (track.pts.length) tracks.push(track);
    }
    return tracks;
  }

  private particle(record: boolean): Track {
    const { thicknessCm: L, mfpCm, absorbProb } = this.params;
    const rand = this.rand;
    let x = 0;
    let y = 0;
    let theta = (rand() - 0.5) * Math.PI; // heading into the wall
    const pts: [number, number][] = record ? [[0, 0]] : [];
    let fate: Fate = "absorbed"; // also the outcome if MAX_STEPS is reached

    for (let k = 0; k < MAX_STEPS; k++) {
      const d = -Math.log(1 - rand()) * mfpCm; // 1 - u is in (0, 1], so d is finite
      const nx = x + Math.cos(theta) * d;
      const ny = y + Math.sin(theta) * d;
      if (nx >= L) {
        if (record) pts.push([L, y + (ny - y) * ((L - x) / (nx - x))]);
        fate = "transmitted";
        break;
      }
      if (nx <= 0) {
        if (record) pts.push([0, y + (ny - y) * (-x / (nx - x))]);
        fate = "reflected";
        break;
      }
      x = nx;
      y = ny;
      if (record) pts.push([x, y]);
      if (rand() < absorbProb) break;
      theta = rand() * 2 * Math.PI;
    }

    this.done++;
    if (fate === "transmitted") this.transmitted++;
    else if (fate === "reflected") this.reflected++;
    else this.absorbed++;
    return { fate, pts };
  }
}

function validate(p: SimParams) {
  const ok =
    p.thicknessCm > 0 &&
    p.mfpCm > 0 &&
    p.absorbProb >= 0 &&
    p.absorbProb <= 1 &&
    Number.isInteger(p.particles) &&
    p.particles >= 0 &&
    p.particles <= 0xffffffff;
  if (!ok) throw new RangeError(`Invalid simulation params: ${JSON.stringify(p)}`);
}

/**
 * SHA-256 over a canonical byte string, so any kernel (TS or Rust) can reproduce it:
 *   "NOVALAB1"  8 ASCII bytes
 *   u32 LE      byte length of seed, then the seed as UTF-8
 *   f64 LE      thicknessCm, mfpCm, absorbProb
 *   u32 LE      particles, transmitted, reflected, absorbed
 */
export async function fingerprint(
  p: SimParams,
  c: { transmitted: number; reflected: number; absorbed: number },
): Promise<string> {
  const magic = utf8.encode("NOVALAB1");
  const seed = utf8.encode(p.seed);
  const buf = new Uint8Array(magic.length + 4 + seed.length + 3 * 8 + 4 * 4);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set(magic, o);
  o += magic.length;
  view.setUint32(o, seed.length, true);
  o += 4;
  buf.set(seed, o);
  o += seed.length;
  for (const f of [p.thicknessCm, p.mfpCm, p.absorbProb]) {
    view.setFloat64(o, f, true);
    o += 8;
  }
  for (const u of [p.particles, c.transmitted, c.reflected, c.absorbed]) {
    view.setUint32(o, u, true);
    o += 4;
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PacingOptions {
  /** How many progress steps to split the run into. */
  batches?: number;
  /** Pause between batches so the run is visible and stays cancellable. */
  intervalMs?: number;
  /** Particles per batch that record their paths for drawing. */
  samplesPerBatch?: number;
}

const abortError = () => new DOMException("Simulation cancelled", "AbortError");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs a whole simulation in batches, reporting progress after each one. */
export async function runSimulation(
  params: SimParams,
  { onProgress, signal, batches = 60, intervalMs = 40, samplesPerBatch = 2 }: RunOptions & PacingOptions = {},
): Promise<SimResult> {
  const sim = new Simulation(params);
  const perBatch = Math.max(1, Math.ceil(params.particles / batches));
  let computeMs = 0;
  const snapshot = (sampleTracks: Track[]): SimProgress => ({
    done: sim.done,
    transmitted: sim.transmitted,
    reflected: sim.reflected,
    absorbed: sim.absorbed,
    sampleTracks,
    computeMs,
  });

  while (!sim.finished) {
    if (signal?.aborted) throw abortError();
    const t0 = performance.now();
    const tracks = sim.step(perBatch, samplesPerBatch);
    computeMs += performance.now() - t0;
    onProgress?.(snapshot(tracks));
    if (!sim.finished && intervalMs > 0) await sleep(intervalMs);
  }
  if (signal?.aborted) throw abortError();

  const fp = await fingerprint(params, sim);
  return { ...snapshot([]), fingerprint: fp, ms: computeMs };
}

/** In-thread kernel (used by tests; the page uses the worker-backed kernel). */
export const tsKernel: SimKernel = {
  name: KERNEL_NAME,
  run: (params, options) => runSimulation(params, options),
};
