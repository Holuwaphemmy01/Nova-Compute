import { useState } from "react";
import { api, humanError, type Job } from "../api/client";
import { Spinner, btnPrimary, btnSecondary } from "../components/ui";
import { fmt } from "../lib/random";
import { buildFunding, discoverUtxos, type FundingPlan } from "./chain";
import { NetworkBanner } from "./NetworkBanner";
import { useWallet } from "./wizard";

type Phase =
  | { k: "idle" }
  | { k: "preparing" }
  | { k: "review"; plan: FundingPlan }
  | { k: "signing"; plan: FundingPlan; ctrl: AbortController }
  | { k: "submitting" }
  | { k: "done"; txid: string };

/** Funds a job's escrow from the connected wallet: plan → review → wallet signs → coordinator broadcasts. */
export function FundPanel({ job, onFunded }: { job: Job; onFunded: () => void }) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [error, setError] = useState<string | null>(null);
  const isOwner = wallet.address === job.researcher_addr;

  async function prepare() {
    setError(null);
    setPhase({ k: "preparing" });
    try {
      const utxos = await discoverUtxos(wallet.getPubkey);
      setPhase({ k: "review", plan: buildFunding(job, utxos, wallet.address!) });
    } catch (e) {
      setError(humanError(e));
      setPhase({ k: "idle" });
    }
  }

  async function sign(plan: FundingPlan) {
    const ctrl = new AbortController();
    setError(null);
    setPhase({ k: "signing", plan, ctrl });
    try {
      const signed = await wallet.signTransaction(plan.tx, { signal: ctrl.signal });
      setPhase({ k: "submitting" });
      const funded = await api.fundJob(wallet.address!, job.job_id, signed);
      setPhase({ k: "done", txid: funded.funding_txid ?? "" });
      onFunded();
    } catch (e) {
      setError(humanError(e));
      setPhase({ k: "review", plan });
    }
  }

  const box = { padding: 24, borderRadius: 24, border: "1px solid var(--line)", display: "flex", flexDirection: "column" as const, gap: 14 };

  return (
    <section className="in" aria-label="Fund this job" style={box}>
      <span style={{ fontSize: 18, fontWeight: 700 }}>Fund the escrow</span>
      <span style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.55 }}>
        You'll lock <strong style={{ color: "var(--ink)" }}>{fmt(job.total_sats)} sats</strong> in escrow for {fmt(job.chunk_count)} pieces. Providers are paid from it piece by piece, only for
        results that check out; anything unused comes back to you.
      </span>
      <NetworkBanner compact />

      {!wallet.connected ? (
        <span style={{ fontSize: 15, color: "var(--muted)" }}>Connect your wallet to fund this job.</span>
      ) : !isOwner ? (
        <span role="alert" style={{ fontSize: 15, color: "#8A5A00" }}>
          This job belongs to {job.researcher_addr}. Connect that wallet to fund it.
        </span>
      ) : phase.k === "idle" ? (
        <button type="button" className="pri" onClick={prepare} style={{ ...btnPrimary, minHeight: 56, fontSize: 16 }}>
          Review funding
        </button>
      ) : phase.k === "preparing" ? (
        <Status>Finding coins in your wallet…</Status>
      ) : phase.k === "review" ? (
        <>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: 15 }}>
            <dt style={{ color: "var(--muted)" }}>Locked in escrow</dt>
            <dd className="tnum" style={{ margin: 0, fontWeight: 600 }}>{fmt(phase.plan.locked)} sats</dd>
            <dt style={{ color: "var(--muted)" }}>Network fee</dt>
            <dd className="tnum" style={{ margin: 0 }}>{fmt(phase.plan.fee)} sats</dd>
            <dt style={{ color: "var(--muted)" }}>Escrow address</dt>
            <dd className="mono" style={{ margin: 0, fontSize: 12, wordBreak: "break-all" }}>{job.escrow_address}</dd>
          </dl>
          <button type="button" className="pri" onClick={() => sign(phase.plan)} style={{ ...btnPrimary, minHeight: 56, fontSize: 16 }}>
            Lock {fmt(phase.plan.locked)} sats with my wallet
          </button>
        </>
      ) : phase.k === "signing" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <Status>Confirm in your wallet…</Status>
          <button type="button" className="sec" onClick={() => phase.ctrl.abort()} style={{ ...btnSecondary, minHeight: 40, padding: "0 16px", fontSize: 14 }}>
            Cancel
          </button>
        </div>
      ) : phase.k === "submitting" ? (
        <Status>Sending it to the network…</Status>
      ) : (
        <span role="status" style={{ fontSize: 15, fontWeight: 600, color: "var(--green-ink)" }}>Funded. It's running.</span>
      )}

      {error && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
    </section>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)" }}>
      <Spinner /> {children}
    </span>
  );
}
