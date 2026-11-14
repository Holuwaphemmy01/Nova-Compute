/** Small seeded PRNG (mulberry32) for the UI's demo animations.
 *  The real job uses the Rust/WASM kernel's ChaCha PRNG; this is visuals only. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, used to turn a text seed into a number. */
export function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A short fake tx id derived from a number, e.g. "9e37…a1f2" (demo data). */
export function fakeTx(k: number): string {
  return (
    ((k * 2654435761) >>> 0).toString(16).slice(0, 4) +
    "…" +
    ((k * 40503) % 65535).toString(16).padStart(4, "0")
  );
}

export const fmt = (n: number) => n.toLocaleString("en-US");
