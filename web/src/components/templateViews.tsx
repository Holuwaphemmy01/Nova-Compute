/** Template-specific pieces of the Live job and Results pages. */
import type { AnyResult, IsingResult, Job, SirResult } from "../api/client";
import { fmt } from "../lib/random";
import { ONSAGER_TC, sirFinalSize } from "../lib/templates";
import { EpidemicCurves, FractionHistogram, MagnetizationChart, SpinGrid, SpinKey } from "./charts";

export const isIsing = (r: AnyResult | undefined): r is IsingResult => r?.template === "ising_2d";
export const isSir = (r: AnyResult | undefined): r is SirResult => r?.template === "sir_epidemic";

/** The "answer so far" tile of the Live job page. */
export function answerStat(r: AnyResult | undefined): { label: string; value: string; sub: string } {
  if (isIsing(r)) {
    return r.tc != null && r.points.length >= 3
      ? { label: "Transition so far", value: `Tc ≈ ${r.tc.toFixed(2)}`, sub: `where the susceptibility peaks · exact 2.27` }
      : { label: "Transition so far", value: "—", sub: "appears as temperatures are checked" };
  }
  if (isSir(r)) {
    return r.runs > 0
      ? { label: "Major outbreaks so far", value: `${Math.round(r.p_major * 100)}%`, sub: `of ${fmt(r.runs)} simulated outbreaks` }
      : { label: "Major outbreaks so far", value: "—", sub: "appears as pieces are checked" };
  }
  return r && "trials" in r && r.trials > 0
    ? { label: "Answer so far", value: `${(r.transmitted_fraction * 100).toFixed(1)}%`, sub: `of particles get through · ± ${(r.transmitted_std_error * 100).toFixed(2)}%` }
    : { label: "Answer so far", value: "—", sub: "appears as pieces are checked" };
}

/** Live chart that fills in as pieces are verified (Ising curve / SIR histogram). */
export function LiveChart({ result, job }: { result: AnyResult | undefined; job: Job }) {
  if (job.template === "ising_2d") {
    const pts = isIsing(result) ? result.points : [];
    const tMin = Math.min(1, Number(job.params.t_min ?? 1.5) - 0.1);
    const tMax = Math.max(4, Number(job.params.t_max ?? 3.5) + 0.1);
    return (
      <section className="in d2" aria-label="Magnetization by temperature" style={{ padding: 20, borderRadius: 24, border: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Order at each temperature</h2>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>Each point appears once two providers agree on it. Dotted: Onsager's exact curve.</span>
        <MagnetizationChart points={pts} tc={isIsing(result) && pts.length >= 3 ? result.tc : null} tMin={tMin} tMax={tMax} />
      </section>
    );
  }
  if (job.template === "sir_epidemic") {
    const bins = isSir(result) ? result.final_size_hist : new Array(64).fill(0);
    const runs = isSir(result) ? result.runs : 0;
    return (
      <section className="in d2" aria-label="Outbreak sizes" style={{ padding: 20, borderRadius: 24, border: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>How big the outbreaks got</h2>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>Grows as pieces are checked. Green: major outbreaks (over 10% of the town).</span>
        <FractionHistogram bins={bins} xLabel="Final size (share of the town ever infected)" majorFrom={0.1} label={`Final sizes of ${runs} outbreaks so far.`} />
      </section>
    );
  }
  return null;
}

/** One-line plain explanation for the Results page. */
export function explanation(r: AnyResult, job: Job): string {
  if (isIsing(r)) {
    if (r.tc == null) return "The transition appears once enough temperatures are checked.";
    const close = Math.abs(r.tc - ONSAGER_TC) <= 0.2;
    return close
      ? `The magnet loses its order near T ≈ ${r.tc.toFixed(2)}, matching Onsager's exact solution (2.27).`
      : `The magnet loses its order near T ≈ ${r.tc.toFixed(2)}; Onsager's exact value is 2.27, so try a wider range or more temperatures.`;
  }
  if (isSir(r)) {
    const share = r.major_final_size_mean != null ? `infected about ${Math.round(r.major_final_size_mean * 100)}% of the town` : "stayed small";
    const theory = sirFinalSize(Number(job.params.r0));
    return `${Math.round(r.p_major * 100)}% of outbreaks became major epidemics; those ${share} (theory: ${Math.round(theory * 100)}%), peaking around day ${Math.round(r.mean_peak_day)}.`;
  }
  return "";
}

/** The Results page chart block for Ising / SIR. */
export function TemplateResult({ result, job }: { result: AnyResult; job: Job }) {
  if (isIsing(result)) {
    return (
      <section className="in d1" style={{ borderRadius: 28, background: "var(--mint)", padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>Critical temperature (where the magnet loses its order)</span>
        <span className="num tnum" style={{ fontSize: "clamp(56px, 10vw, 96px)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.06em" }}>
          {result.tc != null ? `T ≈ ${result.tc.toFixed(2)}` : "—"}
        </span>
        <span style={{ fontSize: 15, color: "var(--mint-ink)" }}>{explanation(result, job)}</span>
        <div style={{ borderRadius: 18, background: "#FFFFFF", padding: 12 }}>
          <MagnetizationChart points={result.points} tc={result.tc} tMin={Math.min(1, Number(job.params.t_min) - 0.1)} tMax={Math.max(4, Number(job.params.t_max) + 0.1)} />
        </div>
        {result.lattice && (
          <figure style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <SpinGrid L={result.lattice.L} bits={result.lattice.bits} size={180} label={`Final spins at T = ${result.lattice.T.toFixed(2)}, the temperature nearest the transition.`} />
            <figcaption style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14, color: "var(--mint-ink)", maxWidth: 320 }}>
              <span>The magnet at T = {result.lattice.T.toFixed(2)}, closest to the transition: domains of every size.</span>
              <SpinKey />
            </figcaption>
          </figure>
        )}
      </section>
    );
  }
  if (isSir(result)) {
    const pop = Number(job.params.population) || 10_000;
    return (
      <section className="in d1" style={{ borderRadius: 28, background: "var(--mint)", padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>Chance an outbreak becomes a major epidemic</span>
        <span className="num tnum" style={{ fontSize: "clamp(56px, 10vw, 96px)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.06em" }}>{Math.round(result.p_major * 100)}%</span>
        <span style={{ fontSize: 15, color: "var(--mint-ink)" }}>{explanation(result, job)}</span>
        <div style={{ borderRadius: 18, background: "#FFFFFF", padding: 12 }}>
          <FractionHistogram bins={result.final_size_hist} xLabel="Final size (share of the town ever infected)" majorFrom={0.1} label={`Final sizes of ${result.runs} outbreaks; ${Math.round(result.p_major * 100)}% were major.`} />
        </div>
        {result.sample_curves.length > 0 && (
          <div style={{ borderRadius: 18, background: "#FFFFFF", padding: 12 }}>
            <EpidemicCurves curves={result.sample_curves} population={pop} label={`${result.sample_curves.length} example outbreaks, share of the town infected at once per day.`} />
          </div>
        )}
        <span className="mono" style={{ fontSize: 14, color: "var(--mint-ink)" }}>
          {fmt(result.runs)} outbreaks · {fmt(result.major_outbreaks)} major · mean peak day {result.mean_peak_day.toFixed(1)}
        </span>
      </section>
    );
  }
  return null;
}
