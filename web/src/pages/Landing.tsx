import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SiteHeader } from "../components/Headers";
import { BLAZE_LINKS, blazeValue } from "../config/blaze";
import { NETWORK } from "../config/env";
import { Tracks } from "../components/Tracks";
import { mulberry32, fmt } from "../lib/random";
import { useInterval } from "../lib/useInterval";
import { walk, type Track } from "../lib/walk";

export default function Landing() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <BlazeBar />
      <SiteHeader />
      <Hero />
      <HeroIllustration />
      <HowItWorks />
      <LiveDemo />
      <Proof />
      <ProviderCta />
      <footer style={{ borderTop: "1px solid var(--line-soft)" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "28px 32px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", fontSize: 14, color: "var(--muted)" }}>
          <span>Nova · built on Bitcoin Cash</span>
          <span>Live on {NETWORK} · WizardConnect · CashScript</span>
        </div>
      </footer>
    </div>
  );
}

function BlazeBar() {
  const slides = blazeValue(BLAZE_LINKS.slides);
  const repo = blazeValue(BLAZE_LINKS.repo);
  const ember = blazeValue(BLAZE_LINKS.emberAddress);
  return (
    <div role="region" aria-label="BCH BLAZE 2026 submission links" style={{ background: "var(--ink)", fontSize: 13, color: "#C9C9CF" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "10px 32px", display: "flex", gap: "8px 24px", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ color: "#FFFFFF", fontWeight: 600 }}>BCH BLAZE 2026</span>
        {slides && <a href={slides} className="nl" style={{ color: "#C9C9CF" }}>Slides</a>}
        {repo && <a href={repo} className="nl" style={{ color: "#C9C9CF" }}>GitHub</a>}
        {ember && (
          <span style={{ overflowWrap: "anywhere" }}>
            EMBER2026: <span className="mono">{ember}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "48px 32px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22 }}>
      <h1 className="in" style={{ margin: 0, fontSize: "clamp(44px, 6.4vw, 82px)", fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.045em", maxWidth: 900 }}>
        Science compute you can <span style={{ fontStyle: "italic", color: "var(--green-ink)" }}>verify.</span>
      </h1>
      <p className="in d1" style={{ margin: 0, fontSize: 20, lineHeight: 1.55, color: "var(--muted)", maxWidth: 660 }}>
        Run Monte Carlo simulations on idle computers around the world. Every piece is computed twice, providers are paid in BCH only when the results match, and the proof goes on-chain.
      </p>
      <div className="in d2" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
        <Link to="/connect?role=researcher" className="pri lift" style={{ padding: "16px 28px", borderRadius: 999, background: "var(--ink)", color: "#FFFFFF", textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
          Run a simulation
        </Link>
        <Link to="/connect?role=provider" className="sec" style={{ padding: "15px 27px", borderRadius: 999, border: "1px solid var(--chip-border)", color: "var(--ink)", textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
          Earn with your computer
        </Link>
      </div>
      <Link to="/lab" style={{ fontSize: 15, fontWeight: 600, color: "var(--green-ink)" }}>
        Or try a free simulation first, no wallet needed →
      </Link>
    </section>
  );
}

function HeroIllustration() {
  const S = { stroke: "#16161A", strokeWidth: 2, strokeLinejoin: "round" as const };
  return (
    <section className="in d3" style={{ maxWidth: 1160, margin: "0 auto", padding: "40px 32px 0" }}>
      <div style={{ borderRadius: 32, background: "#F0F7F3", overflow: "hidden" }}>
        <svg viewBox="0 0 1100 440" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Illustration: a small observatory on a hill sends work packets along dotted paths to laptops, a gaming PC and a server rack, and coins travel out to pay them">
          <g className="cl1"><ellipse cx="190" cy="80" rx="52" ry="18" fill="#FFFFFF" /><ellipse cx="226" cy="68" rx="34" ry="20" fill="#FFFFFF" /></g>
          <g className="cl2"><ellipse cx="870" cy="70" rx="60" ry="18" fill="#FFFFFF" /><ellipse cx="840" cy="58" rx="32" ry="18" fill="#FFFFFF" /></g>
          <g className="cl1"><ellipse cx="560" cy="44" rx="40" ry="12" fill="#FFFFFF" /></g>
          <circle cx="980" cy="110" r="26" fill="#FFE29A" />
          <path d="M0 320 C 200 262, 360 292, 550 244 C 740 196, 900 284, 1100 252 L1100 440 L0 440 Z" fill="#DCEFE4" />
          <path d="M0 372 C 220 332, 420 382, 600 352 C 800 322, 950 382, 1100 352 L1100 440 L0 440 Z" fill="#C2E5D1" />

          <g fill="none" stroke="#16161A" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round">
            <path d="M550 196 C 420 130, 240 170, 150 280" />
            <path d="M550 196 C 470 160, 380 180, 332 240" />
            <path d="M550 196 C 640 120, 740 120, 805 160" />
            <path d="M550 196 C 700 160, 880 210, 962 282" />
          </g>

          {/* observatory */}
          <g {...S}>
            <rect x="498" y="182" width="104" height="72" rx="6" fill="#FFFFFF" />
            <path d="M498 182 A52 52 0 0 1 602 182 Z" fill="#FFFFFF" />
            <rect x="543" y="134" width="14" height="46" rx="3" fill="#16161A" />
            <rect x="537" y="218" width="26" height="36" rx="4" fill="#C2E5D1" />
            <rect x="512" y="196" width="18" height="14" rx="3" fill="#FFE29A" />
            <rect x="570" y="196" width="18" height="14" rx="3" fill="#FFE29A" />
          </g>

          {/* laptop left */}
          <g {...S}>
            <rect x="108" y="284" width="84" height="56" rx="6" fill="#FFFFFF" />
            <rect x="116" y="292" width="68" height="40" rx="3" fill="#E4F5EC" />
            <path d="M94 340 L206 340 L198 352 L102 352 Z" fill="#FFFFFF" />
          </g>
          <g fill="#0AC18E"><rect x="124" y="316" width="8" height="10" rx="1" /><rect x="136" y="308" width="8" height="18" rx="1" /><rect x="148" y="300" width="8" height="26" rx="1" /><rect x="160" y="312" width="8" height="14" rx="1" /></g>

          {/* gaming PC */}
          <g {...S}>
            <rect x="300" y="244" width="52" height="82" rx="6" fill="#FFFFFF" />
            <circle cx="326" cy="270" r="11" fill="#FFFFFF" />
            <circle cx="326" cy="300" r="11" fill="#FFFFFF" />
            <rect x="362" y="262" width="62" height="44" rx="5" fill="#FFFFFF" />
            <line x1="393" y1="306" x2="393" y2="320" />
            <line x1="378" y1="322" x2="408" y2="322" />
          </g>
          <circle className="led" cx="345" cy="252" r="3" fill="#0AC18E" />
          <path d="M372 292 L384 280 L394 288 L412 272" fill="none" stroke="#0AC18E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

          {/* server rack */}
          <g {...S}>
            <rect x="774" y="164" width="62" height="98" rx="6" fill="#FFFFFF" />
            <rect x="784" y="176" width="42" height="18" rx="3" fill="#F0F7F3" />
            <rect x="784" y="202" width="42" height="18" rx="3" fill="#F0F7F3" />
            <rect x="784" y="228" width="42" height="18" rx="3" fill="#F0F7F3" />
          </g>
          <circle className="led" cx="817" cy="185" r="3" fill="#0AC18E" />
          <circle className="led" cx="817" cy="211" r="3" fill="#0AC18E" style={{ animationDelay: ".6s" }} />
          <circle className="led" cx="817" cy="237" r="3" fill="#0AC18E" style={{ animationDelay: "1.2s" }} />

          {/* laptop right */}
          <g {...S}>
            <rect x="920" y="286" width="84" height="56" rx="6" fill="#FFFFFF" />
            <rect x="928" y="294" width="68" height="40" rx="3" fill="#E4F5EC" />
            <path d="M906 342 L1018 342 L1010 354 L914 354 Z" fill="#FFFFFF" />
          </g>
          <path d="M940 322 C 950 300, 962 330, 972 308 S 986 318, 990 306" fill="none" stroke="#0AC18E" strokeWidth="2.4" strokeLinecap="round" />

          <g className="bob">
            <path d="M690 300 L690 268" stroke="#16161A" strokeWidth="2" />
            <path d="M690 268 L716 276 L690 284 Z" fill="#0AC18E" stroke="#16161A" strokeWidth="2" strokeLinejoin="round" />
          </g>

          {/* work packets out, coins back */}
          {(["p1", "p2", "p3", "p4"] as const).map((p, i) => (
            <rect key={p} className={`mv ${p}`} x="-6" y="-6" width="12" height="12" rx="3" fill="#16161A" style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
          {(["p1", "p2", "p3", "p4"] as const).map((p, i) => (
            <circle key={`c-${p}`} className={`mv ${p}`} cx="0" cy="0" r="7" fill="#FFC85C" stroke="#16161A" strokeWidth="2" style={{ animationDelay: `${((i + 2) % 4) * 0.9}s` }} />
          ))}
        </svg>
      </div>
    </section>
  );
}

const STEPS = [
  { bg: "#FFF6E3", title: "Fund your job", body: "Pick a simulation, set the physics and a budget. Your BCH waits in a CashScript escrow, not with us.", art: <JarArt /> },
  { bg: "#EEF0FF", title: "Computed twice", body: "Nova cuts the job into pieces. Two independent machines compute each piece; our deterministic kernel makes honest results bit-identical.", art: <SplitArt /> },
  { bg: "#E6F6EE", title: "Paid only for matches", body: "Matching results release a BCH payout to both providers on the spot. Mismatches get re-run, and nobody is paid for wrong work.", art: <ReceiptArt /> },
];

function HowItWorks() {
  return (
    <section id="how" style={{ maxWidth: 1160, margin: "0 auto", padding: "112px 32px 32px" }}>
      <h2 style={{ margin: "0 0 56px", fontSize: 44, fontWeight: 700, letterSpacing: "-0.035em", textAlign: "center" }}>
        Three steps. <span style={{ fontStyle: "italic", color: "var(--green-ink)" }}>Verified at every one.</span>
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 28 }}>
        {STEPS.map((s) => (
          <div key={s.title} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ borderRadius: 24, background: s.bg, overflow: "hidden" }}>{s.art}</div>
            <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{s.title}</h3>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "var(--muted)" }}>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const artSvg = { display: "block", width: "100%", height: "auto" } as const;
const ink = { stroke: "#16161A", strokeWidth: 2, strokeLinejoin: "round" as const };

function JarArt() {
  return (
    <svg viewBox="0 0 320 180" style={artSvg} role="img" aria-label="A wallet dropping coins into a locked jar">
      <g {...ink}>
        <rect x="40" y="72" width="96" height="62" rx="12" fill="#FFFFFF" />
        <path d="M40 92 L136 92" fill="none" />
        <rect x="104" y="98" width="32" height="18" rx="6" fill="#FFC85C" />
        <path d="M196 70 L196 140 Q196 152 208 152 L262 152 Q274 152 274 140 L274 70 Z" fill="#FFFFFF" />
        <rect x="188" y="58" width="94" height="14" rx="5" fill="#16161A" />
        <circle cx="220" cy="134" r="10" fill="#FFC85C" /><circle cx="246" cy="134" r="10" fill="#FFC85C" /><circle cx="233" cy="114" r="10" fill="#FFC85C" />
        <rect x="222" y="34" width="22" height="18" rx="4" fill="#FFFFFF" />
        <path d="M226 34 L226 28 Q233 20 240 28 L240 34" fill="none" />
      </g>
      <path d="M146 96 C 160 80, 172 80, 184 92" fill="none" stroke="#16161A" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
    </svg>
  );
}

function SplitArt() {
  return (
    <svg viewBox="0 0 320 180" style={artSvg} role="img" aria-label="A large block splitting into small pieces that travel to two laptops">
      <g {...ink}>
        <rect x="34" y="60" width="64" height="64" rx="8" fill="#FFFFFF" />
        <line x1="66" y1="60" x2="66" y2="124" /><line x1="34" y1="92" x2="98" y2="92" />
        <rect x="210" y="34" width="72" height="46" rx="6" fill="#FFFFFF" /><path d="M200 80 L292 80 L286 90 L206 90 Z" fill="#FFFFFF" />
        <rect x="210" y="104" width="72" height="46" rx="6" fill="#FFFFFF" /><path d="M200 150 L292 150 L286 160 L206 160 Z" fill="#FFFFFF" />
        <rect x="140" y="50" width="16" height="16" rx="3" fill="#16161A" />
        <rect x="150" y="118" width="16" height="16" rx="3" fill="#16161A" />
      </g>
      <path d="M104 82 C 140 60, 170 56, 204 58" fill="none" stroke="#16161A" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
      <path d="M104 104 C 140 126, 170 128, 204 126" fill="none" stroke="#16161A" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
      <rect x="220" y="44" width="52" height="26" rx="3" fill="#D9DDFF" /><rect x="220" y="114" width="52" height="26" rx="3" fill="#D9DDFF" />
    </svg>
  );
}

function ReceiptArt() {
  return (
    <svg viewBox="0 0 320 180" style={artSvg} role="img" aria-label="Two matching receipts with a check mark, and coins going to each">
      <g {...ink}>
        <path d="M60 36 L140 36 L140 146 L130 138 L120 146 L110 138 L100 146 L90 138 L80 146 L70 138 L60 146 Z" fill="#FFFFFF" />
        <path d="M180 36 L260 36 L260 146 L250 138 L240 146 L230 138 L220 146 L210 138 L200 146 L190 138 L180 146 Z" fill="#FFFFFF" />
        <circle cx="160" cy="92" r="20" fill="#0AC18E" />
        <circle cx="100" cy="164" r="9" fill="#FFC85C" /><circle cx="220" cy="164" r="9" fill="#FFC85C" />
      </g>
      <path d="M151 92 L157 98 L169 86" fill="none" stroke="#16161A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <g stroke="#16161A" strokeWidth="2" strokeLinecap="round">
        <line x1="72" y1="58" x2="128" y2="58" /><line x1="72" y1="74" x2="116" y2="74" /><line x1="72" y1="90" x2="124" y2="90" />
        <line x1="192" y1="58" x2="248" y2="58" /><line x1="192" y1="74" x2="236" y2="74" /><line x1="192" y1="90" x2="244" y2="90" />
      </g>
    </svg>
  );
}

/** Illustrative live walk: one particle every 260 ms through a 10 cm slab. */
function LiveDemo() {
  const rand = useRef(mulberry32(20261108));
  const [state, setState] = useState<{ tracks: Track[]; n: number; t: number }>({ tracks: [], n: 0, t: 0 });

  useInterval(() => {
    const w = walk(rand.current, { thickness: 10, mfp: 3, absorb: 0.18, y0: 4.7, spread: 3.2, entry: 10, exit: 10, back: 9, maxSteps: 60, keep: true });
    setState((s) => ({ tracks: [w, ...s.tracks].slice(0, 24), n: s.n + 1, t: s.t + (w.fate === "t" ? 1 : 0) }));
  }, 260);

  return (
    <section id="live" style={{ maxWidth: 1000, margin: "0 auto", padding: "96px 32px" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 44, fontWeight: 700, letterSpacing: "-0.035em", textAlign: "center" }}>This is the work.</h2>
      <p style={{ margin: "0 0 36px", fontSize: 18, color: "var(--muted)", textAlign: "center" }}>
        Particles fired at a 10 cm wall, simulated live in your browser right now.
      </p>
      <figure style={{ margin: 0, borderRadius: 28, background: "var(--surface)", overflow: "hidden" }}>
        <svg viewBox="0 0 900 300" style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Live simulation: particles passing through a wall. Green ones made it through.">
          <defs><clipPath id="cv"><rect x="0" y="0" width="900" height="300" /></clipPath></defs>
          <rect x="290" y="0" width="320" height="300" fill="#ECECE7" />
          <g clipPath="url(#cv)">
            <Tracks tracks={state.tracks} x={(v) => 290 + v * 32} y={(v) => v * 32} fade={0.014} />
          </g>
        </svg>
        <figcaption style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "18px 26px" }}>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>One chunk of a real Nova job</span>
          <span style={{ fontSize: 15 }} aria-live="off">
            <span className="mono" style={{ color: "var(--green-ink)", fontWeight: 500 }}>{fmt(state.t)}</span>{" "}
            <span style={{ color: "var(--muted)" }}>of</span> <span className="mono">{fmt(state.n)}</span>{" "}
            <span style={{ color: "var(--muted)" }}>made it through</span>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

const PROOFS = [
  { title: "Neutron transport", what: "Particles through a wall · 4 pieces", txid: "82456f8d45c1d2269db6e2c37184872ef676f77c5f0bf0f9bfd1d7c0b3b37c9a" },
  { title: "2D Ising model", what: "Magnet phase transition · 8 temperatures", txid: "96b9259581a7c3dffc81d788217ba882578bfa4dcc6904a78d6cd4003d6818cb" },
  { title: "SIR epidemic", what: "800 simulated outbreaks · 4 pieces", txid: "a75e1044578c54c4ea3eee831067dbc2e747c081cc4a338453a3413983869bed" },
];

function Proof() {
  return (
    <section id="proof" style={{ maxWidth: 1160, margin: "0 auto", padding: "0 32px 96px" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 44, fontWeight: 700, letterSpacing: "-0.035em", textAlign: "center" }}>
        Proof, <span style={{ fontStyle: "italic", color: "var(--green-ink)" }}>not promises.</span>
      </h2>
      <p style={{ margin: "0 auto 36px", fontSize: 18, color: "var(--muted)", textAlign: "center", maxWidth: 620 }}>
        Every finished job writes a Merkle root of all its results to Bitcoin Cash. Anyone can check it.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {PROOFS.map((p) => (
          <li key={p.txid}>
            <a
              href={`https://chipnet.imaginary.cash/tx/${p.txid}`}
              target="_blank"
              rel="noreferrer"
              className="card"
              aria-label={`${p.title}: open its on-chain proof transaction (opens in a new tab)`}
              style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", padding: "22px 24px", borderRadius: 24, background: "var(--surface)", color: "var(--ink)", textDecoration: "none" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--green-ink)" }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
                On chain · OP_RETURN
              </span>
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>{p.title}</span>
              <span style={{ fontSize: 15, color: "var(--muted)" }}>{p.what}</span>
              <span className="mono" style={{ marginTop: "auto", paddingTop: 6, fontSize: 13, color: "var(--muted)" }}>
                {p.txid.slice(0, 10)}…{p.txid.slice(-6)} ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProviderCta() {
  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "32px 32px 112px" }}>
      <div style={{ borderRadius: 32, background: "var(--ink)", color: "#FFFFFF", padding: "64px 40px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 22 }}>
        <h2 style={{ margin: 0, fontSize: 44, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
          Got a computer doing nothing? <span style={{ fontStyle: "italic", color: "#3DDCA8" }}>Put it to work.</span>
        </h2>
        <p style={{ margin: 0, fontSize: 18, color: "#C9C9CF" }}>Open a browser tab and start earning. Paid in BCH for every verified piece. GPU workers coming next.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link to="/connect?role=provider" style={{ padding: "16px 28px", borderRadius: 999, background: "#FFFFFF", color: "var(--ink)", textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
            Earn with your computer
          </Link>
          <Link to="/connect?role=researcher" style={{ padding: "15px 27px", borderRadius: 999, border: "1px solid #3A3A42", color: "#FFFFFF", textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
            Run a simulation
          </Link>
        </div>
      </div>
    </section>
  );
}
