import { AlphanumericQRCode } from "@wizardconnect/react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BareHeader } from "../components/Headers";
import { CheckIcon, Segmented, Spinner, btnPrimary, btnSecondary } from "../components/ui";
import { copyText } from "../lib/browser";
import { NetworkBanner } from "../wallet/NetworkBanner";
import { useWallet } from "../wallet/wizard";

type Role = "researcher" | "provider";

export default function Connect() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "provider" ? "provider" : "researcher");
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // Start pairing as soon as the page opens (unless a stored session is reconnecting).
  useEffect(() => {
    if (!started.current && (wallet.wcState === "idle" || wallet.wcState === "disconnected")) {
      started.current = true;
      wallet.connect();
    }
  }, [wallet]);

  async function copy() {
    if (wallet.uri && (await copyText(wallet.uri))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function disconnect() {
    await wallet.disconnect();
    started.current = false; // a fresh pairing code is shown
  }

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
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>{wallet.connected ? "Wallet connected" : "Connect your wallet"}</h1>
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

        {wallet.connected ? (
          <div className="swap" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }} role="status">
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckIcon size={28} width={2.4} animate />
            </span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>You're in{wallet.walletName ? ` with ${wallet.walletName}` : ""}</span>
            <span className="mono" style={{ fontSize: 13, color: "var(--muted)", wordBreak: "break-all" }}>{wallet.address}</span>
            <NetworkBanner />
            <Link to={role === "researcher" ? "/jobs" : "/provider"} className="pri" style={{ ...btnPrimary, width: "100%", minHeight: 54, marginTop: 8, fontSize: 16 }}>
              {role === "researcher" ? "Go to my jobs" : "Set up my GPU"}
            </Link>
            <button type="button" className="sec" onClick={disconnect} style={{ ...btnSecondary, minHeight: 46, padding: "0 20px", fontSize: 14 }}>
              Disconnect
            </button>
          </div>
        ) : wallet.qrUri && wallet.uri ? (
          <div className="in d1" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <div role="img" aria-label="WizardConnect pairing QR code" style={{ width: 210, height: 210, padding: 14, borderRadius: 24, background: "#FFFFFF", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AlphanumericQRCode value={wallet.qrUri} size={180} foreground="#16161A" background="#FFFFFF" quietZone={0} />
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--muted)" }}>
              <Spinner size={12} />
              Scan with a WizardConnect wallet (e.g. Paytaca)
            </span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
              <a href={wallet.uri} className="pri" style={{ ...btnPrimary, flex: "1 1 200px", minHeight: 54, fontSize: 16 }}>
                Open in wallet app
              </a>
              <button type="button" className="sec" onClick={copy} aria-label="Copy pairing link" style={{ ...btnSecondary, flex: "0 1 auto", minHeight: 54, padding: "0 20px" }}>
                <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
              </button>
            </div>
          </div>
        ) : (
          <span role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)", minHeight: 60 }}>
            <Spinner /> {wallet.wcState === "reconnecting" || wallet.wcState === "connecting" ? "Reconnecting to your wallet…" : "Preparing a pairing code…"}
          </span>
        )}

        {wallet.connectError && (
          <p role="alert" style={{ margin: 0, width: "100%", padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>
            Couldn't connect: {wallet.connectError}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 13, color: "var(--faint)" }}>Nova never holds your keys.</p>
      </main>
    </div>
  );
}
