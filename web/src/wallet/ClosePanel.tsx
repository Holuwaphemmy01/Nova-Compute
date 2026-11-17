import { decodeCashAddress } from "@bitauth/libauth";
import { useState } from "react";
import { api, humanError, type CloseInfo, type Job } from "../api/client";
import { Spinner, btnSecondary } from "../components/ui";
import { explorerTx } from "../config/env";
import { fmt } from "../lib/random";
import { broadcast, buildCloseSweep, toHex, type SweepPlan } from "./chain";
import { useWallet } from "./wizard";

type Phase = { k: "idle" } | { k: "preparing" } | { k: "review"; plan: SweepPlan } | { k: "signing" } | { k: "sending" } | { k: "done"; txid: string };

/** Close a job and sweep its unused chunk UTXOs back with NovaEscrow.close (researcher + oracle). */
export function ClosePanel({ job, onClosed }: { job: Job; onClosed: () => void }) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [error, setError] = useState<string | null>(null);
  const unused = job.progress.unpaid + job.progress.pending;
  if (job.status === "awaiting_funding" || unused === 0 || !wallet.connected || wallet.address !== job.researcher_addr) {
    return phase.k === "done" ? <Done txid={phase.txid} /> : null;
  }

  async function prepare() {
    setError(null);
    setPhase({ k: "preparing" });
    try {
      const info: CloseInfo = await api.closeJob(wallet.address!, job.job_id);
      const decoded = decodeCashAddress(job.researcher_addr);
      if (typeof decoded === "string") throw new Error(decoded);
      setPhase({ k: "review", plan: buildCloseSweep(job, info, toHex(decoded.payload), wallet.address!) });
      onClosed();
    } catch (e) {
      setError(humanError(e));
      setPhase({ k: "idle" });
    }
  }

  async function sign(plan: SweepPlan) {
    setError(null);
    setPhase({ k: "signing" });
    try {
      const signed = await wallet.signTransaction(plan.tx);
      setPhase({ k: "sending" });
      const txid = await broadcast(signed);
      setPhase({ k: "done", txid });
      onClosed();
    } catch (e) {
      setError(humanError(e));
      setPhase({ k: "review", plan });
    }
  }

  return (
    <section aria-label="Get unused funds back" style={{ padding: 24, borderRadius: 24, border: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 17, fontWeight: 700 }}>Get unused funds back</span>
      <span style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.55 }}>
        {job.status === "running"
          ? `Stops the job and returns the ${unused} unfinished pieces' escrow to your wallet. Providers already paid keep their pay.`
          : `${unused} pieces weren't paid out. Their escrow can come back to your wallet.`}
      </span>
      {phase.k === "idle" && (
        <button type="button" className="sec" onClick={prepare} style={{ ...btnSecondary, alignSelf: "flex-start", minHeight: 46, padding: "0 20px" }}>
          {job.status === "running" ? "Stop and get funds back" : "Get funds back"}
        </button>
      )}
      {phase.k === "preparing" && <Status>Getting the oracle's close signature…</Status>}
      {phase.k === "review" && (
        <>
          <span style={{ fontSize: 15 }}>
            You'll get back <strong>{fmt(phase.plan.returned)} sats</strong> from {phase.plan.pieces} pieces (network fee {fmt(phase.plan.fee)} sats).
          </span>
          <button type="button" className="sec" onClick={() => sign(phase.plan)} style={{ ...btnSecondary, alignSelf: "flex-start", minHeight: 46, padding: "0 20px" }}>
            Return {fmt(phase.plan.returned)} sats with my wallet
          </button>
        </>
      )}
      {phase.k === "signing" && <Status>Confirm in your wallet…</Status>}
      {phase.k === "sending" && <Status>Sending it to the network…</Status>}
      {phase.k === "done" && <Done txid={phase.txid} />}
      {error && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
    </section>
  );
}

function Done({ txid }: { txid: string }) {
  return (
    <span role="status" style={{ fontSize: 15, color: "var(--green-ink)", fontWeight: 600 }}>
      Funds returned ·{" "}
      <a href={explorerTx(txid)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13 }}>
        {txid.slice(0, 8)}… ↗
      </a>
    </span>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
      <Spinner /> {children}
    </span>
  );
}
