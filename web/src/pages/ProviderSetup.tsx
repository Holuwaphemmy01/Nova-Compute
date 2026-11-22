import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, humanError } from "../api/client";
import { AppHeader } from "../components/Headers";
import { CheckIcon, SliderLabel, Spinner } from "../components/ui";
import { API_URL, shortAddress } from "../config/env";
import { createWasmKernel, kernelHash } from "../kernel/wasmKernel";
import { copyText } from "../lib/browser";
import { browserWorker, useBrowserWorker } from "../lib/browserWorker";
import { fmt } from "../lib/random";
import { useWorkerSession, workerSession } from "../lib/workerSession";
import { NetworkBanner } from "../wallet/NetworkBanner";
import { useWalletState } from "../wallet/store";

type CheckState = "waiting" | "active" | "done" | "info" | "failed";
interface Check {
  title: string;
  state: CheckState;
  detail?: string;
}

/** Runs the real setup checks: kernel loads, determinism vs GOLDEN, WebGPU (info), payout wallet. */
function useSetupChecks(walletAddress: string | null) {
  const [kernel, setKernel] = useState<Check>({ title: "Nova's kernel loads in this tab", state: "active" });
  const [determinism, setDeterminism] = useState<Check>({ title: "Your device gives the same answer as ours", state: "waiting" });
  const [gpu, setGpu] = useState<Check>({ title: "Checking for WebGPU", state: "active" });
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const k = createWasmKernel();
    kernelHash()
      .then(async (h) => {
        if (!alive) return;
        setHash(h);
        setKernel((c) => ({ ...c, state: "done" }));
        setDeterminism((c) => ({ ...c, state: "active" }));
        const r = await k.selfTest();
        if (!alive) return;
        setDeterminism((c) => (r.ok ? { ...c, state: "done", detail: `matched in ${Math.round(r.ms)} ms` } : { ...c, state: "failed", detail: "Your browser computed a different result, so it can't take part. Try another browser." }));
      })
      .catch((e) => alive && setKernel((c) => ({ ...c, state: "failed", detail: humanError(e) })))
      .finally(() => k.dispose());

    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    (nav.gpu ? nav.gpu.requestAdapter().catch(() => null) : Promise.resolve(null)).then((adapter) => {
      if (!alive) return;
      setGpu(adapter ? { title: "WebGPU available", state: "info", detail: "the GPU kernel is coming soon; for now Nova runs on your CPU" } : { title: "No WebGPU in this browser", state: "info", detail: "Nova runs on your CPU" });
    });
    return () => {
      alive = false;
    };
  }, []);

  const wallet: Check = walletAddress
    ? { title: `Payouts go to ${shortAddress(walletAddress)}`, state: "done" }
    : { title: "Connect a wallet for your payouts", state: "failed", detail: "connect" };

  const deviceOk = kernel.state === "done" && determinism.state === "done";
  const deviceFailed = kernel.state === "failed" || determinism.state === "failed";
  return { checks: [kernel, determinism, gpu, wallet], ready: deviceOk && !!walletAddress, deviceOk, deviceFailed, hash };
}

const NATIVE_DOWNLOAD = "https://github.com/Holuwaphemmy01/Nova-Compute/releases/download/nova-worker-v0.1/nova-worker.exe";
const DEFAULT_COORDINATOR = "https://nova-coordinator.onrender.com";

/** Optional: the native worker (same Rust kernel, same results) for people who'd rather not keep a tab open. */
function NativeWorkerCard({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false);
  const coordinator = API_URL === DEFAULT_COORDINATOR ? "" : ` --coordinator ${API_URL}`;
  const command = `nova-worker.exe${coordinator} --payout-addr ${address ?? "<your BCH address>"}`;
  return (
    <section aria-labelledby="native-title" style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, padding: 20, borderRadius: 20, background: "var(--surface)", textAlign: "left" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 id="native-title" style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Run on your own machine</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
          Prefer not to keep a tab open? The Windows app runs the same kernel with the same results, and pays to the same address.
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, background: "#FFFFFF", border: "1px solid var(--line)" }}>
        <code className="mono" style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: "anywhere" }}>{command}</code>
        <button type="button" className="sec" onClick={async () => setCopied(await copyText(command))} style={{ flex: "none", minHeight: 36, padding: "0 14px", borderRadius: 999, border: "1px solid var(--chip-border)", background: "#FFFFFF", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <a href={NATIVE_DOWNLOAD} style={{ fontSize: 14, fontWeight: 600 }}>Download nova-worker for Windows (.exe) →</a>
    </section>
  );
}

export default function ProviderSetup() {
  const wallet = useWalletState();
  const navigate = useNavigate();
  const loop = useBrowserWorker();
  const session = useWorkerSession();
  const { checks, ready, deviceOk, deviceFailed, hash } = useSetupChecks(wallet.address);
  const waitingLabel = deviceFailed ? "This device can't take part" : deviceOk ? "Connect a wallet to start" : "Checking your setup…";
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!ready || !hash || !wallet.address) return;
    setStarting(true);
    setError(null);
    try {
      if (!session || session.payoutAddr !== wallet.address) {
        const s = await api.createSession(wallet.address, hash);
        workerSession.set({ workerId: s.worker_id, token: s.token, payoutAddr: wallet.address });
      }
      browserWorker.start();
      navigate("/provider/earnings");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setStarting(false);
    }
  }

  const goBase = { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 60, borderRadius: 999, fontWeight: 600, fontSize: 17, textDecoration: "none", border: 0, fontFamily: "var(--sans)" } as const;
  const earning = loop.status !== "stopped" && loop.status !== "paused" && loop.status !== "error";

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader role="provider" />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 24px 80px", display: "flex", flexDirection: "column", alignItems: "center", gap: 28, textAlign: "center" }}>
        <div className="in" style={{ width: "100%", borderRadius: 28, background: "#F0F7F3" }}>
          <svg viewBox="0 0 560 220" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="A gaming PC with spinning fans, ready to work">
            <ellipse cx="280" cy="196" rx="170" ry="10" fill="#DCEFE4" />
            <g stroke="#16161A" strokeWidth="2" strokeLinejoin="round">
              <rect x="160" y="50" width="100" height="144" rx="10" fill="#FFFFFF" />
              <rect x="280" y="74" width="130" height="86" rx="8" fill="#FFFFFF" />
              <rect x="290" y="84" width="110" height="66" rx="4" fill="#E4F5EC" />
              <line x1="345" y1="160" x2="345" y2="180" />
              <line x1="320" y1="182" x2="370" y2="182" />
              <circle cx="210" cy="92" r="24" fill="#FFFFFF" />
              <circle cx="210" cy="150" r="24" fill="#FFFFFF" />
            </g>
            <g className="fan" stroke="#16161A" strokeWidth="2" strokeLinecap="round"><line x1="210" y1="72" x2="210" y2="112" /><line x1="190" y1="92" x2="230" y2="92" /></g>
            <g className="fan" stroke="#16161A" strokeWidth="2" strokeLinecap="round"><line x1="210" y1="130" x2="210" y2="170" /><line x1="190" y1="150" x2="230" y2="150" /></g>
            <circle className="led" cx="244" cy="62" r="4" fill="#0AC18E" />
            <path d="M304 132 L322 114 L338 126 L362 100 L386 112" fill="none" stroke="#0AC18E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="440" cy="70" r="14" fill="#FFC85C" stroke="#16161A" strokeWidth="2" />
            <circle cx="466" cy="104" r="10" fill="#FFC85C" stroke="#16161A" strokeWidth="2" />
          </svg>
        </div>

        <div className="in d1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em" }}>Put your computer to work</h1>
          <p style={{ margin: 0, fontSize: 17, color: "var(--muted)" }}>Runs safely in this tab. Earn {fmt(1200)} sats for every piece you finish.</p>
        </div>

        <ul className="in d2" aria-label="Setup checks" style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, textAlign: "left", listStyle: "none", margin: 0, padding: 0 }}>
          {checks.map((c) => (
            <li key={c.title} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 16, background: c.state === "failed" ? "#FFF6E3" : "var(--surface)" }}>
              <span style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                {c.state === "done" && (
                  <span className="tick" style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <CheckIcon />
                  </span>
                )}
                {c.state === "active" && <Spinner size={16} />}
                {c.state === "info" && <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--chip-border)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>i</span>}
                {c.state === "failed" && <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: "#FFC85C", border: "2px solid var(--ink)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>!</span>}
                {c.state === "waiting" && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--chip-border)" }} />}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: c.state === "waiting" ? "var(--faint)" : "var(--ink)" }}>{c.title}</span>
                {c.detail === "connect" ? (
                  <Link to="/connect?role=provider" style={{ fontSize: 13, fontWeight: 600 }}>Connect wallet →</Link>
                ) : c.detail ? (
                  <span style={{ fontSize: 13, color: c.state === "failed" ? "#6B4700" : "var(--muted)" }}>{c.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <NetworkBanner compact />

        <label style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
          <SliderLabel label="Use up to" value={`${loop.limit}% of my device`} />
          <input type="range" min={10} max={100} step={10} value={loop.limit} onChange={(e) => browserWorker.setLimit(Number(e.target.value))} />
        </label>

        {earning ? (
          <Link to="/provider/earnings" className="go" style={{ ...goBase, background: "var(--ink)", color: "#FFFFFF" }}>
            You're earning · see earnings
          </Link>
        ) : (
          <button
            type="button"
            className="go"
            onClick={start}
            disabled={!ready || starting}
            style={{ ...goBase, background: ready ? "var(--ink)" : "var(--surface-2)", color: ready ? "#FFFFFF" : "var(--faint)", cursor: ready ? "pointer" : "default" }}
          >
            {starting ? "Starting…" : ready ? "Start earning" : waitingLabel}
          </button>
        )}
        {error && <p role="alert" style={{ margin: 0, width: "100%", padding: "12px 16px", borderRadius: 14, background: "#FFF6E3", color: "#6B4700", fontSize: 14 }}>{error}</p>}
        <span style={{ fontSize: 13, color: "var(--faint)" }}>Close the tab any time to stop.</span>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Tip: each piece needs 2 different workers. To test alone, open a second browser with another payout address.
        </p>
        <NativeWorkerCard address={wallet.address} />
        <Link to="/provider/machines" style={{ fontSize: 15, fontWeight: 600 }}>Have a gaming PC or rig? GPU machines are coming (preview) →</Link>
      </main>
    </div>
  );
}
