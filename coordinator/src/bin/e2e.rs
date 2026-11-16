//! Real chipnet end-to-end run of the coordinator.
//!
//!   cargo run -p nova-coordinator --bin e2e -- --chunks 4 --price 1200 [--trials 10000]
//!
//! Needs ORACLE_WIF and FEE_WIF (chipnet) in the environment or a .env file; the FEE_WIF wallet
//! funds the job (it plays the researcher, so close/refund would return funds to it) and pays
//! the OP_RETURN. Creates a job, funds it, runs 2 in-process workers with different payout
//! addresses, waits for every payout and the Merkle-root OP_RETURN, and prints all txids.

use std::sync::Arc;
use std::time::{Duration, Instant};

use nova_coordinator::{
    chain::{Network, contract::electrum_scripthash, keys::PrivateKey, tx::{OutPoint, TxOut}, wallet::{Utxo, build_signed}},
    chain_client::ChainClient,
    config::Config,
    fulcrum::FulcrumClient,
    service::{self, Coordinator, CreateJob, JobParams, Summary, Worker},
};

fn arg(name: &str, default: u64) -> u64 {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(|v| v.parse().unwrap_or_else(|_| panic!("{name} must be a number"))).unwrap_or(default)
}

fn link(net: Network, txid: &str) -> String {
    format!("{txid}\n      {}", net.explorer_tx_url(txid))
}

async fn run_worker(c: Arc<Coordinator>, w: Worker, job_id: String) -> u32 {
    let mut done = 0;
    loop {
        if matches!(c.get_job(&job_id).await.map(|j| j.status), Ok(s) if s != "running") {
            return done;
        }
        let Some(lease) = c.next_work(&w).await.expect("next_work") else {
            tokio::time::sleep(Duration::from_millis(500)).await;
            continue;
        };
        let params = nova_kernel::Params { thickness_cm: lease.params.thickness_cm, mfp_cm: lease.params.mfp_cm, absorb_prob: lease.params.absorb_prob };
        let jid: [u8; 32] = hex::decode(&lease.job_id).unwrap().try_into().unwrap();
        let seed = hex::decode(&lease.master_seed).unwrap();
        let (index, trials) = (lease.index, lease.trials);
        let r = tokio::task::spawn_blocking(move || nova_kernel::run_chunk(params, jid, &seed, index, trials)).await.unwrap();
        let summary = Summary { transmitted: r.transmitted, reflected: r.reflected, absorbed: r.absorbed, histogram: r.histogram };
        let outcome = c.submit_result(&w, &lease.assignment_id, &r.hash, summary).await.expect("submit");
        println!("  worker {} chunk {index}: {outcome:?}", &w.payout_addr[8..20]);
        done += 1;
    }
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into())).init();
    let chunks = arg("--chunks", 4) as u32;
    let price = arg("--price", 1200);
    let trials = arg("--trials", 10_000) as u32;

    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}\nSet ORACLE_WIF and FEE_WIF (chipnet keys) in the environment or coordinator/.env.");
        std::process::exit(2)
    });
    let net = cfg.settings.network;
    if net != Network::Chipnet {
        eprintln!("e2e only runs on chipnet");
        std::process::exit(2);
    }
    let fee = cfg.settings.fee.clone();
    let researcher_addr = fee.address(net);
    let chain = Arc::new(FulcrumClient::new(&cfg.fulcrum_servers).expect("fulcrum"));
    let db_path = std::env::temp_dir().join(format!("nova-e2e-{}.db", service::now_ms()));
    let db = service::connect_db(&format!("sqlite://{}", db_path.display())).await.expect("db");
    let c = Arc::new(Coordinator::new(db, chain.clone(), cfg.settings));
    tokio::spawn(service::run_background(c.clone()));

    // 1. Job
    let job = c
        .create_job(
            &researcher_addr,
            CreateJob {
                params: JobParams { thickness_cm: 10.0, mfp_cm: 3.0, absorb_prob: 0.18 },
                chunk_count: chunks,
                trials_per_chunk: trials,
                price_per_worker: price,
                master_seed: None,
                refund_after: None,
            },
        )
        .await
        .expect("create job");
    println!("job      {}\nescrow   {}\nneeds    {} sats ({chunks} × {})", job.job_id, job.escrow_address, job.total_sats, job.per_chunk_value);

    // 2. Fund from FEE_WIF (built and signed in Rust)
    let script = fee.p2pkh_script();
    let utxos: Vec<Utxo> = chain
        .list_unspent(&electrum_scripthash(&script))
        .await
        .expect("listunspent")
        .into_iter()
        .map(|u| Utxo { outpoint: OutPoint::from_txid_hex(&u.tx_hash, u.tx_pos).unwrap(), value: u.value })
        .collect();
    let balance: u64 = utxos.iter().map(|u| u.value).sum();
    let needed = job.total_sats + 2_000;
    if balance < needed {
        eprintln!("\nFEE_WIF wallet {researcher_addr} has {balance} sats; needs about {needed} (+ ~1,000 for the OP_RETURN). Fund it from a chipnet faucet and re-run.");
        std::process::exit(1);
    }
    let lb = hex::decode(&job.locking_bytecode).unwrap();
    let outputs = (0..chunks).map(|_| TxOut { value: job.per_chunk_value, locking_bytecode: lb.clone() }).collect();
    let funding = build_signed(&fee, &utxos, outputs, 1).expect("build funding");
    let funding_txid = chain.broadcast(&funding.to_hex()).await.expect("broadcast funding");
    println!("\nfunding  {}", link(net, &funding_txid));
    c.mark_funded(&job.job_id, &researcher_addr, &funding_txid).await.expect("mark funded");

    // 3. Two in-process workers with different payout addresses
    let mut handles = Vec::new();
    for _ in 0..2 {
        let k = PrivateKey::random();
        let s = c.create_worker(&k.address(net), "nova-kernel/0.1 native").await.unwrap();
        let w = c.auth_worker(&s.token).await.unwrap();
        println!("worker   {}", w.payout_addr);
        handles.push(tokio::spawn(run_worker(c.clone(), w, job.job_id.clone())));
    }

    // 4. Wait for payouts + OP_RETURN
    let start = Instant::now();
    let view = loop {
        let v = c.get_job(&job.job_id).await.unwrap();
        if v.status == "complete" {
            break v;
        }
        if start.elapsed() > Duration::from_secs(600) {
            eprintln!("timed out; job status {} ({:?})", v.status, v.last_error);
            std::process::exit(1);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    };
    for h in handles {
        let _ = h.await;
    }

    println!("\npayouts");
    for ch in c.get_chunks(&job.job_id).await.unwrap() {
        println!("  chunk {} {}", ch.index, link(net, ch.payout_txid.as_deref().unwrap_or("-")));
    }
    println!("\nmerkle   {}", view.merkle_root.unwrap_or_default());
    println!("op_return {}", link(net, view.op_return_txid.as_deref().unwrap_or("-")));
    let r = c.get_result(&job.job_id).await.unwrap();
    println!("\nresult   {:.2}% transmitted ± {:.2}% over {} particles", 100.0 * r.transmitted_fraction, 100.0 * r.transmitted_std_error, r.trials);
    let _ = std::fs::remove_file(&db_path);
}
