/** Simulation templates offered in the app (kernel/src/templates, docs/api.md). */

export type TemplateId = "neutron_slab" | "ising_2d" | "sir_epidemic";

export interface TemplateCard {
  id: TemplateId | "option_pricing";
  title: string;
  blurb: string;
  enabled: boolean;
}

export const TEMPLATE_CARDS: TemplateCard[] = [
  { id: "neutron_slab", title: "Particles through a wall", blurb: "How many get through a shield?", enabled: true },
  { id: "ising_2d", title: "Magnet phase transition", blurb: "Where does a magnet lose its order?", enabled: true },
  { id: "sir_epidemic", title: "Epidemic outbreaks", blurb: "How big do outbreaks get?", enabled: true },
  { id: "option_pricing", title: "Option pricing", blurb: "Coming soon", enabled: false },
];

/** Onsager's exact critical temperature of the 2D Ising model, 2 / ln(1 + √2). */
export const ONSAGER_TC = 2 / Math.log(1 + Math.SQRT2);

/** Onsager/Yang spontaneous magnetization (infinite lattice): (1 − sinh⁻⁴(2/T))^(1/8) below Tc, 0 above. */
export function onsagerM(t: number): number {
  if (t >= ONSAGER_TC) return 0;
  const s = Math.sinh(2 / t);
  return Math.pow(1 - Math.pow(s, -4), 1 / 8);
}

/** Deterministic SIR final size z = 1 − exp(−r0·z) (the large-population limit). */
export function sirFinalSize(r0: number): number {
  if (r0 <= 1) return 0;
  let z = 0.9;
  for (let i = 0; i < 200; i++) z = 1 - Math.exp(-r0 * z);
  return z;
}

export interface IsingParams {
  L: number;
  t_min: number;
  t_max: number;
  eq_sweeps: number;
  meas_sweeps: number;
  n_temps?: number;
}

export interface SirParams {
  population: number;
  initial_infected: number;
  r0: number;
  recovery_days: number;
  runs_per_chunk: number;
}

export const ISING_DEFAULTS: IsingParams = { L: 32, t_min: 1.5, t_max: 3.5, eq_sweeps: 1000, meas_sweeps: 2000 };
export const SIR_DEFAULTS: SirParams = { population: 10_000, initial_infected: 10, r0: 2.5, recovery_days: 7, runs_per_chunk: 200 };

/** Unpacks the kernel's lattice bits (hex, L·L bits row-major, LSB-first per byte; 1 = +1). */
export function unpackLattice(hex: string, L: number): Uint8Array {
  const out = new Uint8Array(L * L);
  for (let i = 0; i < L * L; i++) {
    const byte = parseInt(hex.slice((i >> 3) * 2, (i >> 3) * 2 + 2), 16);
    out[i] = (byte >> (i & 7)) & 1;
  }
  return out;
}

/** Short human title for a job of any template. */
export function templateTitle(template: string | undefined, params: Record<string, unknown>): string {
  if (template === "ising_2d") return `Magnet phase transition, ${params.L}×${params.L} grid`;
  if (template === "sir_epidemic") return `Epidemic outbreaks, R₀ ${Number(params.r0).toFixed(1)}`;
  return `Particles through a ${params.thickness_cm} cm wall`;
}
