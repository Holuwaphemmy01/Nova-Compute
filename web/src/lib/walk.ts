/** Particle random walk through a slab, used to draw the illustrative tracks.
 *  Mirrors the physics the WASM kernel will compute, in plain floating point. */

export type Fate = "t" | "r" | "a"; // transmitted, reflected, absorbed

export interface Track {
  id: number;
  pts: [number, number][] | null;
  fate: Fate;
}

export interface WalkOptions {
  thickness: number; // slab thickness L
  mfp: number; // mean free path
  absorb: number; // absorption probability per collision (0..1)
  y0: number; // vertical centre of entry
  spread: number; // vertical spread of entry
  entry: number; // length of the incoming ray drawn before the wall
  exit: number; // length of the outgoing ray after transmission
  back: number; // length of the outgoing ray after reflection
  maxSteps: number;
  keep: boolean; // record points for drawing
}

let nextId = 1;

export function walk(rand: () => number, o: WalkOptions): Track {
  const L = o.thickness;
  let x = 0;
  let y = o.y0 + (rand() - 0.5) * o.spread;
  let th = (rand() - 0.5) * Math.PI * 0.9;
  const pts: [number, number][] | null = o.keep
    ? [[-o.entry, y - Math.tan(th) * o.entry], [0, y]]
    : null;
  let fate: Fate = "a";
  for (let k = 0; k < o.maxSteps; k++) {
    const d = -Math.log(1 - rand()) * o.mfp;
    const nx = x + Math.cos(th) * d;
    const ny = y + Math.sin(th) * d;
    if (nx >= L) {
      if (pts) {
        const yy = y + (ny - y) * ((L - x) / (nx - x));
        pts.push([L, yy], [L + o.exit, yy + Math.tan(th) * o.exit]);
      }
      fate = "t";
      break;
    }
    if (nx <= 0) {
      if (pts) {
        const yy = y + (ny - y) * (-x / (nx - x));
        pts.push([0, yy], [-o.back, yy - Math.tan(th) * o.back]);
      }
      fate = "r";
      break;
    }
    x = nx;
    y = ny;
    pts?.push([x, y]);
    if (rand() < o.absorb) break;
    th = rand() * Math.PI * 2;
  }
  return { id: nextId++, pts, fate };
}
