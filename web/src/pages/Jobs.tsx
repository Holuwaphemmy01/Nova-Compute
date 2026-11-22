import { Link } from "react-router-dom";
import { api, humanError, type Job } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Loading, Notice } from "../components/Notice";
import { btnPrimary } from "../components/ui";
import { fmt } from "../lib/random";
import { jobTitle } from "../lib/jobs";
import { usePoll } from "../lib/usePoll";
import { useWalletState } from "../wallet/store";

const ACTIVE = new Set(["awaiting_funding", "running", "finalizing"]);



export default function Jobs() {
  const wallet = useWalletState();
  const jobs = usePoll((s) => api.listJobs(wallet.address!, s), 5000, [wallet.address], !!wallet.address);
  const list = jobs.data ?? [];
  const active = list.filter((j) => ACTIVE.has(j.status));
  const finished = list.filter((j) => !ACTIVE.has(j.status));

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>My jobs</h1>
          <Link to="/jobs/new" className="pri" style={{ ...btnPrimary, minHeight: 48, padding: "0 22px" }}>New job</Link>
        </div>

        {!wallet.address ? (
          <Notice title="Connect your wallet" action={{ to: "/connect?role=researcher", label: "Connect wallet" }}>
            Your jobs are tied to your BCH address.
          </Notice>
        ) : jobs.loading && !jobs.data ? (
          <Loading label="Loading your jobs…" />
        ) : jobs.error && !jobs.data ? (
          <Notice title="Couldn't load your jobs" tone="warn">{humanError(jobs.error)}</Notice>
        ) : list.length === 0 ? (
          <Notice title="No jobs yet" action={{ to: "/jobs/new", label: "Start a simulation" }}>
            Set up a simulation, fund it from your wallet and watch it run on computers around the world.
          </Notice>
        ) : null}

        {active.map((j, i) => (
          <ActiveCard key={j.job_id} job={j} delay={i === 0 ? "d1" : ""} />
        ))}

        {finished.length > 0 && (
          <section className="in d2" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Finished</h2>
            {finished.map((j) => (
              <Link key={j.job_id} to={`/jobs/${j.job_id}/results`} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 20px", borderRadius: 16, textDecoration: "none", flexWrap: "wrap" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{jobTitle(j)}</span>
                  <span style={{ fontSize: 14, color: "var(--muted)" }}>
                    {j.status === "complete" ? "Done" : "Closed"} · {fmt(j.progress.paid * 2 * j.price_per_worker)} sats paid
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>View result →</span>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function ActiveCard({ job: j, delay }: { job: Job; delay: string }) {
  const done = j.progress.paid + j.progress.unpaid + j.progress.paying;
  const pct = Math.round((done / j.chunk_count) * 100);
  const label = j.status === "awaiting_funding" ? "Waiting for funding" : j.status === "finalizing" ? "Writing the proof on chain" : "Running now";
  return (
    <Link to={`/jobs/${j.job_id}`} className={`in ${delay} card`} style={{ display: "flex", flexDirection: "column", gap: 18, padding: 28, borderRadius: 24, background: "var(--surface)", textDecoration: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: j.status === "awaiting_funding" ? "#8A5A00" : "var(--green-ink)" }}>{label}</span>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{jobTitle(j)}</span>
        </div>
        <span className="tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>{pct}%</span>
      </div>
      <div role="progressbar" aria-label="Job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ position: "relative", height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
        <div className="bar" style={{ height: "100%", borderRadius: 999, background: "var(--green)", width: `${pct}%` }} />
        {j.status === "running" && <span className="sweep" aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "25%", background: "rgba(255,255,255,0.45)" }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", fontSize: 14, color: "var(--muted)" }}>
        <span>{done} of {j.chunk_count} pieces checked</span>
        <span>{fmt(j.progress.paid * 2 * j.price_per_worker)} sats paid so far</span>
      </div>
    </Link>
  );
}
