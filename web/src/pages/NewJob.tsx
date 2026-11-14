import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { Chips, SliderLabel, Spinner, btnPrimary } from "../components/ui";
import { DEMO } from "../lib/demo";
import { fmt } from "../lib/random";

type Phase = "idle" | "funding" | "funded";

export default function NewJob() {
  const [thickness, setThickness] = useState(10);
  const [particles, setParticles] = useState(2_000_000);
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const chunks = Math.ceil(particles / DEMO.particlesPerPiece);
  const total = chunks * 2 * DEMO.satsPerPiece;
  const wallW = 20 + thickness * 12;

  function fund() {
    // TODO(wallet+api): POST /jobs, then sign the escrow funding tx via WizardConnect.
    setPhase("funding");
    timer.current = setTimeout(() => setPhase("funded"), 1900);
  }

  const zip = (d: number, delay = 0): CSSProperties => ({ ["--d" as string]: `${d}px`, animationDelay: `${delay}s` });

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>New simulation</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>How many particles get through a wall? Set it up in under a minute.</p>
        </div>

        <div className="in d1" style={{ borderRadius: 24, background: "var(--surface)", overflow: "hidden" }}>
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
        </div>

        <section className="in d2" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SliderLabel label="Wall thickness" value={`${thickness} cm`} size={16} />
            <input type="range" min={1} max={20} step={1} value={thickness} disabled={phase !== "idle"} onChange={(e) => setThickness(Number(e.target.value))} />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Particles</span>
            <Chips
              label="Particles"
              size="lg"
              value={particles}
              onChange={(v) => phase === "idle" && setParticles(v)}
              options={[
                { value: 500_000, label: "500k" },
                { value: 2_000_000, label: "2 million" },
                { value: 5_000_000, label: "5 million" },
              ]}
            />
            <span style={{ fontSize: 14, color: "var(--muted)" }}>More particles means a more precise answer.</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 22, borderRadius: 20, border: "1px solid var(--line)" }}>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>
              {fmt(chunks)} pieces × 2 providers × {fmt(DEMO.satsPerPiece)} sats
            </span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Total</span>
              <span className="tnum" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
                {fmt(total)} <span style={{ fontSize: 15, color: "var(--muted)", fontWeight: 500 }}>sats</span>
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--faint)" }}>Anything unused comes back to your wallet.</span>
          </div>

          {phase === "idle" && (
            <button type="button" className="pri" onClick={fund} style={{ ...btnPrimary, minHeight: 58, fontSize: 17 }}>
              Fund and start
            </button>
          )}
          {phase === "funding" && (
            <div className="swap-up" role="status" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
                <Spinner />
                Confirm in your wallet…
              </span>
              <div style={{ width: "100%", height: 4, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                <div className="fill" style={{ height: "100%", background: "var(--ink)" }} />
              </div>
            </div>
          )}
          {phase === "funded" && (
            <div className="swap-up" role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 22px", borderRadius: 20, background: "var(--mint)", flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>Funded. It's running.</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--mint-ink)" }}>tx 3f9a…c21e · BCH mainnet</span>
              </span>
              <Link to="/jobs/live" className="pri" style={{ ...btnPrimary, minHeight: 48, padding: "0 22px" }}>Watch it →</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
