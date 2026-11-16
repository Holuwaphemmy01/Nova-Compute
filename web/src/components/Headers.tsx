import { Link, NavLink } from "react-router-dom";
import { Logo } from "./ui";
import { shortAddress } from "../config/env";
import { useWalletState } from "../wallet/store";

const wrap = (max: number) => ({
  maxWidth: max,
  margin: "0 auto",
  padding: "18px 32px",
  display: "flex",
  alignItems: "center",
  gap: 28,
  flexWrap: "wrap" as const,
});

function Brand({ size = 26, text = 18 }: { size?: number; text?: number }) {
  return (
    <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
      <Logo size={size} />
      <span style={{ fontSize: text, fontWeight: 700, letterSpacing: "-0.02em" }}>Nova</span>
    </Link>
  );
}

const tabStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? "var(--ink)" : "var(--muted)",
  fontWeight: isActive ? 600 : 400,
  textDecoration: "none",
});

/** Public header for the landing page and the simulation lab. */
export function SiteHeader({ active }: { active?: "lab" }) {
  return (
    <header style={{ ...wrap(1160), padding: "20px 32px", justifyContent: "space-between", gap: 16 }}>
      <Brand size={28} text={20} />
      <nav aria-label="Main" style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 15, flexWrap: "wrap" }}>
        {active === "lab" ? (
          <Link to="/" className="nl" style={{ color: "var(--muted)", textDecoration: "none" }}>Home</Link>
        ) : (
          <a href="#how" className="nl" style={{ color: "var(--muted)", textDecoration: "none" }}>How it works</a>
        )}
        <Link
          to="/lab"
          className="nl"
          aria-current={active === "lab" ? "page" : undefined}
          style={{ color: active === "lab" ? "var(--ink)" : "var(--muted)", fontWeight: active === "lab" ? 600 : 400, textDecoration: "none" }}
        >
          Simulation lab
        </Link>
        <Link to="/connect" className="pri" style={{ background: "var(--ink)", color: "#FFFFFF", textDecoration: "none", padding: "11px 20px", borderRadius: 999, fontWeight: 600, fontSize: 14 }}>
          Open app
        </Link>
      </nav>
    </header>
  );
}

/** Minimal header with a back link (wallet connect). */
export function BareHeader() {
  return (
    <header style={{ ...wrap(1160), padding: "20px 32px", justifyContent: "space-between", gap: 16 }}>
      <Brand size={28} text={20} />
      <Link to="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 15 }}>Back</Link>
    </header>
  );
}

type Role = "researcher" | "provider";

const NAV: Record<Role, { to: string; label: string }[]> = {
  researcher: [
    { to: "/jobs", label: "My jobs" },
    { to: "/jobs/new", label: "New job" },
  ],
  provider: [
    { to: "/provider", label: "Set up" },
    { to: "/provider/machines", label: "Machines" },
    { to: "/provider/earnings", label: "Earnings" },
  ],
};

/** Signed-in app header: researcher or provider tabs plus the wallet chip. */
export function AppHeader({ role }: { role: Role }) {
  const wallet = useWalletState();
  return (
    <header style={wrap(1000)}>
      <Brand />
      <nav aria-label={role === "researcher" ? "Researcher" : "Provider"} style={{ display: "flex", gap: 22, fontSize: 15, flexWrap: "wrap" }}>
        {NAV[role].map((n) => (
          // "end": exact match, so "My jobs" isn't also active on /jobs/new; /provider likewise.
          <NavLink key={n.to} to={n.to} end className="tab" style={tabStyle}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      {wallet.address ? (
        <Link
          to={`/connect?role=${role}`}
          className="mono"
          title={`Connected wallet: ${wallet.address}`}
          style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 999, background: "var(--surface-2)", fontSize: 12, color: "var(--muted)", textDecoration: "none" }}
        >
          {shortAddress(wallet.address)}
        </Link>
      ) : (
        <Link
          to={`/connect?role=${role}`}
          style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 999, background: "var(--ink)", fontSize: 13, fontWeight: 600, color: "#FFFFFF", textDecoration: "none" }}
        >
          {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
        </Link>
      )}
    </header>
  );
}
