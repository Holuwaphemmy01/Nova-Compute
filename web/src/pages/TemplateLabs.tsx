/** Simulation lab panels for the Ising and SIR templates (one chunk, paced so you can watch it). */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { IsingPoint } from "../api/client";
import { EpidemicCurves, FractionHistogram, MagnetizationChart, SpinGrid, SpinKey } from "../components/charts";
import { Chips, ProgressBar, SliderLabel, btnPrimary, card } from "../components/ui";
import { createWasmKernel, isAbort, type WasmKernel } from "../kernel/wasmKernel";
import { labJobIdHex } from "../kernel/wasmRun";
import { fmt } from "../lib/random";
import { ONSAGER_TC, sirFinalSize } from "../lib/templates";

const SEED_HEX = Array.from(new TextEncoder().encode("0xNOVA2026"), (b) => b.toString(16).padStart(2, "0")).join("");

function useKernel() {
  const k = useRef<WasmKernel | null>(null);
  useEffect(() => {
    const kernel = createWasmKernel();
    k.current = kernel;
    return () => {
      kernel.dispose();
      k.current = null;
    };
  }, []);
  return k;
}

const panel: CSSProperties = { ...card, flex: "1 1 300px", minWidth: 0, gap: 24 };
const results: CSSProperties = { flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 };

function Stat({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{ padding: 18, borderRadius: 18, background: highlight ? "var(--mint)" : "var(--surface)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, color: highlight ? "var(--mint-ink)" : "var(--muted)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: highlight ? "var(--mint-ink)" : "var(--muted)" }}>{sub}</span>}
    </div>
  );
}

function Fingerprint({ hash, cta }: { hash: string; cta: string }) {
  return (
    <div className="pop" style={{ padding: "20px 22px", borderRadius: 20, border: "1px solid var(--line-soft)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: "1 1 320px" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>This run's fingerprint · SHA-256</span>
        <span className="mono" style={{ fontSize: 14, wordBreak: "break-all" }}>{hash}</span>
        <span style={{ fontSize: 13, color: "var(--faint)" }}>Same settings, same fingerprint, on any device. That's how Nova checks work.</span>
      </div>
      <Link to="/jobs/new" className="pri" style={{ ...btnPrimary, minHeight: 50, padding: "0 22px", whiteSpace: "nowrap" }}>{cta}</Link>
    </div>
  );
}

// ---------------------------------------------------------------- Ising

export function IsingLab() {
  const kernel = useKernel();
  const [T, setT] = useState(2.0);
  const [L, setL] = useState(32);
  const [running, setRunning] = useState(false);
  const [lattice, setLattice] = useState<string | null>(null);
  const [live, setLive] = useState<{ T: number; m: number } | null>(null);
  const [prog, setProg] = useState({ done: 0, total: 900, phase: "ready", meanM: null as number | null });
  const [points, setPoints] = useState<IsingPoint[]>([]);
  const [last, setLast] = useState<{ hash: string; p: IsingPoint } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const k = kernel.current;
    if (!k) return;
    setRunning(true);
    setError(null);
    setLast(null);
    const eq = 300;
    const meas = 600;
    try {
      const out = await k.runChunk(
        { template: "ising_2d", jobId: await labJobIdHex(), masterSeed: SEED_HEX, index: 0, trials: meas, params: { L, t_min: T, t_max: T, n_temps: 1, eq_sweeps: eq, meas_sweeps: meas } },
        {
          pace: { unitsPerStep: L >= 64 ? 3 : 6, intervalMs: 30 },
          onProgress: (p) => {
            setLattice(p.lattice as string);
            setLive({ T, m: Number(p.abs_m) });
            setProg({ done: p.done, total: p.total, phase: String(p.phase), meanM: p.mean_abs_m == null ? null : Number(p.mean_abs_m) });
          },
        },
      );
      const s = out.summary as { temperature: number; abs_m: number; e: number; chi: number; c: number };
      const pt = { T: s.temperature, m: s.abs_m, e: s.e, chi: s.chi, c: s.c };
      setPoints((old) => [...old.filter((q) => Math.abs(q.T - pt.T) > 1e-9), pt].sort((a, b) => a.T - b.T));
      setLast({ hash: out.hash, p: pt });
      setLive(null);
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "The simulation failed.");
    } finally {
      setRunning(false);
    }
  }

  const status = running ? (prog.phase === "equilibrating" ? "Letting the magnet settle…" : "Measuring the order…") : last ? `Done at T = ${last.p.T.toFixed(2)}` : "Ready";
  const near = Math.abs(T - ONSAGER_TC) < 0.15;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <section className="in d1" aria-label="Settings" style={panel}>
        <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SliderLabel label="Temperature" value={`T = ${T.toFixed(2)}`} />
          <input type="range" min={1} max={4} step={0.05} value={T} disabled={running} onChange={(e) => setT(Number(e.target.value))} />
          <span style={{ fontSize: 13, color: "var(--faint)" }}>{near ? "Right at the critical point (≈ 2.27): big, flickering domains." : T < ONSAGER_TC ? "Cold: the spins line up and the magnet is ordered." : "Hot: the spins point every which way."}</span>
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Grid size</span>
          <Chips label="Grid size" value={L} onChange={(v) => !running && setL(v)} options={[{ value: 16, label: "16 × 16" }, { value: 32, label: "32 × 32" }, { value: 64, label: "64 × 64" }]} />
        </div>
        <span style={{ fontSize: 13, color: "var(--faint)" }}>300 settling sweeps, then 600 measured sweeps, on the Rust kernel as WebAssembly.</span>
        <button type="button" className="pri" onClick={run} disabled={running} style={{ ...btnPrimary, minHeight: 56, fontSize: 16 }}>
          {running ? "Running…" : points.length ? "Run this temperature" : "Run simulation"}
        </button>
        {points.length > 0 && <span style={{ fontSize: 13, color: "var(--muted)" }}>Try a few temperatures: each run adds a point to the chart.</span>}
      </section>

      <section className="in d2" aria-label="Simulation" style={results}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "stretch" }}>
          <figure style={{ margin: 0, flex: "1 1 220px", minWidth: 0, padding: 16, borderRadius: 24, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <SpinGrid L={L} bits={lattice} label={`${L} by ${L} spin grid at temperature ${T.toFixed(2)}${live ? `, order ${live.m.toFixed(2)}` : ""}`} size={280} />
            <figcaption><SpinKey /></figcaption>
          </figure>
          <figure style={{ margin: 0, flex: "1 1 100%", minWidth: 0, padding: 12, borderRadius: 24, background: "var(--surface)" }}>
            <MagnetizationChart points={points} live={live} tc={null} />
          </figure>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, color: "var(--muted)" }}>
            <span role="status">{status}</span>
            <span className="mono">{fmt(prog.done)} / {fmt(prog.total)} sweeps</span>
          </div>
          <ProgressBar value={(100 * prog.done) / Math.max(1, prog.total)} label="Simulation progress" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Stat label="Order now" value={live ? live.m.toFixed(3) : last ? last.p.m.toFixed(3) : "—"} sub="|m|, 0 = random, 1 = aligned" highlight />
          <Stat label="Average order" value={last ? last.p.m.toFixed(3) : prog.meanM != null ? prog.meanM.toFixed(3) : "—"} sub="⟨|m|⟩ over measured sweeps" />
          <Stat label="Susceptibility" value={last ? last.p.chi.toFixed(2) : "—"} sub="χ peaks at the transition" />
          <Stat label="Heat capacity" value={last ? last.p.c.toFixed(2) : "—"} sub="C per spin" />
        </div>
        {error && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
        {last && !running && <Fingerprint hash={last.hash} cta="Sweep 16 temperatures on Nova →" />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- SIR

export function SirLab() {
  const kernel = useKernel();
  const [r0, setR0] = useState(2.5);
  const [population, setPopulation] = useState(10_000);
  const [days, setDays] = useState(7);
  const [runs, setRuns] = useState(200);
  const [running, setRunning] = useState(false);
  const [curves, setCurves] = useState<number[][]>([]);
  const [hist, setHist] = useState<number[]>(new Array(64).fill(0));
  const [prog, setProg] = useState({ done: 0, total: 200, majors: 0 });
  const [last, setLast] = useState<{ hash: string; meanPeakDay: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const k = kernel.current;
    if (!k) return;
    setRunning(true);
    setError(null);
    setLast(null);
    setCurves([]);
    setHist(new Array(64).fill(0));
    try {
      const out = await k.runChunk(
        { template: "sir_epidemic", jobId: await labJobIdHex(), masterSeed: SEED_HEX, index: 0, trials: runs, params: { population, initial_infected: 10, r0, recovery_days: days, runs_per_chunk: runs } },
        {
          pace: { unitsPerStep: Math.max(1, Math.round(runs / 50)), intervalMs: 40 },
          onProgress: (p) => {
            const fresh = (p.sample_curves as number[][]) ?? [];
            if (fresh.length) setCurves((old) => [...old, ...fresh].slice(-40));
            setHist(p.final_size_hist as number[]);
            setProg({ done: p.done, total: p.total, majors: Number(p.majors) });
          },
        },
      );
      const s = out.summary as { sum_peak_days: number; runs: number };
      setLast({ hash: out.hash, meanPeakDay: s.sum_peak_days / Math.max(1, s.runs) });
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "The simulation failed.");
    } finally {
      setRunning(false);
    }
  }

  const pMajor = prog.done ? prog.majors / prog.done : 0;
  const theory = sirFinalSize(r0);
  const majorBins = hist.map((c, i) => ((i + 0.5) / 64 > 0.1 ? c : 0));
  const majorRuns = majorBins.reduce((a, b) => a + b, 0);
  const majorMean = majorRuns ? majorBins.reduce((s, c, i) => s + c * ((i + 0.5) / 64), 0) / majorRuns : null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <section className="in d1" aria-label="Settings" style={panel}>
        <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SliderLabel label="How contagious (R₀)" value={r0.toFixed(1)} />
          <input type="range" min={0.5} max={6} step={0.1} value={r0} disabled={running} onChange={(e) => setR0(Number(e.target.value))} />
          <span style={{ fontSize: 13, color: "var(--faint)" }}>Each sick person infects about {r0.toFixed(1)} others in a fully susceptible town.</span>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SliderLabel label="Days someone stays infectious" value={`${days} days`} />
          <input type="range" min={3} max={21} step={1} value={days} disabled={running} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Town size</span>
          <Chips label="Town size" value={population} onChange={(v) => !running && setPopulation(v)} options={[{ value: 1_000, label: "1,000" }, { value: 10_000, label: "10,000" }]} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Outbreaks to simulate</span>
          <Chips label="Outbreaks" value={runs} onChange={(v) => !running && setRuns(v)} options={[{ value: 50, label: "50" }, { value: 200, label: "200" }]} />
        </div>
        <span style={{ fontSize: 13, color: "var(--faint)" }}>Each outbreak starts with 10 cases and is simulated person by person (Gillespie), on the Rust kernel as WebAssembly.</span>
        <button type="button" className="pri" onClick={run} disabled={running} style={{ ...btnPrimary, minHeight: 56, fontSize: 16 }}>
          {running ? "Running…" : last ? "Run again" : "Run simulation"}
        </button>
      </section>

      <section className="in d2" aria-label="Simulation" style={results}>
        <figure style={{ margin: 0, padding: 12, borderRadius: 24, background: "var(--surface)" }}>
          <EpidemicCurves curves={curves} population={population} label={`${curves.length} simulated outbreaks, share of the town infected at once per day; newest in green.`} />
        </figure>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, color: "var(--muted)" }}>
            <span role="status">{running ? "Simulating outbreaks…" : last ? "Done" : "Ready"}</span>
            <span className="mono">{fmt(prog.done)} / {fmt(prog.total)} outbreaks</span>
          </div>
          <ProgressBar value={(100 * prog.done) / Math.max(1, prog.total)} label="Simulation progress" />
        </div>
        <figure style={{ margin: 0, padding: 12, borderRadius: 24, background: "var(--surface)" }}>
          <FractionHistogram bins={hist} xLabel="Final size (share of the town ever infected)" majorFrom={0.1} label={`Final sizes of ${prog.done} outbreaks; ${Math.round(pMajor * 100)}% became major (over 10% of the town).`} />
        </figure>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Stat label="Became a major outbreak" value={prog.done ? `${Math.round(pMajor * 100)}%` : "—"} sub="over 10% of the town infected" highlight />
          <Stat label="Size of major outbreaks" value={majorMean != null ? `${Math.round(majorMean * 100)}%` : "—"} sub={`theory ${Math.round(theory * 100)}% of the town`} />
          <Stat label="Peak day (average)" value={last ? last.meanPeakDay.toFixed(0) : "—"} sub="when the most were sick at once" />
        </div>
        {error && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
        {last && !running && <Fingerprint hash={last.hash} cta="Run 4,000 outbreaks on Nova →" />}
      </section>
    </div>
  );
}
