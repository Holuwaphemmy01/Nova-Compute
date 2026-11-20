import type { CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { api, humanError, type Chunk } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Loading, Notice } from "../components/Notice";
import { LegendDot, btnPrimary } from "../components/ui";
import { explorerTx } from "../config/env";
import { chunkDisplay, jobTitle, type ChunkDisplay } from "../lib/jobs";
import { fmt } from "../lib/random";
import { usePoll } from "../lib/usePoll";
import { FundPanel } from "../wallet/FundPanel";
import { LiveChart, answerStat } from "../components/templateViews";

const CELL_BASE: CSSProperties = { display: "block", aspectRatio: "1", borderRadius: 3, boxSizing: "border-box" };
const CELL: Record<ChunkDisplay, { cls?: string; style: CSSProperties; label: string }> = {
  queued: { style: { ...CELL_BASE, background: "#ECECE7" }, label: "queued" },
  running: { cls: "computing", style: { ...CELL_BASE, background: "#16161A" }, label: "running" },
  verified: { cls: "verified", style: { ...CELL_BASE, background: "#0AC18E" }, label: "checked and paid" },
  retrying: { cls: "reassigned", style: { ...CELL_BASE, background: "#FFC85C", border: "1px solid #16161A", borderRadius: "50%" }, label: "didn't match, retrying" },
  unpaid: { style: { ...CELL_BASE, background: "#FFFFFF", border: "1px solid #6E6E75" }, label: "checked by Nova, no matching worker" },
};

export default function LiveJob() {
  const { id = "" } = useParams();
  const job = usePoll((s) => api.getJob(id, s), 2000, [id]);
  const chunks = usePoll((s) => api.getChunks(id, s), 2000, [id]);
  const result = usePoll((s) => api.getResult(id, s), 4000, [id]);
  const j = job.data;
  const cs: Chunk[] = chunks.data ?? [];

  if (!j) {
    return (
      <Shell>
        {job.error ? <Notice title="Couldn't load this job" tone="warn">{humanError(job.error)}</Notice> : <Loading label="Loading job…" />}
      </Shell>
    );
  }

  const verified = cs.filter((c) => c.status === "paid" || c.status === "paying" || c.status === "unpaid").length;
  const running = cs.filter((c) => (c.active_leases ?? 0) > 0).reduce((n, c) => n + (c.active_leases ?? 0), 0);
  const complete = j.status === "complete" || j.status === "closed";
  const r = result.data;
  const paidRows = cs.filter((c) => c.payout_txid).sort((a, b) => b.index - a.index).slice(0, 5);
  const statusLine =
    j.status === "awaiting_funding" ? "Waiting for funding" : j.status === "finalizing" ? "All pieces checked · writing the proof on chain" : complete ? "Done" : running > 0 ? `Running on ${running} GPUs right now` : "Waiting for providers";

  return (
    <Shell>
      <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
        <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>{jobTitle(j)}</h1>
      </div>

      {j.status === "awaiting_funding" && <FundPanel job={j} onFunded={job.refresh} />}

      <div className="in d1" style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <BigStat label={statusLine} value={`${Math.round((verified / j.chunk_count) * 100)}%`} sub={`${verified} of ${j.chunk_count} pieces checked`} />
        <BigStat {...answerStat(r)} mint />
      </div>

      <LiveChart result={r} job={j} />

      <section className="in d2" aria-label="Pieces" style={{ padding: 28, borderRadius: 24, border: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Every piece of the job</h2>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
            <LegendDot color="#ECECE7">Queued</LegendDot>
            <LegendDot color="#16161A">Running</LegendDot>
            <LegendDot color="#0AC18E">Checked and paid</LegendDot>
            <LegendDot color="#FFC85C" round outlined>Didn't match, retrying</LegendDot>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(20, Math.max(4, cs.length))}, minmax(0, 1fr))`, gap: 5 }} role="list" aria-label={`${verified} of ${j.chunk_count} pieces checked`}>
          {cs.map((c) => {
            const d = CELL[chunkDisplay(c)];
            return <span key={c.index} role="listitem" title={`Piece ${c.index}: ${d.label}`} className={d.cls} style={d.style} />;
          })}
        </div>
      </section>

      <section aria-label="Latest payments" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Latest payments</h2>
        {paidRows.length === 0 && (
          <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", fontSize: 15, color: "var(--muted)" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#DCDCD8" }} />
            {j.status === "awaiting_funding" ? "Payments start once the job is funded." : "Sending pieces to providers…"}
          </div>
        )}
        {paidRows.map((c) => (
          <div key={c.index} className="log-in" style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", flexWrap: "wrap", fontSize: 15 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#0AC18E" }} />
            <span style={{ fontWeight: 600 }}>Piece {c.index}</span>
            <span style={{ color: "var(--muted)" }}>
              {c.resolved_by === "coordinator" ? "checked by Nova" : "checked"} · 2 payouts of {fmt(j.price_per_worker)} sats
            </span>
            <a href={explorerTx(c.payout_txid!)} target="_blank" rel="noreferrer" className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>
              {c.payout_txid!.slice(0, 4)}…{c.payout_txid!.slice(-4)} ↗
            </a>
          </div>
        ))}
      </section>

      {complete && (
        <Link to={`/jobs/${j.job_id}/results`} className="pri" style={{ ...btnPrimary, alignSelf: "center", minHeight: 54, padding: "0 28px", fontSize: 16 }}>
          See the result →
        </Link>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>{children}</main>
    </div>
  );
}

function BigStat({ label, value, sub, mint = false }: { label: string; value: string; sub: string; mint?: boolean }) {
  const tone = mint ? "var(--mint-ink)" : "var(--muted)";
  return (
    <div style={{ flex: "1 1 260px", padding: 28, borderRadius: 24, background: mint ? "var(--mint)" : "var(--surface)", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 14, color: tone }}>{label}</span>
      <span className="tnum" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.05em" }}>{value}</span>
      <span style={{ fontSize: 14, color: tone }}>{sub}</span>
    </div>
  );
}
