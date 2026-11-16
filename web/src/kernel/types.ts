/**
 * The simulation-kernel contract. The UI depends ONLY on these types; the
 * implementation is the Rust kernel (kernel/) compiled to WASM, see ./wasmKernel.
 */

export type Fate = "transmitted" | "reflected" | "absorbed";

/** Path of one sampled particle, in cm. Starts at (0, 0); x runs through the wall. */
export interface Track {
  fate: Fate;
  pts: [number, number][];
}

export interface SimParams {
  thicknessCm: number; // slab thickness L
  mfpCm: number; // mean free path between collisions
  absorbProb: number; // probability of absorption per collision, 0..1
  particles: number;
  seed: string;
}

export interface SimProgress {
  done: number;
  transmitted: number;
  reflected: number;
  absorbed: number;
  /** Paths of up to a few particles simulated since the last progress report. */
  sampleTracks: Track[];
  /** Time spent computing so far, excluding pauses between batches. */
  computeMs: number;
}

export interface SimResult extends SimProgress {
  /** The kernel's chunk hash: hex SHA-256 of job_id ‖ index ‖ canonical output bytes. */
  fingerprint: string;
  /** Total compute time in ms. */
  ms: number;
}

export interface RunOptions {
  onProgress?: (progress: SimProgress) => void;
  signal?: AbortSignal;
}

export interface SimKernel {
  /** Human-readable name of what actually runs the physics, shown to the user. */
  readonly name: string;
  run(params: SimParams, options?: RunOptions): Promise<SimResult>;
}
