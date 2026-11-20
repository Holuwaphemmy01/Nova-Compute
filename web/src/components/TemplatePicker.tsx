import { TEMPLATE_CARDS, type TemplateId } from "../lib/templates";

/** Original line icons (inline SVG, decorative). */
function Icon({ id }: { id: string }) {
  const common = { width: 40, height: 40, viewBox: "0 0 40 40", fill: "none", stroke: "#16161A", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (id) {
    case "neutron_slab":
      return (
        <svg {...common}>
          <rect x="16" y="6" width="9" height="28" rx="2" fill="#ECECE7" />
          <path d="M4 12 L14 15" />
          <path d="M4 24 L12 21 L19 26 L27 22 L36 25" stroke="#0AC18E" />
          <circle cx="4" cy="12" r="2" fill="#16161A" />
        </svg>
      );
    case "ising_2d":
      return (
        <svg {...common}>
          {[0, 1, 2, 3].flatMap((r) =>
            [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={6 + c * 7.5} y={6 + r * 7.5} width="6" height="6" rx="1.5" fill={(r * 3 + c * 5) % 7 < 4 ? "#16161A" : "#C2E5D1"} stroke="none" />),
          )}
        </svg>
      );
    case "sir_epidemic":
      return (
        <svg {...common}>
          <path d="M4 34 C 10 34, 13 8, 20 8 S 30 33, 36 34" stroke="#0AC18E" />
          <path d="M4 34 L36 34" strokeOpacity="0.4" />
          <circle cx="20" cy="8" r="2.5" fill="#16161A" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M5 30 L13 22 L19 26 L27 14 L35 18" strokeOpacity="0.5" />
          <path d="M27 14 L35 10" strokeDasharray="2 4" strokeOpacity="0.5" />
        </svg>
      );
  }
}

/** Template cards: a radio group (keyboard: Tab to the group, arrows/space via native radios). */
export function TemplatePicker({ value, onChange, disabled = false }: { value: TemplateId; onChange: (t: TemplateId) => void; disabled?: boolean }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>What do you want to simulate?</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {TEMPLATE_CARDS.map((t) => {
          const on = t.id === value;
          const off = !t.enabled || disabled;
          return (
            <label
              key={t.id}
              className="card"
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 14,
                borderRadius: 18,
                cursor: off ? "not-allowed" : "pointer",
                background: on ? "var(--mint)" : "var(--surface)",
                border: `2px solid ${on ? "var(--green)" : "transparent"}`,
                opacity: t.enabled ? 1 : 0.55,
              }}
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={on}
                disabled={off}
                onChange={() => t.enabled && onChange(t.id as TemplateId)}
                style={{ position: "absolute", opacity: 0, inset: 0, margin: 0, cursor: "inherit" }}
              />
              <Icon id={t.id} />
              <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{t.title}</span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{t.enabled ? t.blurb : "Coming soon"}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
