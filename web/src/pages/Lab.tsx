import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "../components/Headers";
import { Tracks } from "../components/Tracks";
import { Chips, ProgressBar, Segmented, SliderLabel, btnPrimary, card } from "../components/ui";
import type { SimKernel, SimParams, SimProgress, SimResult, Track as KernelTrack } from "../kernel/types";
import { createWasmKernel, isAbort } from "../kernel/wasmKernel";
import { fmt } from "../lib/random";
import type { Track as DrawnTrack } from "../lib/walk";

type Device = "gpu" | "cpu";
type GpuSupport = "checking" | "available" | "unavailable";

/** SVG geometry: the wall is centred and drawn at a fixed px-per-cm scale, so its width tracks thickness. */
const VIEW_W = 720;
const VIEW_H = 280;
const PX_PER_CM = 24;
const STUB_CM = 3; // length of the entry/exit rays drawn outside the wall
const MAX_TRACKS = 28;

const EMPTY: SimProgress = { done: 0, transmitted: 0, reflected: 0, absorbed: 0, sampleTracks: [], computeMs: 0 };

/** Detects WebGPU without needing WebGPU type definitions. */
function useWebGpuSupport(): GpuSupport {
  const [support, setSupport] = useState<GpuSupport>("checking");
  useEffect(() => {
    let alive = true;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) {
      setSupport("unavailable");
      return;
    }
    gpu
      .requestAdapter()
      .then((adapter) => alive && setSupport(adapter ? "available" : "unavailable"))
      .catch(() => alive && setSupport("unavailable"));
    return () => {
      alive = false;
    };
  }, []);
  return support;
}

/** Adds short entry/exit rays so a track reads as "came from the left, left through a face". */
let trackId = 1;
function toDrawn(t: KernelTrack): DrawnTrack {
  const pts = t.pts.slice();
  if (pts.length >= 2) {
    const dir = (a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len] as const;
    };
    const [ix, iy] = dir(pts[0], pts[1]);
    pts.unshift([pts[0][0] - ix * STUB_CM, pts[0][1] - iy * STUB_CM]);
    if (t.fate !== "absorbed") {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const [ox, oy] = dir(a, b);
      pts.push([b[0] + ox * STUB_CM, b[1] + oy * STUB_CM]);
    }
  }
  return { id: trackId++, pts, fate: t.fate === "transmitted" ? "t" : t.fate === "reflected" ? "r" : "a" };
}

const sameParams = (a: SimParams, b: SimParams) =>
  a.thicknessCm === b.thicknessCm && a.mfpCm === b.mfpCm && a.absorbProb === b.absorbProb && a.particles === b.particles && a.seed === b.seed;

export default function Lab() {
  const [thickness, setThickness] = useState(10);
  const [mfp, setMfp] = useState(3);
  const [absorb, setAbsorb] = useState(18);
  const [particles, setParticles] = useState(10_000);
  const [device, setDevice] = useState<Device>("cpu");
  const [seed, setSeed] = useState("0xNOVA2026");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SimProgress>(EMPTY);
  const [tracks, setTracks] = useState<DrawnTrack[]>([]);
  const [runParams, setRunParams] = useState<SimParams | null>(null);
  const [result, setResult] = useState<{ params: SimParams; res: SimResult; matchesPrevious: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gpu = useWebGpuSupport();
  const kernel = useRef<(SimKernel & { dispose(): void }) | null>(null);
  const lastRun = useRef<{ params: SimParams; fingerprint: string } | null>(null);

  useEffect(() => {
    const k = createWasmKernel();
    kernel.current = k;
    return () => {
      k.dispose();
      kernel.current = null;
    };
  }, []);

  // GPU is only selectable when WebGPU exists; fall back if detection says no.
  useEffect(() => {
    if (gpu === "available") setDevice("gpu");
    if (gpu === "unavailable") setDevice("cpu");
  }, [gpu]);

  const params: SimParams = { thicknessCm: thickness, mfpCm: mfp, absorbProb: absorb / 100, particles, seed };

  async function run() {
    const k = kernel.current;
    if (!k) return;
    const p = { ...params };
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ ...EMPTY });
    setTracks([]);
    setRunParams(p);
    try {
      // Both device options run the WASM kernel on the CPU until the GPU kernel ships.
      const res = await k.run(p, {
        onProgress: (pr) => {
          setProgress(pr);
          if (pr.sampleTracks.length) setTracks((old) => [...pr.sampleTracks.map(toDrawn).reverse(), ...old].slice(0, MAX_TRACKS));
        },
      });
      const prev = lastRun.current;
      setProgress(res);
      setResult({ params: p, res, matchesPrevious: !!prev && sameParams(prev.params, p) && prev.fingerprint === res.fingerprint });
      lastRun.current = { params: p, fingerprint: res.fingerprint };
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "The simulation failed.");
    } finally {
      setRunning(false);
    }
  }

  const n = progress.done;
  const pct = (v: number) => (n ? ((100 * v) / n).toFixed(1) + "%" : "—");
  const p = n ? progress.transmitted / n : 0;
  const err = n ? (100 * Math.sqrt((p * (1 - p)) / n)).toFixed(2) + "%" : "—";
  const speed = n && progress.computeMs > 0 ? fmt(Math.round((n / progress.computeMs) * 1000)) : "—";
  const total = runParams?.particles ?? particles;

  // Drawing uses the thickness the tracks were simulated with, so they stay inside their wall.
  const drawL = running && runParams ? runParams.thicknessCm : thickness;
  const wallW = drawL * PX_PER_CM;
  const wallX = (VIEW_W - wallW) / 2;
  const showFingerprint = result && !running && sameParams(result.params, params);

  const gpuNote =
    gpu === "checking"
      ? "Checking for WebGPU…"
      : gpu === "unavailable"
        ? "WebGPU not available on this browser. Runs the Rust kernel as WebAssembly on your CPU."
        : device === "gpu"
          ? "GPU kernel coming soon, running the WASM kernel on CPU."
          : "Runs the Rust kernel as WebAssembly on your CPU, in a background worker.";

  const status = running
    ? `Simulating on CPU (WASM)${device === "gpu" ? ", GPU kernel coming soon" : ""}…`
    : result
      ? `Done in ${result.res.ms.toFixed(0)} ms of compute on CPU (WASM)`
      : error
        ? "Something went wrong"
        : "Ready";

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
              <input type="range" min={1} max={20} step={1} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SliderLabel label="Mean free path" value={`${mfp} cm`} />
              <input type="range" min={1} max={6} step={0.5} value={mfp} onChange={(e) => setMfp(Number(e.target.value))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SliderLabel label="Absorbed per collision" value={`${absorb}%`} />
              <input type="range" min={5} max={50} step={1} value={absorb} onChange={(e) => setAbsorb(Number(e.target.value))} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span id="particles-label" style={{ fontSize: 15, fontWeight: 600 }}>Particles</span>
              <Chips
                label="Particles"
                value={particles}
                onChange={setParticles}
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
                label="Run on"
                value={device}
                onChange={setDevice}
                options={[
                  { value: "gpu", label: "GPU (beta)", disabled: gpu !== "available" },
                  { value: "cpu", label: "CPU (WASM)" },
                ]}
              />
              <span style={{ fontSize: 13, color: "var(--faint)" }} aria-live="polite">{gpuNote}</span>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 15, fontWeight: 600 }}>
              Seed
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="mono"
                spellCheck={false}
                autoComplete="off"
                style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: "1px solid var(--chip-border)", fontSize: 14, fontWeight: 400, color: "var(--ink)" }}
              />
            </label>
            <button type="button" className="pri" onClick={run} disabled={running} style={{ ...btnPrimary, minHeight: 56, fontSize: 16, cursor: running ? "progress" : "pointer" }}>
              {running ? "Running…" : result ? "Run again" : "Run simulation"}
            </button>
          </section>

          <section className="in d2" aria-label="Simulation" style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <figure style={{ margin: 0, borderRadius: 24, background: "var(--surface)", overflow: "hidden" }}>
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                style={{ display: "block", width: "100%", height: "auto" }}
                role="img"
                aria-label={`A ${drawL} cm wall with the most recent particle paths. Green paths got through the wall; dark paths bounced back or were absorbed.`}
              >
                <defs>
                  <clipPath id="lab-clip"><rect x="0" y="0" width={VIEW_W} height={VIEW_H} /></clipPath>
                </defs>
                <rect className="wall" x={wallX} y="0" width={wallW} height={VIEW_H} fill="#ECECE7" />
                <g clipPath="url(#lab-clip)">
                  <Tracks tracks={tracks} x={(v) => wallX + v * PX_PER_CM} y={(v) => VIEW_H / 2 + v * PX_PER_CM} />
                </g>
              </svg>
              <figcaption style={{ padding: "14px 22px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 14, color: "var(--muted)" }}>
                  <span role="status">{status}</span>
                  <span className="mono">{fmt(n)} / {fmt(total)}</span>
                </div>
                <ProgressBar value={total ? (100 * n) / total : 0} label="Simulation progress" />
              </figcaption>
            </figure>

            {error && (
              <p role="alert" style={{ margin: 0, padding: "14px 18px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>
                {error}
              </p>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <Stat label="Got through" value={pct(progress.transmitted)} sub={`± ${err}`} highlight />
              <Stat label="Bounced back" value={pct(progress.reflected)} />
              <Stat label="Absorbed" value={pct(progress.absorbed)} />
              <Stat label="Speed" value={speed} sub="particles / s" />
            </div>

            {showFingerprint && result && (
              <div className="pop" style={{ padding: "20px 22px", borderRadius: 20, border: "1px solid var(--line-soft)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: "1 1 320px" }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    This run's fingerprint <span style={{ color: "var(--faint)" }}>· SHA-256</span>
                    {result.matchesPrevious && <span style={{ marginLeft: 8, color: "var(--green-ink)", fontWeight: 600 }}>✓ same as your last run</span>}
                  </span>
                  <span className="mono" style={{ fontSize: 14, wordBreak: "break-all" }}>{result.res.fingerprint}</span>
                  <span style={{ fontSize: 13, color: "var(--faint)" }}>
                    Run it again with the same seed: you'll get the same fingerprint. That's how Nova checks work.
                  </span>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>
                    Ran on CPU · {kernel.current?.name ?? "Rust kernel (WebAssembly)"}
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
