import { useEffect, useRef, useState } from "react";
import { api, humanError } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Loading, Notice } from "../components/Notice";
import { Tracks } from "../components/Tracks";
import { SpinGrid } from "../components/charts";
import { ProgressBar, StatusDot, btnSecondary } from "../components/ui";
import { explorerTx } from "../config/env";
import { browserWorker, useBrowserWorker } from "../lib/browserWorker";
import { fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";
import { usePoll } from "../lib/usePoll";
import { useWorkerSession } from "../lib/workerSession";

const STATUS_TEXT: Record<string, string> = {
  waiting: "Waiting for work",
  computing: "Earning now",
  submitting: "Earning now",
  resting: "Earning now (resting to stay under your limit)",
};

export default function Earnings() {
  const session = useWorkerSession();
  const loop = useBrowserWorker();
  const me = usePoll((s) => api.me(session!.token, s), 4000, [session?.token], !!session);
  const earned = me.data?.earned_sats ?? 0;
  const running = browserWorker.running;

  // Count up smoothly to the real total; fire the coin when a new payout lands.
  const [shown, setShown] = useState(0);
  const [coinKey, setCoinKey] = useState(0);
  const [gain, setGain] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (me.data === undefined) return;
    if (last.current !== null && earned > last.current) {
      setGain(earned - last.current);
      setCoinKey((k) => k + 1);
    }
    if (last.current === null) setShown(earned);
    last.current = earned;
  }, [earned, me.data]);
  useInterval(() => setShown((s) => (s < earned ? Math.min(earned, s + Math.ceil((earned - s) / 5)) : s)), shown < earned ? 80 : null);

  const cur = loop.current;
  const pct = cur ? Math.floor((100 * cur.done) / Math.max(1, cur.total)) : 0;
  const scale = 200 / (cur?.thicknessCm ?? 10);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 24 }}>
        {!session ? (
          <Notice title="You're not earning yet" action={{ to: "/provider", label: "Set up my computer" }}>
            Run the setup checks and start earning; your payouts will show up here.
          </Notice>
        ) : (
          <>
            <div className="in" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <StatusDot paused={!running} live={STATUS_TEXT[loop.status] ?? "Earning now"} pausedText={loop.status === "error" ? "Stopped" : "Paused"} />
              <button type="button" className="sec" onClick={() => (running ? browserWorker.pause() : browserWorker.start())} style={{ ...btnSecondary, minHeight: 46, padding: "0 22px" }}>
                {running ? "Pause" : "Resume"}
              </button>
            </div>
            {loop.message && <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{loop.message}</p>}

            {me.error && !me.data ? (
              <Notice title="Couldn't load your earnings" tone="warn">{humanError(me.error)}</Notice>
            ) : !me.data ? (
              <Loading label="Loading your earnings…" />
            ) : (
              <section className="in d1" style={{ position: "relative", borderRadius: 28, background: "var(--mint)", padding: 36, display: "flex", flexDirection: "column", gap: 8, textAlign: "center", alignItems: "center", overflow: "hidden" }}>
                <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>You've earned</span>
                <span className="tnum" style={{ fontSize: "clamp(64px, 12vw, 104px)", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.06em" }}>{fmt(shown)}</span>
                <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>
                  sats · {me.data.verified} pieces checked{me.data.mismatched ? ` · ${me.data.mismatched} didn't match` : ""}
                </span>
                {coinKey > 0 && (
                  <span key={coinKey} className="coin" aria-hidden="true" style={{ position: "absolute", top: 34, right: "18%", padding: "6px 12px", borderRadius: 999, background: "var(--coin)", border: "2px solid var(--ink)", fontWeight: 700, fontSize: 14 }}>
                    +{fmt(gain)}
                  </span>
                )}
              </section>
            )}

            <section className="in d2" style={{ borderRadius: 24, background: "var(--surface)", overflow: "hidden" }}>
              {cur?.template === "ising_2d" ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                  <SpinGrid L={cur.lattice?.L ?? 32} bits={cur.lattice?.bits ?? null} size={170} label="The piece your device is working on: a magnet's spins settling at one temperature" />
                </div>
              ) : cur?.template === "sir_epidemic" ? (
                <div role="img" aria-label="The piece your device is working on: simulated epidemic outbreaks" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "40px 16px", fontSize: 15, color: "var(--muted)" }}>
                  <svg width="44" height="30" viewBox="0 0 44 30" aria-hidden="true"><path d="M2 28 C 12 28, 15 3, 22 3 S 34 27, 42 28" fill="none" stroke="#0AC18E" strokeWidth="2.4" strokeLinecap="round" /></svg>
                  Simulating outbreak {fmt(cur.done)} of {fmt(cur.total)}
                </div>
              ) : (
                <svg viewBox="0 0 480 170" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="The piece your device is working on: particles moving through a wall">
                  <defs><clipPath id="wc"><rect x="0" y="0" width="480" height="170" /></clipPath></defs>
                  <rect x="140" y="0" width="200" height="170" fill="#ECECE7" />
                  <g clipPath="url(#wc)">
                    <Tracks tracks={loop.tracks} x={(v) => 140 + v * scale} y={(v) => 85 + v * scale} />
                  </g>
                </svg>
              )}
              <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>
                    {cur ? `Working on piece ${cur.index}` : loop.status === "submitting" ? "Sending the result…" : running ? "Waiting for the next piece…" : "Not working"}
                  </span>
                  <span className="mono" style={{ color: "var(--muted)" }}>{cur ? `${pct}%` : ""}</span>
                </div>
                <ProgressBar value={pct} color="var(--ink)" height={8} label="Current piece progress" />
              </div>
            </section>

            <section aria-label="Recent payouts" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Recent payouts</h2>
              {(me.data?.recent_payouts ?? []).length === 0 && <span style={{ fontSize: 15, color: "var(--muted)" }}>No payouts yet. They arrive once another provider's result matches yours.</span>}
              {(me.data?.recent_payouts ?? []).map((p, i) => (
                <div key={`${p.job_id}-${p.index}`} className={i === 0 && coinKey > 0 ? "pay" : undefined} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", flexWrap: "wrap", fontSize: 15 }}>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--coin)", border: "2px solid var(--ink)", flex: "none" }} />
                  <span style={{ fontWeight: 600 }}>+{fmt(p.sats)} sats</span>
                  <span style={{ color: "var(--muted)" }}>piece {p.index}</span>
                  <a href={explorerTx(p.txid)} target="_blank" rel="noreferrer" className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>
                    {p.txid.slice(0, 4)}…{p.txid.slice(-4)} ↗
                  </a>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
