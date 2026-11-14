import { useRef, useState } from "react";
import { AppHeader } from "../components/Headers";
import { Tracks } from "../components/Tracks";
import { ProgressBar, StatusDot, btnSecondary } from "../components/ui";
import { DEMO } from "../lib/demo";
import { fakeTx, fmt, mulberry32 } from "../lib/random";
import { useInterval } from "../lib/useInterval";
import { walk, type Track } from "../lib/walk";

interface Payout {
  chunk: number;
  tx: string;
  isNew: boolean;
}

const payout = (chunk: number, isNew = false): Payout => ({ chunk, tx: fakeTx(chunk), isNew });

export default function Earnings() {
  const rand = useRef(mulberry32(414));
  const [paused, setPaused] = useState(false);
  const [n, setN] = useState(0);
  const [progress, setProgress] = useState(0);
  const [chunk, setChunk] = useState(414);
  const [completed, setCompleted] = useState(3);
  const [earned, setEarned] = useState(3 * DEMO.satsPerPiece);
  const [shown, setShown] = useState(3 * DEMO.satsPerPiece);
  const [coinAt, setCoinAt] = useState(-99);
  const [feed, setFeed] = useState<Payout[]>([payout(413), payout(412), payout(411)]);
  const [tracks, setTracks] = useState<Track[]>([]);

  // TODO(kernel+api): drive this from the worker's real chunk progress and payout events.
  useInterval(() => {
    const tick = n + 1;
    setN(tick);
    if (shown < earned) setShown(Math.min(earned, shown + Math.ceil((earned - shown) / 5)));
    if (paused) return;
    if (tick % 3 === 0) {
      const w = walk(rand.current, { thickness: 10, mfp: 3, absorb: 0.18, y0: 2.65, spread: 2.4, entry: 7, exit: 7, back: 7, maxSteps: 50, keep: true });
      setTracks((t) => [w, ...t].slice(0, 16));
    }
    const p = progress + 2.5;
    if (p >= 100) {
      setProgress(0);
      setFeed((f) => [payout(chunk, true), ...f.map((x) => ({ ...x, isNew: false }))].slice(0, 3));
      setChunk(chunk + 1);
      setCompleted(completed + 1);
      setEarned(earned + DEMO.satsPerPiece);
      setCoinAt(tick);
    } else setProgress(p);
  }, 100);

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="in" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <StatusDot paused={paused} live="Earning now" />
          <button type="button" className="sec" onClick={() => setPaused((p) => !p)} style={{ ...btnSecondary, minHeight: 46, padding: "0 22px" }}>
            {paused ? "Resume" : "Pause"}
          </button>
        </div>

        <section className="in d1" style={{ position: "relative", borderRadius: 28, background: "var(--mint)", padding: 36, display: "flex", flexDirection: "column", gap: 8, textAlign: "center", alignItems: "center", overflow: "hidden" }}>
          <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>You've earned</span>
          <span className="tnum" style={{ fontSize: "clamp(64px, 12vw, 104px)", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.06em" }}>{fmt(shown)}</span>
          <span style={{ fontSize: 16, color: "var(--mint-ink)" }}>sats · {completed} pieces finished</span>
          {n - coinAt < 12 && (
            <span className="coin" aria-hidden="true" style={{ position: "absolute", top: 34, right: "18%", padding: "6px 12px", borderRadius: 999, background: "var(--coin)", border: "2px solid var(--ink)", fontWeight: 700, fontSize: 14 }}>
              +{fmt(DEMO.satsPerPiece)}
            </span>
          )}
        </section>

        <section className="in d2" style={{ borderRadius: 24, background: "var(--surface)", overflow: "hidden" }}>
          <svg viewBox="0 0 480 170" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="The piece your GPU is working on: particles moving through a wall">
            <defs><clipPath id="wc"><rect x="0" y="0" width="480" height="170" /></clipPath></defs>
            <rect x="140" y="0" width="200" height="170" fill="#ECECE7" />
            <g clipPath="url(#wc)">
              <Tracks tracks={tracks} x={(v) => 140 + v * 20} y={(v) => v * 32} />
            </g>
          </svg>
          <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>Working on piece {chunk}</span>
              <span className="mono" style={{ color: "var(--muted)" }}>{Math.floor(progress)}%</span>
            </div>
            <ProgressBar value={progress} color="var(--ink)" height={8} label={`Piece ${chunk} progress`} />
          </div>
        </section>

        <section aria-label="Recent payouts" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Recent payouts</h2>
          {feed.map((f) => (
            <div key={f.chunk} className={f.isNew ? "pay" : undefined} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", flexWrap: "wrap", fontSize: 15 }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--coin)", border: "2px solid var(--ink)", flex: "none" }} />
              <span style={{ fontWeight: 600 }}>+{fmt(DEMO.satsPerPiece)} sats</span>
              <span style={{ color: "var(--muted)" }}>piece {f.chunk}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>{f.tx}</span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
