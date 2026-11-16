import { useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/Headers";
import { CheckIcon, SliderLabel, Spinner } from "../components/ui";
import { useWalletState } from "../wallet/store";
import { fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";

// TODO(kernel): real checks — navigator.gpu, a known-answer test chunk, wallet address.
const CHECKS = ["Your browser supports WebGPU", "Your GPU gives the same answer as ours", "Payouts go to your connected wallet"];

export default function ProviderSetup() {
  const [stage, setStage] = useState(0);
  const [limit, setLimit] = useState(60);
  useWalletState();
  const ready = stage >= CHECKS.length;
  useInterval(() => setStage((s) => Math.min(CHECKS.length, s + 1)), ready ? null : 750);

  const goBase = { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 60, borderRadius: 999, fontWeight: 600, fontSize: 17, textDecoration: "none" } as const;

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 80px", display: "flex", flexDirection: "column", alignItems: "center", gap: 28, textAlign: "center" }}>
        <div className="in" style={{ width: "100%", borderRadius: 28, background: "#F0F7F3" }}>
          <svg viewBox="0 0 560 220" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="A gaming PC with spinning fans, ready to work">
            <ellipse cx="280" cy="196" rx="170" ry="10" fill="#DCEFE4" />
            <g stroke="#16161A" strokeWidth="2" strokeLinejoin="round">
              <rect x="160" y="50" width="100" height="144" rx="10" fill="#FFFFFF" />
              <rect x="280" y="74" width="130" height="86" rx="8" fill="#FFFFFF" />
              <rect x="290" y="84" width="110" height="66" rx="4" fill="#E4F5EC" />
              <line x1="345" y1="160" x2="345" y2="180" />
              <line x1="320" y1="182" x2="370" y2="182" />
              <circle cx="210" cy="92" r="24" fill="#FFFFFF" />
              <circle cx="210" cy="150" r="24" fill="#FFFFFF" />
            </g>
            <g className="fan" stroke="#16161A" strokeWidth="2" strokeLinecap="round"><line x1="210" y1="72" x2="210" y2="112" /><line x1="190" y1="92" x2="230" y2="92" /></g>
            <g className="fan" stroke="#16161A" strokeWidth="2" strokeLinecap="round"><line x1="210" y1="130" x2="210" y2="170" /><line x1="190" y1="150" x2="230" y2="150" /></g>
            <circle className="led" cx="244" cy="62" r="4" fill="#0AC18E" />
            <path d="M304 132 L322 114 L338 126 L362 100 L386 112" fill="none" stroke="#0AC18E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="440" cy="70" r="14" fill="#FFC85C" stroke="#16161A" strokeWidth="2" />
            <circle cx="466" cy="104" r="10" fill="#FFC85C" stroke="#16161A" strokeWidth="2" />
          </svg>
        </div>

        <div className="in d1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>Put your GPU to work</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>Runs safely in this tab. Earn {fmt(1200)} sats for every piece you finish.</p>
        </div>

        <ul className="in d2" aria-label="Setup checks" style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, textAlign: "left", listStyle: "none", margin: 0, padding: 0 }}>
          {CHECKS.map((title, i) => {
            const done = i < stage, active = i === stage;
            return (
              <li key={title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 16, background: "var(--surface)" }}>
                <span style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {done && (
                    <span className="tick" style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CheckIcon />
                    </span>
                  )}
                  {active && <Spinner size={16} />}
                  {!done && !active && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--chip-border)" }} />}
                </span>
                <span style={{ fontSize: 15, fontWeight: 500, color: i <= stage ? "var(--ink)" : "var(--faint)" }}>
                  {title}
                  <span className="sr-only">{done ? " (passed)" : active ? " (checking)" : " (waiting)"}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <label style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
          <SliderLabel label="Use up to" value={`${limit}% of my GPU`} />
          <input type="range" min={10} max={100} step={10} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>

        {ready ? (
          <Link to="/provider/earnings" className="go" style={{ ...goBase, background: "var(--ink)", color: "#FFFFFF" }}>
            Start earning
          </Link>
        ) : (
          <span role="status" aria-disabled="true" style={{ ...goBase, background: "var(--surface-2)", color: "var(--faint)" }}>
            Checking your setup…
          </span>
        )}
        <span style={{ fontSize: 13, color: "var(--faint)" }}>Close the tab any time to stop.</span>
        <Link to="/provider/machines" style={{ fontSize: 15, fontWeight: 600 }}>Have a gaming PC or rig? Connect a GPU machine →</Link>
      </main>
    </div>
  );
}
