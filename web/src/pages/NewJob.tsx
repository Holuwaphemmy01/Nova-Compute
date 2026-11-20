import { useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, humanError, type CreateJobRequest } from "../api/client";
import { EpidemicCurves, SpinGrid } from "../components/charts";
import { AppHeader } from "../components/Headers";
import { Notice } from "../components/Notice";
import { TemplatePicker } from "../components/TemplatePicker";
import { Chips, SliderLabel, Spinner, btnPrimary } from "../components/ui";
import { chunkValue } from "../config/env";
import { fmt } from "../lib/random";
import { ISING_DEFAULTS, SIR_DEFAULTS, sirFinalSize, type TemplateId } from "../lib/templates";
import { usePoll } from "../lib/usePoll";
import { FundPanel } from "../wallet/FundPanel";
import { useWalletState } from "../wallet/store";

const PARTICLES_PER_PIECE = 10_000;
const PRICE = 1200; // sats per worker per piece
const RUNS_PER_PIECE = 200;

const PRECISION = {
  quick: { eq_sweeps: 500, meas_sweeps: 1000 },
  standard: { eq_sweeps: ISING_DEFAULTS.eq_sweeps, meas_sweeps: ISING_DEFAULTS.meas_sweeps },
  precise: { eq_sweeps: 2000, meas_sweeps: 5000 },
} as const;
type Precision = keyof typeof PRECISION;

/** Deterministic preview lattice: ordered on the left, noisy on the right (illustration only). */
function previewLattice(L: number) {
  const a = new Uint8Array(L * L);
  for (let r = 0; r < L; r++) for (let c = 0; c < L; c++) a[r * L + c] = c < L / 2 ? 1 : ((r * 31 + c * 17 + r * c) % 5) % 2;
  return a;
}

/** Illustrative deterministic SIR curve for the preview (not a simulation). */
function previewCurve(r0: number, days: number) {
  const beta = r0 / days;
  const gamma = 1 / days;
  let s = 0.999;
  let i = 0.001;
  const out: number[] = [];
  for (let d = 0; d < 180; d++) {
    out.push(i * 10_000);
    for (let k = 0; k < 10; k++) {
      const inf = beta * s * i * 0.1;
      const rec = gamma * i * 0.1;
      s -= inf;
      i += inf - rec;
    }
  }
  return out;
}

export default function NewJob() {
  const wallet = useWalletState();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<TemplateId>("neutron_slab");
  // neutron
  const [thickness, setThickness] = useState(10);
  const [particles, setParticles] = useState(2_000_000);
  // Ising
  const [temps, setTemps] = useState(16);
  const [L, setL] = useState(ISING_DEFAULTS.L);
  const [tMin, setTMin] = useState(ISING_DEFAULTS.t_min);
  const [tMax, setTMax] = useState(ISING_DEFAULTS.t_max);
  const [precision, setPrecision] = useState<Precision>("standard");
  // SIR
  const [population, setPopulation] = useState(SIR_DEFAULTS.population);
  const [r0, setR0] = useState(SIR_DEFAULTS.r0);
  const [days, setDays] = useState(SIR_DEFAULTS.recovery_days);
  const [firstCases, setFirstCases] = useState(SIR_DEFAULTS.initial_infected);
  const [outbreaks, setOutbreaks] = useState(4_000);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = usePoll((s) => api.getJob(jobId!, s), 3000, [jobId], !!jobId);
  const locked = !!jobId;

  const chunks = template === "ising_2d" ? temps : template === "sir_epidemic" ? Math.ceil(outbreaks / RUNS_PER_PIECE) : Math.ceil(particles / PARTICLES_PER_PIECE);
  const perChunk = chunkValue(PRICE);
  const total = chunks * perChunk;
  const pieceWord = template === "ising_2d" ? "temperatures" : "pieces";

  function request(): CreateJobRequest {
    if (template === "ising_2d") {
      return { template, params: { L, t_min: tMin, t_max: tMax, ...PRECISION[precision] }, chunk_count: chunks, price_per_worker: PRICE };
    }
    if (template === "sir_epidemic") {
      return { template, params: { population, initial_infected: firstCases, r0, recovery_days: days, runs_per_chunk: RUNS_PER_PIECE }, chunk_count: chunks, price_per_worker: PRICE };
    }
    return { template, params: { thickness_cm: thickness, mfp_cm: 3, absorb_prob: 0.18 }, chunk_count: chunks, trials_per_chunk: PARTICLES_PER_PIECE, price_per_worker: PRICE };
  }

  async function create() {
    if (!wallet.address) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createJob(wallet.address, request());
      setJobId(created.job_id);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setCreating(false);
    }
  }

  const wallW = 20 + thickness * 12;
  const zip = (d: number, delay = 0): CSSProperties => ({ ["--d" as string]: `${d}px`, animationDelay: `${delay}s` });
  const intro =
    template === "ising_2d"
      ? "Where does a magnet lose its order? Each temperature is one piece of work."
      : template === "sir_epidemic"
        ? "How big do outbreaks get in a town? Thousands of simulated outbreaks, 200 per piece."
        : "How many particles get through a wall? Set it up in under a minute.";

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>New simulation</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>{intro}</p>
        </div>

        <div className="in d1">
          <TemplatePicker value={template} onChange={setTemplate} disabled={locked} />
        </div>

        <div className="in d1" style={{ borderRadius: 24, background: "var(--surface)", overflow: "hidden", padding: template === "neutron_slab" ? 0 : 16, display: "flex", justifyContent: "center" }}>
          {template === "ising_2d" ? (
            <SpinGrid L={L} bits={previewLattice(L)} label={`Preview: a ${L} by ${L} grid of magnetic spins, ordered on one side and disordered on the other.`} size={200} />
          ) : template === "sir_epidemic" ? (
            <div style={{ width: "100%" }}>
              <EpidemicCurves curves={[previewCurve(r0, days)]} population={10_000} label={`Preview: the typical shape of an outbreak with R0 ${r0.toFixed(1)}.`} />
            </div>
          ) : (
            <svg viewBox="0 0 640 170" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label={`Preview of a ${thickness} cm wall`}>
              <rect className="wall" x={320 - wallW / 2} y="20" width={wallW} height="130" rx="8" fill="#E6E6E2" stroke="#16161A" strokeWidth="2" />
              <g fill="#16161A">
                <circle className="zip" cx="40" cy="60" r="4" style={zip(220)} />
                <circle className="zip" cx="40" cy="90" r="4" style={zip(260, 0.7)} />
                <circle className="zip" cx="40" cy="120" r="4" style={zip(240, 1.4)} />
              </g>
              <g fill="#0AC18E">
                <circle className="zip" cx="40" cy="75" r="4.5" style={zip(560, 0.35)} />
                <circle className="zip" cx="40" cy="105" r="4.5" style={zip(560, 1.1)} />
              </g>
            </svg>
          )}
        </div>

        <section className="in d2" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {template === "neutron_slab" && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SliderLabel label="Wall thickness" value={`${thickness} cm`} size={16} />
                <input type="range" min={1} max={20} step={1} value={thickness} disabled={locked} onChange={(e) => setThickness(Number(e.target.value))} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Particles</span>
                <Chips label="Particles" size="lg" value={particles} onChange={(v) => !locked && setParticles(v)} options={[{ value: 40_000, label: "40k" }, { value: 500_000, label: "500k" }, { value: 2_000_000, label: "2 million" }, { value: 5_000_000, label: "5 million" }]} />
                <span style={{ fontSize: 14, color: "var(--muted)" }}>More particles means a more precise answer.</span>
              </div>
            </>
          )}

          {template === "ising_2d" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Temperatures to test</span>
                <Chips label="Temperatures" size="lg" value={temps} onChange={(v) => !locked && setTemps(v)} options={[{ value: 8, label: "8" }, { value: 16, label: "16" }, { value: 32, label: "32" }]} />
                <span style={{ fontSize: 14, color: "var(--muted)" }}>Evenly spaced from the cold end to the hot end. More points pin down the transition.</span>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SliderLabel label="Coldest temperature" value={`T = ${tMin.toFixed(1)}`} size={16} />
                <input type="range" min={1} max={2.2} step={0.1} value={tMin} disabled={locked} onChange={(e) => setTMin(Number(e.target.value))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SliderLabel label="Hottest temperature" value={`T = ${tMax.toFixed(1)}`} size={16} />
                <input type="range" min={2.4} max={4.5} step={0.1} value={tMax} disabled={locked} onChange={(e) => setTMax(Number(e.target.value))} />
                <span style={{ fontSize: 14, color: "var(--muted)" }}>The magnet should lose its order near T ≈ 2.27 (in units of J/k_B).</span>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Grid size</span>
                <Chips label="Grid size" size="lg" value={L} onChange={(v) => !locked && setL(v)} options={[{ value: 16, label: "16 × 16" }, { value: 32, label: "32 × 32" }, { value: 64, label: "64 × 64" }]} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Precision</span>
                <div role="group" aria-label="Precision" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["quick", "standard", "precise"] as Precision[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="chip"
                      aria-pressed={precision === p}
                      onClick={() => !locked && setPrecision(p)}
                      style={{ minHeight: 46, padding: "0 20px", borderRadius: 999, fontWeight: 600, fontSize: 15, background: precision === p ? "var(--ink)" : "#FFFFFF", color: precision === p ? "#FFFFFF" : "var(--ink)", border: `1px solid ${precision === p ? "var(--ink)" : "var(--chip-border)"}` }}
                    >
                      {p[0].toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>{fmt(PRECISION[precision].eq_sweeps)} settling + {fmt(PRECISION[precision].meas_sweeps)} measured sweeps per temperature.</span>
              </div>
            </>
          )}

          {template === "sir_epidemic" && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SliderLabel label="How contagious (R₀)" value={r0.toFixed(1)} size={16} />
                <input type="range" min={0.5} max={6} step={0.1} value={r0} disabled={locked} onChange={(e) => setR0(Number(e.target.value))} />
                <span style={{ fontSize: 14, color: "var(--muted)" }}>
                  {r0 <= 1 ? "Below 1, outbreaks fizzle out." : `A big outbreak would reach about ${Math.round(sirFinalSize(r0) * 100)}% of the town.`}
                </span>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SliderLabel label="Days someone stays infectious" value={`${days} days`} size={16} />
                <input type="range" min={2} max={21} step={1} value={days} disabled={locked} onChange={(e) => setDays(Number(e.target.value))} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Town size</span>
                <Chips label="Town size" size="lg" value={population} onChange={(v) => !locked && setPopulation(v)} options={[{ value: 1_000, label: "1,000" }, { value: 10_000, label: "10,000" }, { value: 100_000, label: "100,000" }]} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>First cases</span>
                <Chips label="First cases" size="lg" value={firstCases} onChange={(v) => !locked && setFirstCases(v)} options={[{ value: 1, label: "1" }, { value: 10, label: "10" }, { value: 100, label: "100" }]} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>Outbreaks to simulate</span>
                <Chips label="Outbreaks" size="lg" value={outbreaks} onChange={(v) => !locked && setOutbreaks(v)} options={[{ value: 800, label: "800" }, { value: 4_000, label: "4,000" }, { value: 20_000, label: "20,000" }]} />
                <span style={{ fontSize: 14, color: "var(--muted)" }}>More outbreaks give a smoother picture of how often things go badly.</span>
              </div>
            </>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 22, borderRadius: 20, border: "1px solid var(--line)" }}>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>
              {fmt(chunks)} {pieceWord} × 2 providers × {fmt(PRICE)} sats, plus {fmt(perChunk - 2 * PRICE)} sats network fee each
            </span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Total</span>
              <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
                {fmt(total)} <span style={{ fontSize: 15, color: "var(--muted)", fontWeight: 500 }}>sats</span>
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--faint)" }}>Anything unused comes back to your wallet.</span>
          </div>

          {!wallet.address ? (
            <Notice title="Connect your wallet to fund this job" action={{ to: "/connect?role=researcher", label: "Connect wallet" }}>
              The escrow is funded from your wallet, and unused funds return to it.
            </Notice>
          ) : !jobId ? (
            <button type="button" className="pri" onClick={create} disabled={creating} style={{ ...btnPrimary, minHeight: 58, fontSize: 17 }}>
              {creating ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <Spinner /> Setting up the escrow…
                </span>
              ) : (
                "Fund and start"
              )}
            </button>
          ) : job.data ? (
            <FundPanel job={job.data} onFunded={() => navigate(`/jobs/${jobId}`)} />
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
              <Spinner /> Preparing the escrow…
            </span>
          )}
          {error && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
        </section>
      </main>
    </div>
  );
}
