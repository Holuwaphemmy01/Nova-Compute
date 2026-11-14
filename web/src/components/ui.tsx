import type { CSSProperties, ReactNode } from "react";

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect width="26" height="26" rx="8" fill="#16161A" />
      <circle cx="13" cy="13" r="4" fill="#0AC18E" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spin"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid var(--line)",
        borderTopColor: "var(--ink)",
        display: "inline-block",
        flex: "none",
      }}
    />
  );
}

export function CheckIcon({ size = 12, width = 3.4, animate = false }: { size?: number; width?: number; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#16161A" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className={animate ? "draw-check" : undefined} d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Pill-shaped segmented control (role picker, device picker, OS tabs). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  stretch = true,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md" | "lg";
  stretch?: boolean;
}) {
  const h = size === "lg" ? 46 : size === "md" ? 40 : 38;
  const fs = size === "lg" ? 15 : size === "md" ? 14 : 13;
  return (
    <div role="group" aria-label={label} style={{ display: "flex", padding: 4, borderRadius: 999, background: "var(--surface-2)", width: stretch ? "100%" : undefined }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className="seg"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              flex: stretch ? 1 : undefined,
              minHeight: h,
              padding: stretch ? "0 12px" : "0 16px",
              border: 0,
              borderRadius: 999,
              fontWeight: 600,
              fontSize: fs,
              background: on ? "#FFFFFF" : "transparent",
              color: on ? "var(--ink)" : "var(--muted)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Row of selectable chips (particle counts). */
export function Chips<T extends number>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "md" | "lg";
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              minHeight: size === "lg" ? 46 : 42,
              padding: size === "lg" ? "0 20px" : "0 16px",
              borderRadius: 999,
              fontWeight: 600,
              fontSize: size === "lg" ? 15 : 14,
              background: on ? "var(--ink)" : "#FFFFFF",
              color: on ? "#FFFFFF" : "var(--ink)",
              border: `1px solid ${on ? "var(--ink)" : "var(--chip-border)"}`,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, color = "var(--green)", height = 6, label }: { value: number; color?: string; height?: number; label?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} style={{ height, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
      <div className="pbar" style={{ height: "100%", borderRadius: 999, background: color, width: `${value}%` }} />
    </div>
  );
}

/** Label + value header used above range sliders. */
export function SliderLabel({ label, value, size = 15 }: { label: string; value: ReactNode; size?: number }) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", fontSize: size, fontWeight: 600 }}>
      <span>{label}</span>
      <span className="mono" style={{ fontWeight: 500 }}>{value}</span>
    </span>
  );
}

export function LegendDot({ color, round = false, outlined = false, children }: { color: string; round?: boolean; outlined?: boolean; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: round ? "50%" : 3,
          background: color,
          border: outlined ? "1px solid var(--ink)" : undefined,
        }}
      />
      {children}
    </span>
  );
}

/** Status line with a coloured dot, e.g. "Earning now" / "Paused". */
export function StatusDot({ paused, live, pausedText = "Paused", size = 15 }: { paused: boolean; live: string; pausedText?: string; size?: number }) {
  return (
    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: size, fontWeight: 600, color: paused ? "#8A5A00" : "var(--green-ink)" }}>
      <span className={paused ? undefined : "breathe"} aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: "currentColor" }} />
      {paused ? pausedText : live}
    </span>
  );
}

export const btnPrimary: CSSProperties = {
  minHeight: 52,
  padding: "0 24px",
  borderRadius: 999,
  border: 0,
  background: "var(--ink)",
  color: "#FFFFFF",
  fontWeight: 600,
  fontSize: 15,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

export const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: "#FFFFFF",
  color: "var(--ink)",
  border: "1px solid var(--chip-border)",
};

export const card: CSSProperties = {
  padding: 26,
  borderRadius: 24,
  border: "1px solid var(--line-soft)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
