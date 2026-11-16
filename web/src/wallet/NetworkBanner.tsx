import { NETWORK } from "../config/env";
import { useWalletState } from "./store";

/**
 * Network guard. WizardConnect doesn't report a network, so this uses the xpub prefix as a hint:
 * definite when the wallet's keys are test-network keys on a mainnet app; otherwise a reminder.
 */
export function NetworkBanner({ compact = false }: { compact?: boolean }) {
  const w = useWalletState();
  if (w.status !== "connected") return null;
  const want = NETWORK === "mainnet" ? "mainnet" : "chipnet";
  let text: string | null = null;
  if (NETWORK === "mainnet" && w.network === "chipnet") {
    text = "Your wallet is on a test network, but Nova is running on BCH mainnet. Switch your wallet to mainnet and reconnect.";
  } else if (NETWORK === "chipnet" && w.network === "mainnet") {
    text = "Nova is running on chipnet (test BCH). Your wallet's keys look like mainnet keys: make sure it's switched to chipnet before you fund or earn.";
  }
  if (!text && compact) return null;
  return (
    <div role={text ? "alert" : "note"} style={{ width: "100%", padding: "12px 16px", borderRadius: 14, background: text ? "#FFF6E3" : "var(--surface)", color: text ? "#6B4700" : "var(--muted)", fontSize: 14, lineHeight: 1.5, textAlign: "left" }}>
      {text ?? `Nova is running on ${want}. Make sure your wallet is on ${want} too.`}
    </div>
  );
}
