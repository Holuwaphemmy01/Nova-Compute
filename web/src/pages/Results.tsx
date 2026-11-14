import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { LegendDot, Spinner, btnPrimary, btnSecondary } from "../components/ui";
import { DEMO } from "../lib/demo";

type Phase = "idle" | "checking" | "ok";

// TODO(api): load from GET /jobs/:id/result.
const RESULT = {
  title: "Particles through a 10 cm wall",
  particles: "2,000,000",
  transmitted: 21.4,
  reflected: 27.0,
  absorbed: 51.6,
  error: "0.35%",
  merkleRoot: "9d2e7b1fa4c03e58b6d7f20a1c94e3b5d8a6f01c2b7e94d3a5f68c1e0b2d4a97",
  paid: "475,200",
  refunded: "4,800",
};

const CONFETTI_COLORS = ["#0AC18E", "#FFC85C", "#16161A", "#C2E5D1", "#D9DDFF"];

export default function Results() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [checked, setChecked] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  function verify() {
    // TODO(chain): fetch the OP_RETURN via Fulcrum and recompute the Merkle root.
    setPhase("checking");
    setChecked(0);
    let c = 0;
    timer.current = setInterval(() => {
      c += 8;
      if (c >= DEMO.jobPieces) {
        clearInterval(timer.current);
        setChecked(DEMO.jobPieces);
        setPhase("ok");
      } else setChecked(c);
    }, 60);
  }

  function download() {
    const blob = new Blob([JSON.stringify(RESULT, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nova-result.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--green-ink)" }}>Done · all {DEMO.jobPieces} pieces checked</span>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>{RESULT.title}</h1>
        </div>

        <section className="in d1" style={{ borderRadius: 28, background: "var(--mint)", padding: 36, display: "flex", flexDirection: "column", gap: 22 }}>
          <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>Share of particles that got through</span>
          <span className="num tnum" style={{ fontSize: "clamp(64px, 12vw, 112px)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.06em" }}>
            {RESULT.transmitted}%
          </span>
          <span className="mono" style={{ fontSize: 15, color: "var(--mint-ink)" }}>± {RESULT.error} · from {RESULT.particles} particles</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <div role="img" aria-label={`Absorbed ${RESULT.absorbed}%, bounced back ${RESULT.reflected}%, got through ${RESULT.transmitted}%`} style={{ height: 14, borderRadius: 999, overflow: "hidden", display: "flex", background: "#FFFFFF" }}>
              <span className="growx" style={{ width: `${RESULT.absorbed}%`, background: "#16161A" }} />
              <span className="growx" style={{ width: `${RESULT.reflected}%`, background: "#C2E5D1", animationDelay: ".45s" }} />
              <span className="growx" style={{ width: `${RESULT.transmitted}%`, background: "#0AC18E", animationDelay: ".6s" }} />
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, color: "var(--mint-ink)" }}>
              <LegendDot color="#16161A">Absorbed {RESULT.absorbed.toFixed(1)}%</LegendDot>
              <LegendDot color="#C2E5D1" outlined>Bounced back {RESULT.reflected.toFixed(1)}%</LegendDot>
              <LegendDot color="#0AC18E">Got through {RESULT.transmitted.toFixed(1)}%</LegendDot>
            </div>
          </div>
        </section>

        <div className="in d2" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="pri" onClick={download} style={btnPrimary}>Download data</button>
          <Link to="/jobs/new" className="sec" style={{ ...btnSecondary, minHeight: 50 }}>Run again</Link>
        </div>

        <section style={{ position: "relative", borderRadius: 24, border: "1px solid var(--line-soft)", padding: 28, display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Can you trust it?</h2>
          <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", lineHeight: 1.6 }}>
            Every piece was computed twice and the fingerprints matched. Their combined fingerprint is saved on BCH, so anyone can check this result was never changed.
          </p>
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-all", padding: "12px 14px", borderRadius: 12, background: "var(--surface)" }}>
            {RESULT.merkleRoot}
          </div>
          <div style={{ minHeight: 52, display: "flex", alignItems: "center" }} aria-live="polite">
            {phase === "idle" && (
              <button type="button" className="sec" onClick={verify} style={{ ...btnSecondary, minHeight: 46, padding: "0 20px" }}>
                Check it on chain
              </button>
            )}
            {phase === "checking" && (
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
                <Spinner />
                Checking {checked} of {DEMO.jobPieces} pieces…
              </span>
            )}
            {phase === "ok" && (
              <span className="stamp" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, border: "2px solid var(--green)", color: "var(--green-ink)", fontWeight: 700, fontSize: 15 }}>
                ✓ Verified on BCH mainnet
              </span>
            )}
          </div>
          {phase === "ok" &&
            Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className="conf"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 110 + (i % 3) * 8,
                  left: `${8 + i * 7.5}%`,
                  width: 8,
                  height: i % 2 ? 8 : 12,
                  borderRadius: 2,
                  background: CONFETTI_COLORS[i % 5],
                  animationDelay: `${(i * 0.04).toFixed(2)}s`,
                }}
              />
            ))}
        </section>

        <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", textAlign: "center" }}>
          Paid {RESULT.paid} sats to providers · <span style={{ color: "var(--green-ink)", fontWeight: 600 }}>{RESULT.refunded} sats refunded</span> to you
        </p>
      </main>
    </div>
  );
}
