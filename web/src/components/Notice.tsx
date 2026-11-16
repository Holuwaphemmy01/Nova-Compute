import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Spinner, btnPrimary } from "./ui";

/** Soft panel used for empty, loading, "connect your wallet" and error states. */
export function Notice({ title, children, action, tone = "neutral" }: { title: string; children?: ReactNode; action?: { to: string; label: string }; tone?: "neutral" | "warn" }) {
  return (
    <div
      role={tone === "warn" ? "alert" : undefined}
      style={{ padding: 28, borderRadius: 24, background: tone === "warn" ? "#FFF6E3" : "var(--surface)", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}
    >
      <span style={{ fontSize: 18, fontWeight: 700, color: tone === "warn" ? "#6B4700" : "var(--ink)" }}>{title}</span>
      {children && <span style={{ fontSize: 15, color: tone === "warn" ? "#6B4700" : "var(--muted)", lineHeight: 1.55 }}>{children}</span>}
      {action && (
        <Link to={action.to} className="pri" style={{ ...btnPrimary, minHeight: 46, padding: "0 20px", marginTop: 4 }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <span role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)", padding: "12px 0" }}>
      <Spinner /> {label}
    </span>
  );
}
