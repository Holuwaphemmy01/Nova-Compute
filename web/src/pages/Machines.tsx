import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { machinesApi, type GpuLimit, type Machine, type PairCode } from "../api/machines";
import { AppHeader } from "../components/Headers";
import { Segmented, Spinner, btnSecondary, card } from "../components/ui";
import { PLATFORMS, buildCommands, type WorkerPlatform } from "../config/worker";
import { copyText, storage } from "../lib/browser";
import { fmt } from "../lib/random";
import { countdown, timeAgo } from "../lib/time";
import { useInterval } from "../lib/useInterval";

const POLL_MS = 3000;
const OS_KEY = "nova.worker.platform";
const BACKEND_LABEL: Record<Machine["backend"], string> = { vulkan: "Vulkan", dx12: "DX12", metal: "Metal" };

/** Re-renders every `ms` and returns the current time. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

/** Shows "Copied" for 1.5 s after a successful copy. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    }
  }, []);
  return { copied, copy };
}

export default function Machines() {
  const [params] = useSearchParams();
  const showSimulate = !!machinesApi.simulatePairing && (import.meta.env.DEV || params.get("demo") === "1");
  const now = useNow();
  const { copied, copy } = useCopied();

  const [platform, setPlatform] = useState<WorkerPlatform>(() => {
    const saved = storage.get(OS_KEY);
    return PLATFORMS.some((p) => p.value === saved) ? (saved as WorkerPlatform) : "linux";
  });
  const choosePlatform = (p: WorkerPlatform) => {
    setPlatform(p);
    storage.set(OS_KEY, p);
  };

  // ---- pairing code ----
  const [pair, setPair] = useState<PairCode | null>(null);
  const [pairError, setPairError] = useState(false);
  const newCode = useCallback(async () => {
    setPairError(false);
    try {
      setPair(await machinesApi.createPairCode());
    } catch {
      setPairError(true);
    }
  }, []);
  useEffect(() => {
    void newCode();
  }, [newCode]);
  // Read the clock at render time (useNow just re-renders every second); a stale tick
  // would otherwise show "10:01" for a code that was issued a moment after it.
  const cd = pair ? countdown(pair.expires_at, Math.max(now, Date.now())) : null;
  const code = pair && !cd?.expired ? pair.code : "NOVA-····";

  // ---- machines (polled) ----
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    try {
      setMachines(await machinesApi.listMachines());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useInterval(() => {
    if (!document.hidden) void load();
  }, POLL_MS);

  const replace = (m: Machine) => setMachines((list) => list?.map((x) => (x.id === m.id ? m : x)) ?? [m]);
  const drop = (id: string) => setMachines((list) => list?.filter((x) => x.id !== id) ?? []);

  const [simulating, setSimulating] = useState(false);
  async function simulate() {
    if (!machinesApi.simulatePairing) return;
    setSimulating(true);
    try {
      await machinesApi.simulatePairing();
      await load();
    } finally {
      setSimulating(false);
    }
  }

  const stepTitle = (n: number, t: string) => (
    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
      <span style={{ color: "var(--faint)" }}>{n} ·</span> {t}
    </h2>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 32px 80px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="in" style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
          <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 40px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05 }}>Connect a GPU machine</h1>
            <p style={{ margin: 0, fontSize: 17, color: "var(--muted)", lineHeight: 1.55 }}>
              Run Nova on a gaming PC or a mining rig. Same kernel as the browser, at full native speed, so results match hash for hash.
            </p>
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 0, borderRadius: 24, background: "#F0F7F3" }}>
            <MachineLinkArt />
          </div>
        </div>

        {/* 1 · Install */}
        <section className="in d1" aria-label="Step 1: install the worker" style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {stepTitle(1, "Install the worker")}
            <Segmented<WorkerPlatform> label="Platform" size="sm" stretch={false} value={platform} onChange={choosePlatform} options={PLATFORMS} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buildCommands(platform, code).map((cmd, i) => {
              const key = `cmd-${platform}-${i}`;
              return (
                <div key={key} className="mono" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "var(--ink)", color: "#EDEDEC", fontSize: 14, flexWrap: "wrap" }}>
                  <span aria-hidden="true" style={{ color: "#3DDCA8" }}>$</span>
                  <code style={{ flex: 1, minWidth: 180, wordBreak: "break-all", fontFamily: "inherit" }}>{cmd}</code>
                  <button
                    type="button"
                    onClick={() => copy(key, cmd)}
                    aria-label={`Copy command: ${cmd}`}
                    style={{ minHeight: 36, padding: "0 12px", borderRadius: 8, border: "1px solid #4A4A52", background: "transparent", color: "#EDEDEC", fontFamily: "var(--sans)", fontSize: 13, cursor: "pointer" }}
                  >
                    <span aria-live="polite">{copied === key ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              );
            })}
          </div>
          <span style={{ fontSize: 13, color: "var(--faint)" }}>
            Needs a GPU with Vulkan, DirectX 12 or Metal. The worker only runs Nova's audited kernel; it never runs code sent by researchers.
          </span>
        </section>

        {/* 2 · Pair */}
        <section className="in d2" aria-label="Step 2: pair it with your wallet" style={{ ...card, flexDirection: "row", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {stepTitle(2, "Pair it with your wallet")}
            <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", lineHeight: 1.55 }}>
              The pairing code links the machine to your payout address. Earnings go straight to your wallet, never to the machine.
            </p>
          </div>
          <div style={{ flex: "0 1 auto", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 26px", borderRadius: 20, background: "var(--surface)" }}>
            {pairError ? (
              <>
                <span role="alert" style={{ fontSize: 15, color: "var(--muted)" }}>Couldn't get a pairing code.</span>
                <button type="button" className="sec" onClick={newCode} style={{ ...btnSecondary, minHeight: 40, padding: "0 16px", fontSize: 14 }}>Try again</button>
              </>
            ) : !pair || !cd ? (
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--muted)", minHeight: 60 }}>
                <Spinner /> Getting a code…
              </span>
            ) : cd.expired ? (
              <>
                <span className="mono" style={{ fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 500, letterSpacing: "0.08em", color: "var(--faint)", textDecoration: "line-through" }}>{pair.code}</span>
                <span role="status" style={{ fontSize: 14, fontWeight: 600, color: "#8A5A00" }}>Code expired</span>
                <button type="button" className="pri" onClick={newCode} style={{ minHeight: 42, padding: "0 18px", borderRadius: 999, border: 0, background: "var(--ink)", color: "#FFFFFF", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                  Get a new code
                </button>
              </>
            ) : (
              <>
                <span className="mono" style={{ fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 500, letterSpacing: "0.08em" }}>{pair.code}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  expires in <span className="tnum">{cd.label}</span>
                </span>
                <button
                  type="button"
                  className="sec"
                  onClick={() => copy("code", pair.code)}
                  aria-label={`Copy pairing code ${pair.code}`}
                  style={{ ...btnSecondary, minHeight: 36, padding: "0 14px", fontSize: 13 }}
                >
                  <span aria-live="polite">{copied === "code" ? "Copied" : "Copy code"}</span>
                </button>
              </>
            )}
          </div>
        </section>

        {/* 3 · Machines */}
        <section className="in d3" aria-label="Step 3: your machines" style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {stepTitle(3, "Your machines")}
            {showSimulate && !!machines?.length && (
              <button type="button" className="sec" onClick={simulate} disabled={simulating} style={{ ...btnSecondary, minHeight: 40, padding: "0 16px", fontSize: 13 }}>
                Simulate another machine
              </button>
            )}
          </div>

          {loadError && (
            <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>
              Couldn't reach Nova. Retrying every few seconds…
            </p>
          )}

          {machines === null && !loadError ? (
            <span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: "var(--muted)" }}>
              <Spinner size={16} /> Loading your machines…
            </span>
          ) : machines && machines.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {machines.map((m) => (
                <li key={m.id}>
                  <MachineCard machine={m} now={now} onChange={replace} onRemoved={drop} />
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 18, borderRadius: 16, background: "var(--surface)" }}>
              <span role="status" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: "var(--muted)" }}>
                <Spinner size={16} />
                Waiting for a machine to pair…
              </span>
              {showSimulate && (
                <button type="button" className="sec" onClick={simulate} disabled={simulating} style={{ ...btnSecondary, minHeight: 44, padding: "0 18px", fontSize: 14 }}>
                  {simulating ? "Pairing…" : "Simulate pairing"}
                </button>
              )}
            </div>
          )}
        </section>

        <p style={{ margin: 0, textAlign: "center", fontSize: 14, color: "var(--muted)" }}>
          No machine? <Link to="/provider" style={{ fontWeight: 600 }}>Use this browser instead</Link>
        </p>
      </main>
    </div>
  );
}

function MachineCard({ machine: m, now, onChange, onRemoved }: { machine: Machine; now: number; onChange: (m: Machine) => void; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = `limit-${m.id}`;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const togglePause = () => act(async () => onChange(await machinesApi.updateMachine(m.id, { paused: m.status !== "paused" })));
  const setLimit = (gpu_limit: GpuLimit) => act(async () => onChange(await machinesApi.updateMachine(m.id, { gpu_limit })));
  const remove = () =>
    act(async () => {
      await machinesApi.removeMachine(m.id);
      onRemoved(m.id);
    });

  const offline = m.status === "offline";
  const selfTest =
    m.self_test === "passed" ? { text: "Hash matched ✓", color: "var(--green-ink)" } : m.self_test === "failed" ? { text: "Failed ✗", color: "#B42318" } : { text: "Running…", color: "var(--muted)" };

  return (
    <article className="pop" aria-label={`Machine ${m.name}`} style={{ display: "flex", flexDirection: "column", gap: 16, padding: 22, borderRadius: 20, background: offline ? "var(--surface)" : "var(--mint)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, wordBreak: "break-word" }}>{m.name}</h3>
          <span style={{ fontSize: 14, color: "var(--mint-ink)" }}>
            {m.gpu} · {m.vram_gb} GB · {BACKEND_LABEL[m.backend]}
          </span>
        </div>
        <StatusPill status={m.status} lastSeen={timeAgo(m.last_seen, now)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Tile label="Self-test"><span style={{ color: selfTest.color }}>{selfTest.text}</span></Tile>
        <Tile label="Speed">{fmt(m.particles_per_sec)} particles/s</Tile>
        <Tile label="Pieces finished">{fmt(m.pieces_finished)}</Tile>
        <Tile label="Earned">{fmt(m.earned_sats)} sats</Tile>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          className="sec"
          onClick={togglePause}
          disabled={busy || offline}
          style={{ ...btnSecondary, minHeight: 44, padding: "0 18px", fontSize: 14, border: "1px solid #C2E5D1", opacity: offline ? 0.55 : 1 }}
        >
          {m.status === "paused" ? "Resume" : "Pause"}
        </button>
        <label htmlFor={selectId} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--mint-ink)", flexWrap: "wrap" }}>
          Use up to
          <select
            id={selectId}
            value={m.gpu_limit}
            disabled={busy}
            onChange={(e) => setLimit(Number(e.target.value) as GpuLimit)}
            style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: "1px solid #C2E5D1", background: "#FFFFFF", fontSize: 14, color: "var(--ink)" }}
          >
            <option value={50}>50%</option>
            <option value={80}>80%</option>
            <option value={100}>100%</option>
          </select>
          of the GPU
        </label>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {confirming ? (
            <span role="group" aria-label="Confirm removal" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <span style={{ color: "var(--ink)" }}>Remove this machine?</span>
              <button type="button" onClick={remove} disabled={busy} style={{ minHeight: 36, padding: "0 14px", borderRadius: 999, border: 0, background: "#B42318", color: "#FFFFFF", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Remove
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} style={{ minHeight: 36, padding: "0 12px", borderRadius: 999, border: "1px solid var(--chip-border)", background: "#FFFFFF", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} style={{ minHeight: 36, padding: 0, border: 0, background: "transparent", color: "var(--mint-ink)", textDecoration: "underline", fontSize: 14, cursor: "pointer" }}>
              Remove
            </button>
          )}
          <Link to="/provider/earnings" style={{ fontSize: 14, fontWeight: 600 }}>See earnings →</Link>
        </span>
      </div>
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: "#B42318" }}>{error}</p>}
    </article>
  );
}

function StatusPill({ status, lastSeen }: { status: Machine["status"]; lastSeen: string }) {
  const s =
    status === "online"
      ? { text: "Online · earning", color: "var(--green-ink)", dot: "breathe" }
      : status === "paused"
        ? { text: "Paused", color: "#8A5A00", dot: undefined }
        : { text: `Offline · last seen ${lastSeen}`, color: "var(--faint)", dot: undefined };
  return (
    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "#FFFFFF", fontSize: 14, fontWeight: 600, color: s.color }}>
      <span className={s.dot} aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: "currentColor" }} />
      {s.text}
    </span>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: "#FFFFFF", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>{children}</span>
    </div>
  );
}

function MachineLinkArt() {
  return (
    <svg viewBox="0 0 420 170" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="A GPU machine with blinking status lights, linked to Nova">
      <ellipse cx="210" cy="152" rx="170" ry="8" fill="#DCEFE4" />
      <g stroke="#16161A" strokeWidth="2" strokeLinejoin="round">
        <rect x="40" y="36" width="96" height="112" rx="10" fill="#FFFFFF" />
        <rect x="54" y="52" width="68" height="14" rx="3" fill="#E4F5EC" />
        <rect x="54" y="74" width="68" height="14" rx="3" fill="#E4F5EC" />
        <rect x="54" y="96" width="68" height="14" rx="3" fill="#E4F5EC" />
        <rect x="300" y="58" width="72" height="72" rx="20" fill="#16161A" />
      </g>
      <circle cx="336" cy="94" r="12" fill="#0AC18E" />
      <circle className="breathe" cx="112" cy="59" r="3.5" fill="#0AC18E" />
      <circle className="breathe" cx="112" cy="81" r="3.5" fill="#0AC18E" style={{ animationDelay: ".4s" }} />
      <circle className="breathe" cx="112" cy="103" r="3.5" fill="#0AC18E" style={{ animationDelay: ".8s" }} />
      <path className="flow" d="M140 94 C 200 60, 240 128, 296 94" fill="none" stroke="#16161A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
