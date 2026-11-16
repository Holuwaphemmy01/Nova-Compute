import { useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, humanError } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Notice } from "../components/Notice";
import { Chips, SliderLabel, Spinner, btnPrimary } from "../components/ui";
import { chunkValue } from "../config/env";
import { fmt } from "../lib/random";
import { usePoll } from "../lib/usePoll";
import { FundPanel } from "../wallet/FundPanel";
import { useWalletState } from "../wallet/store";

const PARTICLES_PER_PIECE = 10_000;
const PRICE = 1200; // sats per worker per piece

export default function NewJob() {
  const wallet = useWalletState();
  const navigate = useNavigate();
  const [thickness, setThickness] = useState(10);
  const [particles, setParticles] = useState(2_000_000);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = usePoll((s) => api.getJob(jobId!, s), 3000, [jobId], !!jobId);

  const chunks = Math.ceil(particles / PARTICLES_PER_PIECE);
  const perChunk = chunkValue(PRICE);
  const total = chunks * perChunk;
  const wallW = 20 + thickness * 12;
  const zip = (d: number, delay = 0): CSSProperties => ({ ["--d" as string]: `${d}px`, animationDelay: `${delay}s` });

  async function create() {
    if (!wallet.address) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createJob(wallet.address, {
        params: { thickness_cm: thickness, mfp_cm: 3, absorb_prob: 0.18 },
        chunk_count: chunks,
        trials_per_chunk: PARTICLES_PER_PIECE,
        price_per_worker: PRICE,
      });
      setJobId(created.job_id);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setCreating(false);
    }
  }

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
            <input type="range" min={1} max={20} step={1} value={thickness} disabled={!!jobId} onChange={(e) => setThickness(Number(e.target.value))} />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Particles</span>
            <Chips
              label="Particles"
              size="lg"
              value={particles}
              onChange={(v) => !jobId && setParticles(v)}
              options={[
                { value: 40_000, label: "40k" },
                { value: 500_000, label: "500k" },
                { value: 2_000_000, label: "2 million" },
                { value: 5_000_000, label: "5 million" },
              ]}
            />
            <span style={{ fontSize: 14, color: "var(--muted)" }}>More particles means a more precise answer.</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 22, borderRadius: 20, border: "1px solid var(--line)" }}>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>
              {fmt(chunks)} pieces × 2 providers × {fmt(PRICE)} sats, plus {fmt(perChunk - 2 * PRICE)} sats network fee per piece
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
