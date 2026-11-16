import { useEffect, useRef, useState } from "react";
import { api, humanError } from "../api/client";
import { AppHeader } from "../components/Headers";
import { Loading, Notice } from "../components/Notice";
import { explorerTx } from "../config/env";
import { fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";
import { usePoll } from "../lib/usePoll";
import { useWorkerSession } from "../lib/workerSession";

export default function Earnings() {
  const session = useWorkerSession();
  const me = usePoll((s) => api.me(session!.token, s), 5000, [session?.token], !!session);
  const earned = me.data?.earned_sats ?? 0;

  // Count up smoothly to the real total; show the coin when it grows.
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

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 24 }}>
        {!session ? (
          <Notice title="You're not earning yet" action={{ to: "/provider", label: "Set up my GPU" }}>
            Run the setup checks and start earning; your payouts will show up here.
          </Notice>
        ) : me.error && !me.data ? (
          <Notice title="Couldn't load your earnings" tone="warn">{humanError(me.error)}</Notice>
        ) : !me.data ? (
          <Loading label="Loading your earnings…" />
        ) : (
          <>
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

            <section aria-label="Recent payouts" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Recent payouts</h2>
              {(me.data.recent_payouts ?? []).length === 0 && <span style={{ fontSize: 15, color: "var(--muted)" }}>No payouts yet.</span>}
              {(me.data.recent_payouts ?? []).map((p) => (
                <div key={`${p.job_id}-${p.index}`} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", flexWrap: "wrap", fontSize: 15 }}>
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
