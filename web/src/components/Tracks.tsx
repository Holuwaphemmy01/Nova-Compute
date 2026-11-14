import type { Track } from "../lib/walk";

/** Draws recent particle tracks as polylines, newest on top and brightest. */
export function Tracks({
  tracks,
  x,
  y,
  fade = 0.02,
}: {
  tracks: Track[]; // newest first
  x: (v: number) => number;
  y: (v: number) => number;
  fade?: number;
}) {
  const drawn = tracks
    .map((tr, i) => ({ tr, i }))
    .filter(({ tr }) => tr.pts)
    .reverse();
  return (
    <>
      {drawn.map(({ tr, i }) => {
        const through = tr.fate === "t";
        const op = i === 0 ? 0.9 : Math.max(0.06, (through ? 0.8 : 0.3) - i * fade);
        return (
          <polyline
            key={tr.id}
            points={tr.pts!.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={through ? "#0AC18E" : "#16161A"}
            strokeWidth={through ? 2 : 1.2}
            strokeOpacity={op}
            strokeLinejoin="round"
            strokeLinecap="round"
            className={i === 0 ? "track-new" : undefined}
          />
        );
      })}
    </>
  );
}
