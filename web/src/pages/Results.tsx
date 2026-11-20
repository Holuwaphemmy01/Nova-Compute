import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, humanError } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Loading, Notice } from "../components/Notice";
import { LegendDot, Spinner, btnPrimary, btnSecondary } from "../components/ui";
import { explorerTx } from "../config/env";
import { jobTitle, merkleRoot } from "../lib/jobs";
import { fmt } from "../lib/random";
import { usePoll } from "../lib/usePoll";
import { ClosePanel } from "../wallet/ClosePanel";
import { TemplateResult } from "../components/templateViews";

type Check = { phase: "idle" } | { phase: "checking"; step: string } | { phase: "ok"; root: string } | { phase: "fail"; reason: string };

const CONFETTI_COLORS = ["#0AC18E", "#FFC85C", "#16161A", "#C2E5D1", "#D9DDFF"];

/** Finds the "NOVA" ‖ jobId ‖ root push in a raw tx's OP_RETURN output, returns the root hex. */
function opReturnRoot(txHex: string, jobId: string): string | null {
  const marker = "6a44" + "4e4f5641" + jobId.toLowerCase(); // OP_RETURN, push 68, "NOVA", jobId
  const i = txHex.toLowerCase().indexOf(marker);
  return i < 0 ? null : txHex.slice(i + marker.length, i + marker.length + 64).toLowerCase();
}

export default function Results() {
  const { id = "" } = useParams();
  const job = usePoll((s) => api.getJob(id, s), 5000, [id]);
  const result = usePoll((s) => api.getResult(id, s), 5000, [id]);
  const proof = usePoll((s) => api.getProof(id, s), 5000, [id]);
  const [check, setCheck] = useState<Check>({ phase: "idle" });
  const j = job.data;
  const r = result.data;
  const p = proof.data;

  if (!j || !r) {
    return (
      <Shell>
        {job.error || result.error ? <Notice title="Couldn't load this result" tone="warn">{humanError(job.error ?? result.error)}</Notice> : <Loading label="Loading result…" />}
      </Shell>
    );
  }

  const neutron = "trials" in r ? r : null;
  const pct = (v: number) => (neutron?.trials ? (100 * v) / neutron.trials : 0);
  const [tPct, rPct, aPct] = neutron ? [pct(neutron.transmitted), pct(neutron.reflected), pct(neutron.absorbed)] : [0, 0, 0];
  const paid = j.progress.paid * 2 * j.price_per_worker;
  const done = j.status === "complete";

  async function verify() {
    if (!p) return;
    try {
      setCheck({ phase: "checking", step: `Recomputing the root from ${p.leaves.length} piece fingerprints…` });
      const local = await merkleRoot(p.leaves.sort((a, b) => a.index - b.index).map((l) => l.hash));
      if (!p.op_return_txid) return setCheck({ phase: "fail", reason: "The proof hasn't been written on chain yet." });
      setCheck({ phase: "checking", step: "Fetching the proof transaction from the BCH network…" });
      const tx = await api.getTx(p.op_return_txid);
      const onChain = opReturnRoot(tx.hex, p.job_id);
      if (!onChain) return setCheck({ phase: "fail", reason: "That transaction doesn't contain this job's proof." });
      if (onChain !== local) return setCheck({ phase: "fail", reason: "The fingerprints don't add up to the root on chain." });
      setCheck({ phase: "ok", root: onChain });
    } catch (e) {
      setCheck({ phase: "fail", reason: humanError(e) });
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify({ job: j, result: r, proof: p }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nova-${id.slice(0, 8)}-result.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell>
      <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
        <span style={{ fontSize: 15, fontWeight: 600, color: done ? "var(--green-ink)" : "var(--muted)" }}>
          {done ? `Done · all ${r.chunk_count} pieces checked` : `${r.chunks_verified} of ${r.chunk_count} pieces checked so far`}
        </span>
        <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>{jobTitle(j)}</h1>
      </div>

      {!neutron ? (
        <TemplateResult result={r} job={j} />
      ) : (
      <section className="in d1" style={{ borderRadius: 28, background: "var(--mint)", padding: 36, display: "flex", flexDirection: "column", gap: 22 }}>
        <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>Share of particles that got through</span>
        <span className="num tnum" style={{ fontSize: "clamp(64px, 12vw, 112px)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.06em" }}>
          {neutron.trials ? `${tPct.toFixed(1)}%` : "—"}
        </span>
        <span className="mono" style={{ fontSize: 15, color: "var(--mint-ink)" }}>
          ± {(neutron.transmitted_std_error * 100).toFixed(2)}% · from {fmt(neutron.trials)} particles
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          <div role="img" aria-label={`Absorbed ${aPct.toFixed(1)}%, bounced back ${rPct.toFixed(1)}%, got through ${tPct.toFixed(1)}%`} style={{ height: 14, borderRadius: 999, overflow: "hidden", display: "flex", background: "#FFFFFF" }}>
            <span className="growx" style={{ width: `${aPct}%`, background: "#16161A" }} />
            <span className="growx" style={{ width: `${rPct}%`, background: "#C2E5D1", animationDelay: ".45s" }} />
            <span className="growx" style={{ width: `${tPct}%`, background: "#0AC18E", animationDelay: ".6s" }} />
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, color: "var(--mint-ink)" }}>
            <LegendDot color="#16161A">Absorbed {aPct.toFixed(1)}%</LegendDot>
            <LegendDot color="#C2E5D1" outlined>Bounced back {rPct.toFixed(1)}%</LegendDot>
            <LegendDot color="#0AC18E">Got through {tPct.toFixed(1)}%</LegendDot>
          </div>
        </div>
      </section>
      )}

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
          {p?.merkle_root ?? "Written on chain when every piece is checked."}
        </div>
        {p?.op_return_txid && (
          <a href={explorerTx(p.op_return_txid)} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--muted)" }}>
            Proof transaction {p.op_return_txid.slice(0, 8)}… ↗
          </a>
        )}
        <div style={{ minHeight: 52, display: "flex", alignItems: "center" }} aria-live="polite">
          {check.phase === "idle" && (
            <button type="button" className="sec" onClick={verify} disabled={!p?.op_return_txid} style={{ ...btnSecondary, minHeight: 46, padding: "0 20px", opacity: p?.op_return_txid ? 1 : 0.55 }}>
              Check it on chain
            </button>
          )}
          {check.phase === "checking" && (
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
              <Spinner />
              {check.step}
            </span>
          )}
          {check.phase === "ok" && (
            <span className="stamp" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 999, border: "2px solid var(--green)", color: "var(--green-ink)", fontWeight: 700, fontSize: 15 }}>
              ✓ Verified on BCH {import.meta.env.VITE_NETWORK === "mainnet" ? "mainnet" : "chipnet"}
            </span>
          )}
          {check.phase === "fail" && (
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, fontSize: 15, color: "#8A5A00" }}>
              ✗ Not verified: {check.reason}
              <button type="button" className="sec" onClick={() => setCheck({ phase: "idle" })} style={{ ...btnSecondary, minHeight: 40, padding: "0 16px", fontSize: 14 }}>Try again</button>
            </span>
          )}
        </div>
        {check.phase === "ok" &&
          Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="conf"
              aria-hidden="true"
              style={{ position: "absolute", top: 110 + (i % 3) * 8, left: `${8 + i * 7.5}%`, width: 8, height: i % 2 ? 8 : 12, borderRadius: 2, background: CONFETTI_COLORS[i % 5], animationDelay: `${(i * 0.04).toFixed(2)}s` }}
            />
          ))}
      </section>

      <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", textAlign: "center" }}>
        Paid {fmt(paid)} sats to providers
        {j.progress.unpaid + j.progress.pending > 0 && j.status !== "awaiting_funding" ? (
          <> · <span style={{ color: "var(--green-ink)", fontWeight: 600 }}>{fmt((j.progress.unpaid + j.progress.pending) * j.per_chunk_value)} sats</span> can come back to you</>
        ) : null}
      </p>

      <ClosePanel job={j} onClosed={job.refresh} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 28 }}>{children}</main>
    </div>
  );
}
