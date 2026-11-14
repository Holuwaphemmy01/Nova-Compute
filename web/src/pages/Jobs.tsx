import { useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { btnPrimary } from "../components/ui";
import { DEMO } from "../lib/demo";
import { fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";

// TODO(api): load from GET /jobs once the coordinator exists.
const FINISHED = [
  { id: "job-5cm", title: "Particles through a 5 cm wall", sats: 240_000 },
  { id: "job-2cm", title: "Particles through a 2 cm wall", sats: 96_000 },
];

export default function Jobs() {
  const total = DEMO.jobPieces;
  const [done, setDone] = useState(118);
  useInterval(() => setDone((d) => (d >= total ? 118 : d + 1)), 900);
  const pct = Math.round((done / total) * 100);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>My jobs</h1>
          <Link to="/jobs/new" className="pri" style={{ ...btnPrimary, minHeight: 48, padding: "0 22px" }}>New job</Link>
        </div>

        <Link to="/jobs/live" className="in d1 card" style={{ display: "flex", flexDirection: "column", gap: 18, padding: 28, borderRadius: 24, background: "var(--surface)", textDecoration: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green-ink)" }}>Running now</span>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Particles through a 10 cm wall</span>
            </div>
            <span className="tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>{pct}%</span>
          </div>
          <div role="progressbar" aria-label="Job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ position: "relative", height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
            <div className="bar" style={{ height: "100%", borderRadius: 999, background: "var(--green)", width: `${pct}%` }} />
            <span className="sweep" aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "25%", background: "rgba(255,255,255,0.45)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", fontSize: 14, color: "var(--muted)" }}>
            <span>{done} of {total} pieces checked</span>
            <span>{fmt(done * DEMO.satsPerPiece * 2)} sats paid so far</span>
          </div>
        </Link>

        <section className="in d2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Finished</h2>
          {FINISHED.map((j) => (
            <Link key={j.id} to="/results" className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px", borderRadius: 16, textDecoration: "none", flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{j.title}</span>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>Done · {fmt(j.sats)} sats</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>View result →</span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
