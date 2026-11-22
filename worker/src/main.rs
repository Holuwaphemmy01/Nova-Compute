//! nova-worker: run a Nova Compute provider node on your own machine.
//!
//!   nova-worker --payout-addr bitcoincash:q...            (or bchtest:q... on chipnet)
//!
//! Loop (docs/api.md): register a session → POST /work/next → compute with the native kernel →
//! POST /work/{id}/result → GET /workers/me. Ctrl+C once finishes the current piece and exits;
//! twice exits immediately.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use nova_worker::{Lease, compute_lease, self_test};
use reqwest::StatusCode;
use reqwest::blocking::{Client, Response};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Parser)]
#[command(name = "nova-worker", version, about = "Earn BCH by computing Nova Compute pieces on this machine")]
struct Args {
    /// Coordinator base URL.
    #[arg(long, default_value = "https://nova-coordinator.onrender.com")]
    coordinator: String,
    /// Your BCH payout address (P2PKH cashaddr on the coordinator's network).
    #[arg(long)]
    payout_addr: String,
    /// Do one piece, print the result and exit (for testing).
    #[arg(long)]
    once: bool,
}

#[derive(Deserialize)]
struct Session {
    worker_id: String,
    token: String,
}

#[derive(Deserialize)]
struct Me {
    verified: u64,
    mismatched: u64,
    earned_sats: u64,
    #[serde(default)]
    recent_payouts: Vec<Payout>,
}

#[derive(Deserialize)]
struct Payout {
    txid: String,
    sats: u64,
    index: u32,
}

/// Error from a coordinator call: HTTP status (None = network) and a readable message.
struct ApiErr {
    status: Option<StatusCode>,
    msg: String,
}

struct Api {
    http: Client,
    base: String,
}

impl Api {
    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn check(r: reqwest::Result<Response>) -> Result<Response, ApiErr> {
        let r = r.map_err(|e| ApiErr { status: None, msg: format!("can't reach the coordinator ({})", root_cause(&e)) })?;
        if r.status().is_success() {
            return Ok(r);
        }
        let status = r.status();
        let body: Value = r.json().unwrap_or(Value::Null);
        let msg = body["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| status.to_string());
        Err(ApiErr { status: Some(status), msg })
    }

    fn json<T: for<'de> Deserialize<'de>>(r: Response) -> Result<T, ApiErr> {
        r.json().map_err(|e| ApiErr { status: None, msg: format!("unexpected reply from the coordinator ({e})") })
    }

    fn health(&self) -> Result<Value, ApiErr> {
        Self::json(Self::check(self.http.get(self.url("/health")).send())?)
    }

    fn session(&self, payout_addr: &str, kernel_hash: &str) -> Result<Session, ApiErr> {
        let r = self.http.post(self.url("/api/v1/workers/session")).json(&json!({ "payout_addr": payout_addr, "kernel_hash": kernel_hash })).send();
        Self::json(Self::check(r)?)
    }

    fn next(&self, token: &str) -> Result<Option<Lease>, ApiErr> {
        let r = Self::check(self.http.post(self.url("/api/v1/work/next")).bearer_auth(token).send())?;
        if r.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        Self::json(r).map(Some)
    }

    fn submit(&self, token: &str, assignment_id: &str, hash: &str, output_hex: &str) -> Result<String, ApiErr> {
        let r = self.http.post(self.url(&format!("/api/v1/work/{assignment_id}/result"))).bearer_auth(token).json(&json!({ "hash": hash, "output": output_hex })).send();
        let v: Value = Self::json(Self::check(r)?)?;
        Ok(v["status"].as_str().unwrap_or("?").to_string())
    }

    fn me(&self, token: &str) -> Result<Me, ApiErr> {
        Self::json(Self::check(self.http.get(self.url("/api/v1/workers/me")).bearer_auth(token).send())?)
    }
}

fn root_cause(e: &dyn std::error::Error) -> String {
    let mut cur = e;
    while let Some(s) = cur.source() {
        cur = s;
    }
    cur.to_string()
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Sleeps in small steps so Ctrl+C is noticed quickly. Returns false if stopping.
fn nap(stop: &AtomicBool, d: Duration) -> bool {
    let end = Instant::now() + d;
    while Instant::now() < end {
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    !stop.load(Ordering::SeqCst)
}

fn main() {
    let args = Args::parse();
    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = stop.clone();
        let presses = AtomicU32::new(0);
        ctrlc::set_handler(move || {
            if presses.fetch_add(1, Ordering::SeqCst) >= 1 {
                eprintln!("\nStopped.");
                std::process::exit(130);
            }
            eprintln!("\nStopping after the current step… (Ctrl+C again to quit now)");
            stop.store(true, Ordering::SeqCst);
        })
        .expect("install Ctrl+C handler");
    }
    std::process::exit(match run(&args, &stop) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    });
}

fn run(args: &Args, stop: &AtomicBool) -> Result<(), String> {
    println!("nova-worker {}", env!("CARGO_PKG_VERSION"));
    print!("Checking the kernel against the golden hashes… ");
    let kernel_hash = self_test().map_err(|e| format!("kernel self-test failed, refusing to run: {e}"))?;
    println!("ok\n  {kernel_hash}");

    let api = Api {
        // Generous timeout: a sleeping free-tier coordinator can take ~1 min to wake.
        http: Client::builder().timeout(Duration::from_secs(90)).user_agent(concat!("nova-worker/", env!("CARGO_PKG_VERSION"))).build().map_err(|e| e.to_string())?,
        base: args.coordinator.trim_end_matches('/').to_string(),
    };

    // Health (also wakes the coordinator) → network for explorer links.
    let mut backoff = 5;
    let network = loop {
        match api.health() {
            Ok(h) => break h["network"].as_str().unwrap_or("chipnet").to_string(),
            Err(e) => {
                eprintln!("{} — retrying in {backoff}s", e.msg);
                if !nap(stop, Duration::from_secs(backoff)) {
                    return Ok(());
                }
                backoff = (backoff * 2).min(60);
            }
        }
    };
    let explorer = if network.contains("main") { "https://blockchair.com/bitcoin-cash/transaction/" } else { "https://chipnet.imaginary.cash/tx/" };
    println!("Coordinator {} ({network})", api.base);

    let mut token: Option<String> = None;
    let mut last_txid: Option<String> = None;
    let mut backoff = 5;
    let mut waiting_note = false;
    while !stop.load(Ordering::SeqCst) {
        // (Re)register: a coordinator restart invalidates old tokens.
        let tok = match &token {
            Some(t) => t.clone(),
            None => match api.session(&args.payout_addr, &kernel_hash) {
                Ok(s) => {
                    println!("Registered as worker {} → paying {}", s.worker_id, args.payout_addr);
                    token = Some(s.token.clone());
                    s.token
                }
                Err(e) if e.status == Some(StatusCode::BAD_REQUEST) => return Err(format!("the coordinator rejected the session: {}", e.msg)),
                Err(e) => {
                    eprintln!("{} — retrying in {backoff}s", e.msg);
                    nap(stop, Duration::from_secs(backoff));
                    backoff = (backoff * 2).min(60);
                    continue;
                }
            },
        };

        let lease = match api.next(&tok) {
            Ok(Some(l)) => l,
            Ok(None) => {
                if !waiting_note {
                    println!("No work right now; checking every 3s…");
                    waiting_note = true;
                }
                backoff = 5;
                nap(stop, Duration::from_secs(3));
                continue;
            }
            Err(e) if e.status == Some(StatusCode::UNAUTHORIZED) => {
                eprintln!("Session ended ({}); registering again.", e.msg);
                token = None;
                continue;
            }
            Err(e) => {
                eprintln!("{} — retrying in {backoff}s", e.msg);
                nap(stop, Duration::from_secs(backoff));
                backoff = (backoff * 2).min(60);
                continue;
            }
        };
        waiting_note = false;
        backoff = 5;

        let short = &lease.job_id[..lease.job_id.len().min(12)];
        println!("\nPiece {} of job {short}… ({}, {} trials)", lease.index, lease.template, lease.trials);
        let t0 = Instant::now();
        let out = match compute_lease(&lease) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("  could not compute this piece: {e}");
                continue; // lease expires and is reassigned
            }
        };
        let ms = t0.elapsed().as_millis();
        let left = (lease.deadline - now_ms()) / 1000;
        println!("  computed in {ms} ms · hash {}… · {left}s left on the lease", &out.hash[..16]);

        // Submit, retrying network errors until the lease deadline.
        let status = loop {
            match api.submit(&tok, &lease.assignment_id, &out.hash, &out.output_hex) {
                Ok(s) => break Some(s),
                Err(e) if e.status.is_none() && now_ms() < lease.deadline => {
                    eprintln!("  submit failed ({}) — retrying", e.msg);
                    std::thread::sleep(Duration::from_secs(2));
                }
                Err(e) => {
                    eprintln!("  result not accepted: {}", e.msg);
                    if e.status == Some(StatusCode::UNAUTHORIZED) {
                        token = None;
                    }
                    break None;
                }
            }
        };
        if let Some(s) = &status {
            println!("  piece done: {s}");
        }

        match api.me(&tok) {
            Ok(me) => {
                println!("  verified {} · mismatched {} · earned {} sats", me.verified, me.mismatched, me.earned_sats);
                if let Some(p) = me.recent_payouts.first() {
                    let new = last_txid.as_deref() != Some(p.txid.as_str());
                    println!("  {} payout: {} sats for piece {} → {explorer}{}", if new { "latest" } else { "last" }, p.sats, p.index, p.txid);
                    last_txid = Some(p.txid.clone());
                } else {
                    println!("  no payout broadcast yet (it follows once the second provider's result matches)");
                }
            }
            Err(e) => eprintln!("  couldn't read your stats: {}", e.msg),
        }

        if args.once {
            break;
        }
    }
    println!("Bye.");
    Ok(())
}
