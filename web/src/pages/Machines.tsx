import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { Segmented, Spinner, StatusDot, btnSecondary, card } from "../components/ui";
import { DEMO } from "../lib/demo";
import { fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";

type Os = "linux" | "windows" | "docker";

// TODO(api): pairing code comes from POST /providers/pairing.
const PAIRING_CODE = "NOVA-7K2Q";
const COMMANDS: Record<Os, string[]> = {
  linux: ["curl -fsSL [INSTALL URL] | sh", `nova-worker pair ${PAIRING_CODE}`],
  windows: ["iwr [INSTALL URL] -useb | iex", `nova-worker.exe pair ${PAIRING_CODE}`],
  docker: [`docker run -d --gpus all [IMAGE] pair ${PAIRING_CODE}`],
};

export default function Machines() {
  const [os, setOs] = useState<Os>("linux");
  const [copied, setCopied] = useState(-1);
  const [left, setLeft] = useState(600);
  const [paired, setPaired] = useState(false);
  const [paused, setPaused] = useState(false);
  const [limit, setLimit] = useState("80");
  const [stats, setStats] = useState({ n: 0, pieces: 0, earned: 0, rate: 0 });
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useInterval(() => {
    setLeft((l) => Math.max(0, l - 1));
    if (!paired || paused) return;
    setStats((s) => {
      const n = s.n + 1;
      const third = n % 3 === 0;
      return {
        n,
        rate: 1_180_000 + Math.round(90_000 * Math.sin(n * 0.7)),
        pieces: s.pieces + (third ? 1 : 0),
        earned: s.earned + (third ? DEMO.satsPerPiece : 0),
      };
    });
  }, 1000);

  function copy(cmd: string, i: number) {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    setCopied(i);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(-1), 1500);
  }

  const expires = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "expired, refresh for a new code";
  const stepTitle = (n: number, t: string) => (
    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
      <span style={{ color: "var(--faint)" }}>{n} ·</span> {t}
    </h2>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
          <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05 }}>Connect a GPU machine</h1>
            <p style={{ margin: 0, fontSize: 17, color: "var(--muted)", lineHeight: 1.55 }}>
              Run Nova on a gaming PC or a mining rig. Same kernel as the browser, at full native speed, so results match hash for hash.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 0, borderRadius: 24, background: "#F0F7F3" }}>
            <svg viewBox="0 0 420 170" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="A GPU machine linked to Nova">
              <ellipse cx="210" cy="152" rx="170" ry="8" fill="#DCEFE4" />
              <g stroke="#16161A" strokeWidth="2" strokeLinejoin="round">
                <rect x="40" y="36" width="96" height="112" rx="10" fill="#FFFFFF" />
                <rect x="54" y="52" width="68" height="14" rx="3" fill="#E4F5EC" />
                <rect x="54" y="74" width="68" height="14" rx="3" fill="#E4F5EC" />
                <rect x="54" y="96" width="68" height="14" rx="3" fill="#E4F5EC" />
                <rect x="300" y="58" width="72" height="72" rx="20" fill="#16161A" />
              </g>
              <circle cx="336" cy="94" r="12" fill="#0AC18E" />
              <circle className="breathe" cx="112" cy="59" r="3.5" fill="#0AC18E" />
              <circle className="breathe" cx="112" cy="81" r="3.5" fill="#0AC18E" style={{ animationDelay: ".4s" }} />
              <circle className="breathe" cx="112" cy="103" r="3.5" fill="#0AC18E" style={{ animationDelay: ".8s" }} />
              <path className="flow" d="M140 94 C 200 60, 240 128, 296 94" fill="none" stroke="#16161A" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <section className="in d1" aria-label="Step 1: install" style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {stepTitle(1, "Install the worker")}
            <Segmented<Os>
              label="Platform"
              size="sm"
              stretch={false}
              value={os}
              onChange={(v) => { setOs(v); setCopied(-1); }}
              options={[
                { value: "linux", label: "Linux / macOS" },
                { value: "windows", label: "Windows" },
                { value: "docker", label: "Docker" },
              ]}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {COMMANDS[os].map((cmd, i) => (
              <div key={cmd} className="mono" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "var(--ink)", color: "#EDEDEC", fontSize: 14, flexWrap: "wrap" }}>
                <span aria-hidden="true" style={{ color: "#3DDCA8" }}>$</span>
                <code style={{ flex: 1, minWidth: 200, wordBreak: "break-all", fontFamily: "inherit" }}>{cmd}</code>
                <button type="button" onClick={() => copy(cmd, i)} aria-label={`Copy command: ${cmd}`} style={{ minHeight: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #3A3A42", background: "transparent", color: "#EDEDEC", fontSize: 13, cursor: "pointer" }}>
                  {copied === i ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 13, color: "var(--faint)" }}>
            Needs a GPU with Vulkan, DirectX 12 or Metal. The worker only runs Nova's audited kernel; it never runs code sent by researchers.
          </span>
        </section>

        <section className="in d2" aria-label="Step 2: pair" style={{ ...card, flexDirection: "row", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {stepTitle(2, "Pair it with your wallet")}
            <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", lineHeight: 1.55 }}>
              The pairing code links the machine to your payout address. Earnings go straight to your wallet, never to the machine.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "18px 26px", borderRadius: 20, background: "var(--surface)" }}>
            <span className="mono" style={{ fontSize: 34, fontWeight: 500, letterSpacing: "0.08em" }}>{PAIRING_CODE}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>expires in {expires}</span>
          </div>
        </section>

        <section className="in d3" aria-label="Step 3: your machines" style={card}>
          {stepTitle(3, "Your machines")}
          {!paired ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 18, borderRadius: 16, background: "var(--surface)" }}>
              <span role="status" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: "var(--muted)" }}>
                <Spinner size={16} />
                Waiting for a machine to pair…
              </span>
              <button type="button" className="sec" onClick={() => { setPaired(true); setStats((s) => ({ ...s, rate: 1_180_000 })); }} style={{ ...btnSecondary, minHeight: 44, padding: "0 18px", fontSize: 14 }}>
                Simulate pairing
              </button>
            </div>
          ) : (
            <div className="pop" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 22, borderRadius: 20, background: "var(--mint)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>[MACHINE NAME]</span>
                  <span style={{ fontSize: 14, color: "var(--mint-ink)" }}>[GPU MODEL] · [VRAM] · Vulkan via wgpu</span>
                </div>
                <StatusDot paused={paused} live="Online · earning" size={14} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <MiniStat label="Self-test" value="Hash matched ✓" good />
                <MiniStat label="Speed" value={`${paused ? "0" : fmt(stats.rate)} particles/s`} />
                <MiniStat label="Pieces finished" value={String(stats.pieces)} />
                <MiniStat label="Earned" value={`${fmt(stats.earned)} sats`} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <button type="button" className="sec" onClick={() => setPaused((p) => !p)} style={{ ...btnSecondary, minHeight: 44, padding: "0 18px", fontSize: 14, border: "1px solid #C2E5D1" }}>
                  {paused ? "Resume" : "Pause"}
                </button>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--mint-ink)" }}>
                  Use up to
                  <select value={limit} onChange={(e) => setLimit(e.target.value)} style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid #C2E5D1", background: "#FFFFFF", fontSize: 14 }}>
                    <option value="50">50%</option>
                    <option value="80">80%</option>
                    <option value="100">100%</option>
                  </select>
                  of the GPU
                </label>
                <Link to="/provider/earnings" style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600 }}>See earnings →</Link>
              </div>
            </div>
          )}
        </section>

        <p style={{ margin: 0, textAlign: "center", fontSize: 14, color: "var(--muted)" }}>
          No machine? <Link to="/provider" style={{ fontWeight: 600 }}>Use this browser instead</Link>
        </p>
      </main>
    </div>
  );
}

function MiniStat({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: "#FFFFFF", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 16, fontWeight: 700, color: good ? "var(--green-ink)" : undefined }}>{value}</span>
    </div>
  );
}
