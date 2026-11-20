/**
 * Small accessible SVG/canvas charts for the template results (light design, no chart library).
 * Every chart has role="img", an aria-label summarising the data, labelled axes with units, and
 * only CSS transitions (disabled by the global prefers-reduced-motion rule).
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { IsingPoint } from "../api/client";
import { ONSAGER_TC, onsagerM, unpackLattice } from "../lib/templates";

const INK = "#16161A";
const GREEN = "#0AC18E";
const MUTED = "#5F5F66";
const GRID = "#ECECE8";

interface AxisSpec {
  min: number;
  max: number;
  ticks: number[];
  label: string;
  fmt?: (v: number) => string;
}

const W = 640;
const H = 300;
const M = { l: 56, r: 16, t: 14, b: 46 };

/** Plot frame: gridlines, ticks and axis labels; children get the scale functions. */
function Frame({ x, y, label, children }: { x: AxisSpec; y: AxisSpec; label: string; children: (sx: (v: number) => number, sy: (v: number) => number) => ReactNode }) {
  const sx = (v: number) => M.l + ((v - x.min) / (x.max - x.min)) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((v - y.min) / (y.max - y.min)) * (H - M.t - M.b);
  const fx = x.fmt ?? ((v: number) => String(v));
  const fy = y.fmt ?? ((v: number) => String(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label={label}>
      {y.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke={GRID} />
          <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" fontSize="12" fill={MUTED} fontFamily="var(--mono)">{fy(t)}</text>
        </g>
      ))}
      {x.ticks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - M.b + 18} textAnchor="middle" fontSize="12" fill={MUTED} fontFamily="var(--mono)">{fx(t)}</text>
      ))}
      <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke={INK} strokeOpacity="0.4" />
      <text x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle" fontSize="13" fill={MUTED}>{x.label}</text>
      <text x={14} y={(M.t + H - M.b) / 2} textAnchor="middle" fontSize="13" fill={MUTED} transform={`rotate(-90 14 ${(M.t + H - M.b) / 2})`}>{y.label}</text>
      {children(sx, sy)}
    </svg>
  );
}

/** "Nice" axis maximum and ticks (steps of 1, 2, 2.5 or 5 × 10^k) covering [0, max]. */
export function niceTicks(max: number, count = 5): { top: number; ticks: number[] } {
  const raw = Math.max(max, 1e-9) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.round(Math.max(step, Math.ceil(max / step - 1e-9) * step) * 1e6) / 1e6;
  return { top, ticks: range(0, top, step) };
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

/** |m|(T) with the exact Onsager curve, Tc (χ peak) and the theory value 2.269. */
export function MagnetizationChart({ points, tc, live, tMin = 1, tMax = 4 }: { points: IsingPoint[]; tc?: number | null; live?: { T: number; m: number } | null; tMin?: number; tMax?: number }) {
  const exact = range(tMin, tMax, 0.02).map((t) => [t, onsagerM(t)] as const);
  const label = `Magnetization versus temperature. ${points.length} measured temperatures${tc ? `; susceptibility peaks at T ≈ ${tc.toFixed(2)}` : ""}; Onsager's exact critical temperature is 2.27.`;
  return (
    <Frame x={{ min: tMin, max: tMax, ticks: range(Math.ceil(tMin * 2) / 2, tMax, 0.5), label: "Temperature T (units of J/k_B)", fmt: (v) => v.toFixed(1) }} y={{ min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], label: "Order |m| (0–1)", fmt: (v) => v.toFixed(2) }} label={label}>
      {(sx, sy) => (
        <>
          <polyline points={exact.map(([t, m]) => `${sx(t)},${sy(m)}`).join(" ")} fill="none" stroke={MUTED} strokeWidth="1.5" strokeDasharray="2 4" strokeOpacity="0.7" />
          <line x1={sx(ONSAGER_TC)} x2={sx(ONSAGER_TC)} y1={sy(0)} y2={sy(1)} stroke={MUTED} strokeDasharray="6 5" />
          <text x={sx(ONSAGER_TC) + 6} y={sy(0.96)} fontSize="12" fill={MUTED}>Onsager 2.269</text>
          {tc != null && (
            <>
              <line x1={sx(tc)} x2={sx(tc)} y1={sy(0)} y2={sy(1)} stroke={GREEN} strokeWidth="2" style={{ transition: "x1 .6s, x2 .6s" }} />
              <text x={sx(tc) - 6} y={sy(0.86)} textAnchor="end" fontSize="12" fill="#067A5A" fontWeight="600">Tc ≈ {tc.toFixed(2)}</text>
            </>
          )}
          {points.length > 1 && <polyline points={points.map((p) => `${sx(p.T)},${sy(p.m)}`).join(" ")} fill="none" stroke={INK} strokeWidth="2" />}
          {points.map((p) => (
            <circle key={p.T} className="pop" cx={sx(p.T)} cy={sy(p.m)} r="5" fill={INK} stroke="#FFFFFF" strokeWidth="2" />
          ))}
          {live && <circle cx={sx(live.T)} cy={sy(live.m)} r="7" fill={GREEN} stroke={INK} strokeWidth="2" style={{ transition: "cy .2s linear" }} />}
        </>
      )}
    </Frame>
  );
}

/** Histogram of a fraction in [0,1] (64 bins). Bars above `majorFrom` are drawn green. */
export function FractionHistogram({ bins, xLabel, yLabel = "Outbreaks", majorFrom, label }: { bins: number[]; xLabel: string; yLabel?: string; majorFrom?: number; label: string }) {
  const { top, ticks } = niceTicks(Math.max(4, ...bins), 4);
  const n = bins.length || 64;
  return (
    <Frame x={{ min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], label: xLabel, fmt: (v) => `${Math.round(v * 100)}%` }} y={{ min: 0, max: top, ticks, label: yLabel, fmt: (v) => String(Math.round(v)) }} label={label}>
      {(sx, sy) =>
        bins.map((c, i) => {
          const x0 = sx(i / n);
          const w = Math.max(1, sx((i + 1) / n) - x0 - 1);
          return (
            <rect
              key={i}
              x={x0}
              y={sy(c)}
              width={w}
              height={Math.max(0, sy(0) - sy(c))}
              fill={majorFrom !== undefined && (i + 0.5) / n > majorFrom ? GREEN : INK}
              fillOpacity={majorFrom !== undefined && (i + 0.5) / n > majorFrom ? 1 : 0.8}
              style={{ transition: "y .5s cubic-bezier(.16,1,.3,1), height .5s cubic-bezier(.16,1,.3,1)" }}
            />
          );
        })
      }
    </Frame>
  );
}

/** Daily infected curves (share of the population), newest drawn darkest. */
export function EpidemicCurves({ curves, population, label }: { curves: number[][]; population: number; label: string }) {
  const days = Math.max(30, ...curves.map((c) => lastNonZero(c) + 5));
  const dayMax = Math.min(180, Math.ceil(days / 30) * 30);
  const peak = Math.max(0.01, ...curves.flat().map((v) => v / population));
  const { top: yMax, ticks: yTicks } = niceTicks(Math.min(1, peak), 4);
  return (
    <Frame x={{ min: 0, max: dayMax, ticks: range(0, dayMax, dayMax / 6), label: "Day of the outbreak", fmt: (v) => String(Math.round(v)) }} y={{ min: 0, max: yMax, ticks: yTicks, label: "Infected at once (% of people)", fmt: (v) => `${Math.round(v * 100)}%` }} label={label}>
      {(sx, sy) =>
        curves.map((c, k) => (
          <polyline
            key={k}
            className={k === curves.length - 1 ? "track-new" : undefined}
            points={c.slice(0, dayMax + 1).map((v, d) => `${sx(d)},${sy(v / population)}`).join(" ")}
            fill="none"
            stroke={k === curves.length - 1 ? GREEN : INK}
            strokeWidth={k === curves.length - 1 ? 2.2 : 1.2}
            strokeOpacity={k === curves.length - 1 ? 1 : Math.max(0.12, 0.5 - (curves.length - 1 - k) * 0.03)}
            strokeLinejoin="round"
          />
        ))
      }
    </Frame>
  );
}

function lastNonZero(c: number[]) {
  for (let i = c.length - 1; i >= 0; i--) if (c[i] > 0) return i;
  return 0;
}

/** L×L spin lattice on a canvas: +1 dark, −1 light. */
export function SpinGrid({ L, bits, label, size = 320 }: { L: number; bits: string | Uint8Array | null; label: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const spins = bits == null ? new Uint8Array(L * L).fill(1) : typeof bits === "string" ? unpackLattice(bits, L) : bits;
    const img = ctx.createImageData(L, L);
    for (let i = 0; i < L * L; i++) {
      const up = spins[i] === 1;
      img.data.set(up ? [0x16, 0x16, 0x1a, 255] : [0xc2, 0xe5, 0xd1, 255], i * 4);
    }
    cv.width = L;
    cv.height = L;
    ctx.putImageData(img, 0, 0);
  }, [L, bits]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      style={{ width: "100%", maxWidth: size, aspectRatio: "1", imageRendering: "pixelated", borderRadius: 12, border: "1px solid var(--line)", display: "block" }}
    />
  );
}

/** "up" / "down" key for the spin grid. */
export function SpinKey() {
  return (
    <span style={{ display: "inline-flex", gap: 14, fontSize: 13, color: "var(--muted)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: INK }} />spin up</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: "#C2E5D1", border: "1px solid #9FCDB3" }} />spin down</span>
    </span>
  );
}
