import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BareHeader } from "../components/Headers";
import { CheckIcon, Segmented, Spinner, btnPrimary } from "../components/ui";
import { useWalletState } from "../wallet/store";

type Role = "researcher" | "provider";

/** Placeholder 21×21 QR-like grid with three finder patterns.
 *  Replaced by the real WizardConnect pairing URI once the wallet is wired up. */
function useQrCells() {
  return useMemo(() => {
    const finder = (x: number, y: number) => {
      const f = (ox: number, oy: number) => {
        const dx = x - ox, dy = y - oy;
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
        return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5);
      };
      return f(0, 0) ?? f(14, 0) ?? f(0, 14);
    };
    const cells: boolean[] = [];
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) cells.push(finder(x, y) ?? (x * 7 + y * 13 + x * y) % 5 < 2);
    return cells;
  }, []);
}

export default function Connect() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "provider" ? "provider" : "researcher");
  const [connected, setConnected] = useState(false);
  const wallet = useWalletState();
  const qr = useQrCells();

  return (
    <div style={{ minHeight: "100vh" }}>
      <BareHeader />
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "32px 24px 80px", display: "flex", flexDirection: "column", alignItems: "center", gap: 28, textAlign: "center" }}>
        <div className="in" style={{ width: 200 }}>
          <svg viewBox="0 0 200 130" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="A friendly wallet with a coin">
            <ellipse cx="100" cy="118" rx="70" ry="8" fill="#F0F7F3" />
            <g className="bob">
              <g stroke="#16161A" strokeWidth="2" strokeLinejoin="round">
                <rect x="40" y="34" width="120" height="76" rx="16" fill="#FFFFFF" />
                <path d="M40 56 L160 56" fill="none" />
                <rect x="120" y="66" width="40" height="24" rx="8" fill="#C2E5D1" />
                <circle cx="138" cy="78" r="4" fill="#16161A" />
                <circle cx="74" cy="22" r="14" fill="#FFC85C" />
              </g>
              <path d="M70 22 L78 22 M74 17 L74 27" stroke="#16161A" strokeWidth="2" strokeLinecap="round" />
            </g>
          </svg>
        </div>

        <div className="in" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>Connect your wallet</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>Pick a role, then approve with WizardConnect.</p>
        </div>

        <div className="in d1" style={{ width: "100%" }}>
          <Segmented<Role>
            label="Role"
            size="lg"
            value={role}
            onChange={setRole}
            options={[
              { value: "researcher", label: "I have a simulation" },
              { value: "provider", label: "I have a GPU" },
            ]}
          />
        </div>

        {!connected ? (
          <div className="in d1" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <div role="img" aria-label="WizardConnect pairing QR code" style={{ width: 210, height: 210, padding: 14, borderRadius: 24, background: "#FFFFFF", border: "1px solid var(--line)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(21, minmax(0, 1fr))", width: "100%", height: "100%" }}>
                {qr.map((dark, i) => (
                  <span key={i} style={{ display: "block", aspectRatio: "1", borderRadius: 1, background: dark ? "#16161A" : "transparent" }} />
                ))}
              </div>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--muted)" }}>
              <Spinner size={12} />
              Scan with your BCH wallet
            </span>
            {/* TODO(wallet): replace with the WizardConnect session approval. */}
            <button type="button" className="pri" onClick={() => setConnected(true)} style={{ ...btnPrimary, width: "100%", minHeight: 54, fontSize: 16 }}>
              Approve in wallet
            </button>
          </div>
        ) : (
          <div className="swap" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }} role="status">
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckIcon size={28} width={2.4} animate />
            </span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>You're in</span>
            <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>
              {wallet.address ?? "No wallet connected"}
            </span>
            <Link to={role === "researcher" ? "/jobs" : "/provider"} className="pri" style={{ ...btnPrimary, width: "100%", minHeight: 54, marginTop: 8, fontSize: 16 }}>
              {role === "researcher" ? "Go to my jobs" : "Set up my GPU"}
            </Link>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 13, color: "var(--faint)" }}>Nova never holds your keys.</p>
      </main>
    </div>
  );
}
