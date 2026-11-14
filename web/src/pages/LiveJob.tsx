import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { LegendDot, btnPrimary } from "../components/ui";
import { DEMO } from "../lib/demo";
import { fakeTx, fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";

/** p = pending, c = computing, v = verified & paid, r = mismatch, reassigned */
type Cell = "p" | "c" | "v" | "r";

interface LogLine {
  id: number;
  color: string;
  chunk: number;
  text: string;
  tx: string;
}

interface Sim {
  cells: Cell[];
  hist: number[];
  seq: number;
  log: LogLine[];
  doneAt: number;
}

const N = DEMO.jobPieces;
const MAX_IN_FLIGHT = 14;

/** Running estimate that converges towards 21.4% (demo data). */
const est = (n: number) => 0.214 + (0.05 * Math.sin(n * 1.7) + 0.03 * Math.cos(n * 0.61)) / Math.sqrt(n);

function fresh(): Sim {
  const cells = Array.from({ length: N }, (_, i): Cell => (i < 60 ? "v" : "p"));
  const hist = Array.from({ length: 60 }, (_, i) => est(i + 1));
  return { cells, hist, seq: 0, log: [], doneAt: 0 };
}

/** Pure, deterministic step of the demo scheduler (safe to run twice in StrictMode).
 *  TODO(api): replace with WebSocket events from the coordinator. */
function step(s: Sim): Sim {
  const seq = s.seq + 1;
  if (s.cells.every((c) => c === "v")) {
    if (!s.doneAt) return { ...s, seq, doneAt: seq };
    if (seq - s.doneAt > 16) return fresh(); // loop the demo
    return { ...s, seq };
  }
  const cells = s.cells.slice();
  const hist = s.hist.slice();
  const log = s.log.slice();
  cells.forEach((c, i) => {
    const r = ((i * 9301 + seq * 49297) % 233280) / 233280;
    if (c === "c" && r < 0.22) {
      if (r < 0.012) {
        cells[i] = "r";
        log.unshift({ id: seq * 1000 + i, color: "#FFC85C", chunk: i, text: "results didn't match, sent to someone else", tx: "not paid" });
      } else {
        cells[i] = "v";
        hist.push(est(hist.length + 1));
        log.unshift({ id: seq * 1000 + i, color: "#0AC18E", chunk: i, text: `checked · 2 providers paid ${fmt(DEMO.satsPerPiece)} sats each`, tx: fakeTx(seq * 1000 + i) });
      }
    } else if (c === "r" && r < 0.3) cells[i] = "c";
  });
  let inFlight = cells.filter((c) => c === "c").length;
  for (let i = 0; i < N && inFlight < MAX_IN_FLIGHT; i++)
    if (cells[i] === "p") {
      cells[i] = "c";
      inFlight++;
    }
  return { cells, hist, seq, log: log.slice(0, 3), doneAt: 0 };
}

const CELL_BASE: CSSProperties = { display: "block", aspectRatio: "1", borderRadius: 3 };
const CELL: Record<Cell, { cls?: string; style: CSSProperties }> = {
  p: { style: { ...CELL_BASE, background: "#ECECE7" } },
  c: { cls: "computing", style: { ...CELL_BASE, background: "#16161A" } },
  v: { cls: "verified", style: { ...CELL_BASE, background: "#0AC18E" } },
  r: { cls: "reassigned", style: { ...CELL_BASE, background: "#FFC85C", border: "1px solid #16161A", borderRadius: "50%" } },
};

export default function LiveJob() {
  const [sim, setSim] = useState<Sim>(fresh);
  useInterval(() => setSim(step), 320);

  const verified = sim.cells.filter((c) => c === "v").length;
  const computing = sim.cells.filter((c) => c === "c").length;
  const complete = verified >= N;
  const last = sim.hist[sim.hist.length - 1] ?? 0.214;
  const log = sim.log.length ? sim.log : [{ id: 0, color: "#DCDCD8", chunk: 60, text: "sending pieces to providers…", tx: "" }];

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="researcher" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link to="/jobs" style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}>← My jobs</Link>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: "-0.04em" }}>Particles through a 10 cm wall</h1>
        </div>

        <div className="in d1" style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <BigStat label={complete ? "Done" : `Running on ${computing * 2} GPUs right now`} value={`${Math.round((verified / N) * 100)}%`} sub={`${verified} of ${N} pieces checked`} />
          <BigStat label="Answer so far" value={`${(last * 100).toFixed(1)}%`} sub={`of particles get through · ± ${(5 / Math.sqrt(Math.max(1, sim.hist.length))).toFixed(2)}%`} mint />
        </div>

        <section className="in d2" aria-label="Pieces" style={{ padding: 28, borderRadius: 24, border: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Every piece of the job</h2>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
              <LegendDot color="#16161A">Running</LegendDot>
              <LegendDot color="#0AC18E">Checked and paid</LegendDot>
              <LegendDot color="#FFC85C" round outlined>Didn't match, retrying</LegendDot>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(20, minmax(0, 1fr))", gap: 5 }} role="img" aria-label={`${verified} of ${N} pieces checked, ${computing} running`}>
            {sim.cells.map((c, i) => (
              <span key={i} className={CELL[c].cls} style={CELL[c].style} />
            ))}
          </div>
        </section>

        <section aria-label="Latest payments" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>Latest payments</h2>
          {log.map((l) => (
            <div key={l.id} className="log-in" style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 18px", borderRadius: 14, background: "var(--surface)", flexWrap: "wrap", fontSize: 15 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />
              <span style={{ fontWeight: 600 }}>Piece {l.chunk}</span>
              <span style={{ color: "var(--muted)" }}>{l.text}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>{l.tx}</span>
            </div>
          ))}
        </section>

        {complete && (
          <Link to="/results" className="pri" style={{ ...btnPrimary, alignSelf: "center", minHeight: 54, padding: "0 28px", fontSize: 16 }}>
            See the result →
          </Link>
        )}
      </main>
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
