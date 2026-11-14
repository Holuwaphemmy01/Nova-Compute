import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "../components/Headers";
import { Tracks } from "../components/Tracks";
import { Chips, ProgressBar, Segmented, SliderLabel, btnPrimary, card } from "../components/ui";
import { fmt, fnv1a, mulberry32 } from "../lib/random";
import { walk, type Track } from "../lib/walk";

type Device = "gpu" | "cpu";

interface Run {
  running: boolean;
  finished: boolean;
  done: number;
  t: number;
  r: number;
  a: number;
  tracks: Track[];
  rate: number;
  fingerprint: string;
}

const IDLE: Run = { running: false, finished: false, done: 0, t: 0, r: 0, a: 0, tracks: [], rate: 0, fingerprint: "" };

/** Order-independent fingerprint of the tallies (stand-in for the kernel's SHA-256). */
function fingerprint(vals: number[]): string {
  let h = 2166136261;
  for (const v of vals)
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (k * 8)) & 255;
      h = Math.imul(h, 16777619) >>> 0;
    }
  const h2 = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export default function Lab() {
  const [thickness, setThickness] = useState(10);
  const [mfp, setMfp] = useState(3);
  const [absorb, setAbsorb] = useState(18);
  const [particles, setParticles] = useState(10_000);
  const [device, setDevice] = useState<Device>("gpu");
  const [seed, setSeed] = useState("0xNOVA2026");
  const [run, setRun] = useState<Run>(IDLE);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);

  // Changing any input invalidates a finished result.
  const invalidate = () => setRun((r) => (r.finished ? { ...r, finished: false } : r));

  function start() {
    clearInterval(timer.current);
    // TODO(kernel): run the Rust/WASM kernel (WebGPU or CPU) instead of this JS walk.
    const rand = mulberry32(fnv1a(`${seed}|${thickness}|${mfp}|${absorb}`));
    const opts = { thickness, mfp, absorb: absorb / 100, y0: 0, spread: 2, entry: thickness * 0.4, exit: thickness * 0.4, back: thickness * 0.3, maxSteps: 200 };
    const total = particles;
    const perTick = Math.max(20, Math.ceil(total / 80));
    const startedAt = Date.now();
    const acc: Run = { ...IDLE, running: true };
    setRun(acc);

    timer.current = setInterval(() => {
      const n = Math.min(perTick, total - acc.done);
      const fresh: Track[] = [];
      for (let i = 0; i < n; i++) {
        const w = walk(rand, { ...opts, keep: i < 2 });
        if (w.fate === "t") acc.t++;
        else if (w.fate === "r") acc.r++;
        else acc.a++;
        if (w.pts) fresh.unshift(w);
      }
      acc.done += n;
      acc.tracks = [...fresh, ...acc.tracks].slice(0, 28);
      acc.rate = Math.round(acc.done / Math.max(0.05, (Date.now() - startedAt) / 1000));
      if (acc.done >= total) {
        clearInterval(timer.current);
        acc.running = false;
        acc.finished = true;
        acc.fingerprint = fingerprint([acc.t, acc.r, acc.a, total, thickness, mfp * 2, absorb]);
      }
      setRun({ ...acc });
    }, 50);
  }

  const pct = (v: number) => (run.done ? ((100 * v) / run.done).toFixed(1) + "%" : "—");
  const p = run.done ? run.t / run.done : 0;
  const err = run.done ? (100 * Math.sqrt((p * (1 - p)) / run.done)).toFixed(2) + "%" : "—";

  const wallX = 200, wallW = 320, scale = wallW / thickness;
  const status = run.running ? `Simulating on ${device === "gpu" ? "GPU" : "CPU"}…` : run.finished ? "Done" : "Ready";

  return (
    <div style={{ minHeight: "100vh" }}>
      <SiteHeader active="lab" />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
          <span style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 999, background: "var(--mint)", color: "var(--green-ink)", fontSize: 13, fontWeight: 600 }}>
            Free · no wallet needed
          </span>
          <h1 style={{ margin: 0, fontSize: "clamp(36px, 5vw, 52px)", fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.05 }}>
            Test a simulation on <span style={{ fontStyle: "italic", color: "var(--green-ink)" }}>this device.</span>
          </h1>
          <p style={{ margin: 0, fontSize: 18, color: "var(--muted)", lineHeight: 1.55 }}>
            Fire particles at a wall and see how many get through. When the numbers look right, run it at scale on Nova.
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
          <section className="in d1" aria-label="Settings" style={{ ...card, flex: "1 1 300px", minWidth: 0, gap: 24 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SliderLabel label="Wall thickness" value={`${thickness} cm`} />
              <input type="range" min={1} max={20} step={1} value={thickness} onChange={(e) => { setThickness(Number(e.target.value)); invalidate(); }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SliderLabel label="Mean free path" value={`${mfp} cm`} />
              <input type="range" min={1} max={6} step={0.5} value={mfp} onChange={(e) => { setMfp(Number(e.target.value)); invalidate(); }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SliderLabel label="Absorbed per collision" value={`${absorb}%`} />
              <input type="range" min={5} max={50} step={1} value={absorb} onChange={(e) => { setAbsorb(Number(e.target.value)); invalidate(); }} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Particles</span>
              <Chips
                label="Particles"
                value={particles}
                onChange={(v) => { setParticles(v); invalidate(); }}
                options={[
                  { value: 1_000, label: "1,000" },
                  { value: 10_000, label: "10,000" },
                  { value: 50_000, label: "50,000" },
                ]}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Run on</span>
              <Segmented<Device>
                label="Device"
                value={device}
                onChange={setDevice}
                options={[
                  { value: "gpu", label: "GPU (WebGPU)" },
                  { value: "cpu", label: "CPU (WASM)" },
                ]}
              />
              <span style={{ fontSize: 13, color: "var(--faint)" }}>
                {device === "gpu" ? "Uses your graphics card. Falls back to CPU if WebGPU is missing." : "Runs the same Rust kernel on your processor."}
              </span>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15, fontWeight: 600 }}>
              Seed
              <input
                type="text"
                value={seed}
                onChange={(e) => { setSeed(e.target.value); invalidate(); }}
                className="mono"
                spellCheck={false}
                style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--line)", fontSize: 14, fontWeight: 400 }}
              />
            </label>
            <button type="button" className="pri" onClick={start} disabled={run.running} style={{ ...btnPrimary, minHeight: 56, fontSize: 16 }}>
              {run.running ? "Running…" : run.finished ? "Run again" : "Run simulation"}
            </button>
          </section>

          <section className="in d2" aria-label="Simulation" style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <figure style={{ margin: 0, borderRadius: 24, background: "var(--surface)", overflow: "hidden" }}>
              <svg viewBox="0 0 720 280" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Particles moving through the wall; green ones got through">
                <defs><clipPath id="lc"><rect x="0" y="0" width="720" height="280" /></clipPath></defs>
                <rect className="wall" x={wallX} y="0" width={wallW} height="280" fill="#ECECE7" />
                <g clipPath="url(#lc)">
                  <Tracks tracks={run.tracks} x={(v) => wallX + v * scale} y={(v) => 140 + v * 34} />
                </g>
              </svg>
              <figcaption style={{ padding: "14px 22px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--muted)" }}>
                  <span role="status">{status}</span>
                  <span className="mono">{fmt(run.done)} / {fmt(particles)}</span>
                </div>
                <ProgressBar value={(100 * run.done) / particles} />
              </figcaption>
            </figure>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <Stat label="Got through" value={pct(run.t)} sub={`± ${err}`} highlight />
              <Stat label="Bounced back" value={pct(run.r)} />
              <Stat label="Absorbed" value={pct(run.a)} />
              <Stat label="Speed" value={run.rate ? fmt(run.rate) : "—"} sub="particles / s" />
            </div>

            {run.finished && (
              <div className="pop" style={{ padding: "20px 22px", borderRadius: 20, border: "1px solid var(--line-soft)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>This run's fingerprint</span>
                  <span className="mono" style={{ fontSize: 15, wordBreak: "break-all" }}>{run.fingerprint}</span>
                  <span style={{ fontSize: 13, color: "var(--faint)" }}>
                    Run it again with the same seed: you'll get the same fingerprint. That's how Nova checks work.
                  </span>
                </div>
                <Link to="/jobs/new" className="pri" style={{ ...btnPrimary, minHeight: 50, padding: "0 22px", whiteSpace: "nowrap" }}>
                  Run 2 million particles on Nova →
                </Link>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  const tone: CSSProperties = { color: highlight ? "var(--mint-ink)" : "var(--muted)" };
  return (
    <div style={{ padding: 18, borderRadius: 18, background: highlight ? "var(--mint)" : "var(--surface)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, ...tone }}>{label}</span>
      <span className="tnum" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>{value}</span>
      {sub && <span className={highlight ? "mono" : undefined} style={{ fontSize: 12, ...tone }}>{sub}</span>}
    </div>
  );
}
