//! Stage C: end-to-end coordinator flows on MockChain, through the HTTP API.

use std::sync::Arc;

use axum::{Router, body::Body, http::Request};
use http_body_util::BodyExt;
use nova_coordinator::{
    api,
    chain::{
        Network,
        contract::{Artifact, Escrow, EscrowParams},
        hash::sha256,
        keys::PrivateKey,
        merkle::{merkle_root, op_return_script},
        script::p2pkh,
        tx::{OutPoint, Transaction, TxIn, TxOut},
    },
    chain_client::MockChain,
    contract_rules::check_payout_tx,
    service::{Coordinator, Settings, Summary, connect_db},
};
use serde_json::{Value, json};
use tower::ServiceExt;

struct Env {
    app: Router,
    coord: Arc<Coordinator>,
    chain: Arc<MockChain>,
    researcher: String,
}

fn key(label: &str) -> PrivateKey {
    PrivateKey::from_bytes(&sha256(label.as_bytes())).unwrap()
}

async fn env_with(tweak: impl FnOnce(&mut Settings)) -> Env {
    let mut settings = Settings::new(Network::Chipnet, key("test/oracle"), key("test/fee"));
    tweak(&mut settings);
    let chain = Arc::new(MockChain::new());
    // Fund the coordinator's fee wallet (for the OP_RETURN).
    chain.add_confirmed(&Transaction {
        version: 2,
        inputs: vec![TxIn { outpoint: OutPoint { txid: sha256(b"fee-src"), vout: 0 }, unlocking_bytecode: vec![], sequence: 0 }],
        outputs: vec![TxOut { value: 20_000, locking_bytecode: settings.fee.p2pkh_script() }],
        locktime: 0,
    });
    let coord = Arc::new(Coordinator::new(connect_db("sqlite::memory:").await.unwrap(), chain.clone(), settings));
    Env { app: api::router(coord.clone()), coord, chain, researcher: key("test/researcher").address(Network::Chipnet) }
}

async fn env() -> Env {
    env_with(|_| {}).await
}

impl Env {
    async fn call(&self, method: &str, path: &str, auth: Option<&str>, body: Option<Value>) -> (u16, Value) {
        let mut req = Request::builder().method(method).uri(path).header("x-researcher-address", &self.researcher);
        if let Some(t) = auth {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let req = match body {
            Some(b) => req.header("content-type", "application/json").body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status().as_u16();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() })
    }

    /// Creates a job and funds it with a fake on-chain funding tx. Returns the job JSON.
    async fn funded_job(&self, chunks: u32, trials: u32) -> Value {
        let (s, job) = self
            .call(
                "POST",
                "/api/v1/jobs",
                None,
                Some(json!({ "params": { "thickness_cm": 10.0, "mfp_cm": 3.0, "absorb_prob": 0.18 }, "chunk_count": chunks, "trials_per_chunk": trials, "price_per_worker": 1200, "master_seed": hex::encode(b"0xNOVA2026") })),
            )
            .await;
        assert_eq!(s, 201, "{job}");
        assert_eq!(job["per_chunk_value"], 3000);
        assert_eq!(job["total_sats"], 3000 * chunks as u64);
        let lb = hex::decode(job["locking_bytecode"].as_str().unwrap()).unwrap();
        let mut outputs = vec![TxOut { value: 999, locking_bytecode: vec![0x51] }]; // unrelated output first
        outputs.extend((0..chunks).map(|_| TxOut { value: 3000, locking_bytecode: lb.clone() }));
        let funding = Transaction { version: 2, inputs: vec![TxIn { outpoint: OutPoint { txid: sha256(b"researcher-coins"), vout: 0 }, unlocking_bytecode: vec![], sequence: 0 }], outputs, locktime: 0 };
        self.chain.add_confirmed(&funding);
        let (s, v) = self.call("POST", &format!("/api/v1/jobs/{}/funded", job["job_id"].as_str().unwrap()), None, Some(json!({ "txid": funding.txid_hex() }))).await;
        assert_eq!(s, 200, "{v}");
        assert_eq!(v["status"], "running");
        v
    }

    async fn worker(&self, label: &str) -> (String, PrivateKey) {
        let k = key(label);
        let (s, v) = self.call("POST", "/api/v1/workers/session", None, Some(json!({ "payout_addr": k.address(Network::Chipnet), "kernel_hash": "test-kernel" }))).await;
        assert_eq!(s, 201, "{v}");
        (v["token"].as_str().unwrap().to_string(), k)
    }

    async fn next(&self, token: &str) -> Option<Value> {
        let (s, v) = self.call("POST", "/api/v1/work/next", Some(token), None).await;
        match s {
            200 => Some(v),
            204 => None,
            _ => panic!("work/next {s}: {v}"),
        }
    }

    async fn submit(&self, token: &str, lease: &Value, s: &Summary, hash: [u8; 32]) -> (u16, Value) {
        self.call("POST", &format!("/api/v1/work/{}/result", lease["assignment_id"].as_str().unwrap()), Some(token), Some(json!({ "hash": hex::encode(hash), "summary": s }))).await
    }
}

/// What an honest worker does: run the kernel natively.
fn compute(lease: &Value) -> (Summary, [u8; 32]) {
    let p = &lease["params"];
    let r = nova_kernel::run_chunk(
        nova_kernel::Params { thickness_cm: p["thickness_cm"].as_f64().unwrap(), mfp_cm: p["mfp_cm"].as_f64().unwrap(), absorb_prob: p["absorb_prob"].as_f64().unwrap() },
        hex::decode(lease["job_id"].as_str().unwrap()).unwrap().try_into().unwrap(),
        &hex::decode(lease["master_seed"].as_str().unwrap()).unwrap(),
        lease["index"].as_u64().unwrap() as u32,
        lease["trials"].as_u64().unwrap() as u32,
    );
    let s = Summary { transmitted: r.transmitted, reflected: r.reflected, absorbed: r.absorbed, histogram: r.histogram };
    let h: [u8; 32] = hex::decode(&r.hash).unwrap().try_into().unwrap();
    (s, h)
}

/// A dishonest worker: fakes the counts (consistently, so the hash matches its own summary).
fn lie(lease: &Value, delta: u32) -> (Summary, [u8; 32]) {
    let (mut s, _) = compute(lease);
    s.transmitted += delta;
    s.absorbed -= delta;
    let h = s.chunk_hash(&hex::decode(lease["job_id"].as_str().unwrap()).unwrap().try_into().unwrap(), lease["index"].as_u64().unwrap() as u32);
    (s, h)
}

fn escrow_from_job(env: &Env, job: &Value) -> Escrow {
    Escrow::new(
        &Artifact::embedded(),
        EscrowParams {
            researcher_pkh: key("test/researcher").pkh(),
            oracle_pk: env.coord.settings.oracle.pubkey(),
            job_id: hex::decode(job["job_id"].as_str().unwrap()).unwrap().try_into().unwrap(),
            price_per_worker: 1200,
            refund_after: job["refund_after"].as_u64().unwrap() as u32,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn honest_job_four_chunks_pays_and_writes_merkle_root() {
    let env = env().await;
    let job = env.funded_job(4, 2000).await;
    let job_id = job["job_id"].as_str().unwrap().to_string();
    let escrow = escrow_from_job(&env, &job);
    // The escrow the API reports is the one an independent rebuild from the job data produces.
    assert_eq!(job["escrow_address"], escrow.address(Network::Chipnet));

    let (t1, k1) = env.worker("test/worker1").await;
    let (t2, k2) = env.worker("test/worker2").await;

    // Two in-process workers alternate until neither gets work.
    let mut idle = 0;
    while idle < 2 {
        idle = 0;
        for t in [&t1, &t2] {
            match env.next(t).await {
                Some(lease) => {
                    let (s, h) = compute(&lease);
                    let (code, v) = env.submit(t, &lease, &s, h).await;
                    assert_eq!(code, 200, "{v}");
                }
                None => idle += 1,
            }
        }
    }
    let (_, chunks) = env.call("GET", &format!("/api/v1/jobs/{job_id}/chunks"), None, None).await;
    assert!(chunks.as_array().unwrap().iter().all(|c| c["status"] == "paying"), "{chunks}");

    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 4);
    let finals = env.coord.finalize_ready_jobs().await.unwrap();
    assert_eq!(finals.len(), 1);

    // 4 payouts + 1 OP_RETURN were broadcast.
    let txs: Vec<Transaction> = env.chain.broadcasts().iter().map(|h| Transaction::parse_hex(h).unwrap()).collect();
    assert_eq!(txs.len(), 5);
    let funding_txid = job["funding_txid"].as_str().unwrap();
    let mut spent = std::collections::HashSet::new();
    for tx in &txs[..4] {
        check_payout_tx(&escrow, tx, &[3000]).expect("payout satisfies the contract rules");
        assert_eq!(tx.inputs[0].outpoint.txid_hex(), funding_txid);
        assert!(spent.insert(tx.inputs[0].outpoint.vout), "each payout spends a different chunk UTXO");
        let payees = [tx.outputs[0].locking_bytecode.clone(), tx.outputs[1].locking_bytecode.clone()];
        assert!(payees.contains(&p2pkh(&k1.pkh())) && payees.contains(&p2pkh(&k2.pkh())));
    }

    let (_, proof) = env.call("GET", &format!("/api/v1/jobs/{job_id}/proof"), None, None).await;
    let leaves: Vec<[u8; 32]> = proof["leaves"].as_array().unwrap().iter().map(|l| hex::decode(l["hash"].as_str().unwrap()).unwrap().try_into().unwrap()).collect();
    assert_eq!(leaves.len(), 4);
    let root = merkle_root(&leaves).unwrap();
    assert_eq!(proof["merkle_root"], hex::encode(root));
    let op_return = &txs[4];
    assert_eq!(op_return.outputs[0].locking_bytecode, op_return_script(&escrow.params.job_id, &root));
    assert_eq!(op_return.outputs[0].value, 0);
    assert_eq!(proof["op_return_txid"], op_return.txid_hex());

    let (_, j) = env.call("GET", &format!("/api/v1/jobs/{job_id}"), None, None).await;
    assert_eq!(j["status"], "complete");
    assert_eq!(j["progress"]["paid"], 4);
    let (_, result) = env.call("GET", &format!("/api/v1/jobs/{job_id}/result"), None, None).await;
    assert_eq!(result["trials"], 8000);
    let frac = result["transmitted_fraction"].as_f64().unwrap();
    assert!((0.08..0.15).contains(&frac), "transmission ~11%: {frac}");
    for t in [&t1, &t2] {
        let (_, me) = env.call("GET", "/api/v1/workers/me", Some(t), None).await;
        assert_eq!(me["earned_sats"], 4 * 1200);
        assert_eq!(me["verified"], 4);
        let recent = me["recent_payouts"].as_array().unwrap();
        assert_eq!(recent.len(), 4);
        assert!(recent.iter().all(|p| p["sats"] == 1200 && p["job_id"] == job_id.as_str()));
        let txids: std::collections::HashSet<String> = txs[..4].iter().map(|t| t.txid_hex()).collect();
        assert!(recent.iter().all(|p| txids.contains(p["txid"].as_str().unwrap())));
    }

    // Close: researcher gets the oracle close signature; nothing left to sweep.
    let (s, close) = env.call("POST", &format!("/api/v1/jobs/{job_id}/close"), None, None).await;
    assert_eq!(s, 200, "{close}");
    assert_eq!(close["remaining"].as_array().unwrap().len(), 0);
    let sig: [u8; 64] = hex::decode(close["oracle_close_signature"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert!(nova_coordinator::chain::schnorr::verify_data(&env.coord.settings.oracle.pubkey(), &hex::decode(close["message"].as_str().unwrap()).unwrap(), &sig));
}

#[tokio::test]
async fn dishonest_worker_causes_mismatch_and_reassignment() {
    let env = env().await;
    let job = env.funded_job(1, 1000).await;
    let job_id = job["job_id"].as_str().unwrap().to_string();
    let (th, kh) = env.worker("test/honest1").await;
    let (tl, _) = env.worker("test/liar").await;
    let (t2, k2) = env.worker("test/honest2").await;
    let (t3, k3) = env.worker("test/honest3").await;

    let lh = env.next(&th).await.unwrap();
    let ll = env.next(&tl).await.unwrap();
    assert_eq!((lh["index"].clone(), ll["index"].clone()), (json!(0), json!(0)));
    assert!(env.next(&t2).await.is_none(), "a chunk attempt goes to exactly 2 workers");

    let (s, h) = compute(&lh);
    assert_eq!(env.submit(&th, &lh, &s, h).await.1["status"], "accepted");
    let (s, h) = lie(&ll, 7);
    assert_eq!(env.submit(&tl, &ll, &s, h).await.1["status"], "mismatch");

    for t in [&th, &tl] {
        let (_, me) = env.call("GET", "/api/v1/workers/me", Some(t), None).await;
        assert_eq!(me["mismatched"], 1);
        assert!(env.next(t).await.is_none(), "workers from a failed attempt don't get the chunk again");
    }

    // Reassigned to two new workers, who agree.
    for t in [&t2, &t3] {
        let lease = env.next(t).await.unwrap();
        let (s, h) = compute(&lease);
        env.submit(t, &lease, &s, h).await;
    }
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 1);
    env.coord.finalize_ready_jobs().await.unwrap();

    let txs: Vec<Transaction> = env.chain.broadcasts().iter().map(|h| Transaction::parse_hex(h).unwrap()).collect();
    assert_eq!(txs.len(), 2, "1 payout + OP_RETURN");
    check_payout_tx(&escrow_from_job(&env, &job), &txs[0], &[3000]).unwrap();
    let payees = [txs[0].outputs[0].locking_bytecode.clone(), txs[0].outputs[1].locking_bytecode.clone()];
    assert!(payees.contains(&p2pkh(&k2.pkh())) && payees.contains(&p2pkh(&k3.pkh())));
    assert!(!payees.contains(&p2pkh(&kh.pkh())), "the honest worker of the failed attempt is not paid");
    let (_, chunks) = env.call("GET", &format!("/api/v1/jobs/{job_id}/chunks"), None, None).await;
    assert_eq!(chunks[0]["attempt"], 1);
    assert_eq!(chunks[0]["status"], "paid");
}

#[tokio::test]
async fn after_three_mismatches_the_coordinator_computes_and_pays_the_matching_worker() {
    let env = env().await;
    let job = env.funded_job(1, 1000).await;
    let honest = env.worker("test/h").await;
    let liars: Vec<_> = futures_join(&env, &["test/l1", "test/l2", "test/l3", "test/l4", "test/l5"]).await;

    // attempt 0: honest vs l1; attempt 1: l2 vs l3; attempt 2: l4 vs l5 (liars all lie differently).
    let pairs: [(&(String, PrivateKey), u32, &(String, PrivateKey), u32); 3] =
        [(&honest, 0, &liars[0], 1), (&liars[1], 2, &liars[2], 3), (&liars[3], 4, &liars[4], 5)];
    for (a, da, b, db) in pairs {
        let la = env.next(&a.0).await.unwrap();
        let lb = env.next(&b.0).await.unwrap();
        let (s, h) = if da == 0 { compute(&la) } else { lie(&la, da) };
        env.submit(&a.0, &la, &s, h).await;
        let (s, h) = lie(&lb, db);
        assert_eq!(env.submit(&b.0, &lb, &s, h).await.1["status"], "mismatch");
    }
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 1);
    let txs: Vec<Transaction> = env.chain.broadcasts().iter().map(|h| Transaction::parse_hex(h).unwrap()).collect();
    check_payout_tx(&escrow_from_job(&env, &job), &txs[0], &[3000]).unwrap();
    assert_eq!(txs[0].outputs[0].locking_bytecode, p2pkh(&honest.1.pkh()), "the worker matching the coordinator is paid");
    assert_eq!(txs[0].outputs[1].locking_bytecode, p2pkh(&env.coord.settings.fee.pkh()), "second share to the coordinator, which computed it");
    let (_, chunks) = env.call("GET", &format!("/api/v1/jobs/{}/chunks", job["job_id"].as_str().unwrap()), None, None).await;
    assert_eq!(chunks[0]["resolved_by"], "coordinator");
}

async fn futures_join(env: &Env, labels: &[&str]) -> Vec<(String, PrivateKey)> {
    let mut v = Vec::new();
    for l in labels {
        v.push(env.worker(l).await);
    }
    v
}

#[tokio::test]
async fn leases_expire_and_one_lease_per_worker() {
    let env = env_with(|s| s.lease_ms = 400).await;
    env.funded_job(2, 500).await;
    let (t1, _) = env.worker("test/a").await;
    let (t2, _) = env.worker("test/b").await;
    let l1 = env.next(&t1).await.unwrap();
    assert_eq!(env.next(&t1).await.unwrap()["assignment_id"], l1["assignment_id"], "same active lease returned");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let (s, h) = compute(&l1);
    let (code, v) = env.submit(&t1, &l1, &s, h).await;
    assert_eq!(code, 410, "{v}");
    assert_eq!(v["error"]["code"], "lease_expired");
    assert!(env.next(&t2).await.is_some());
}

#[tokio::test]
async fn workers_sharing_a_payout_address_never_pair_on_a_chunk() {
    let env = env().await;
    env.funded_job(1, 500).await;
    let addr = key("test/shared").address(Network::Chipnet);
    let mut tokens = Vec::new();
    for _ in 0..2 {
        let (_, v) = env.call("POST", "/api/v1/workers/session", None, Some(json!({ "payout_addr": addr, "kernel_hash": "k" }))).await;
        tokens.push(v["token"].as_str().unwrap().to_string());
    }
    assert!(env.next(&tokens[0]).await.is_some());
    assert!(env.next(&tokens[1]).await.is_none(), "same payout address can't be the second worker");
}

#[tokio::test]
async fn rejects_bad_input() {
    let env = env().await;
    let (s, v) = env.call("POST", "/api/v1/jobs", None, Some(json!({ "params": { "thickness_cm": 10.0, "mfp_cm": 3.0, "absorb_prob": 0.18 }, "chunk_count": 1, "trials_per_chunk": 10, "price_per_worker": 545 }))).await;
    assert_eq!((s, v["error"]["code"].clone()), (400, json!("bad_request")), "price below dust");
    let (s, _) = env.call("POST", "/api/v1/jobs", None, Some(json!({ "params": { "thickness_cm": -1.0, "mfp_cm": 3.0, "absorb_prob": 0.18 }, "chunk_count": 1, "trials_per_chunk": 10, "price_per_worker": 1200 }))).await;
    assert_eq!(s, 400);
    let (s, _) = env.call("POST", "/api/v1/work/next", Some("not-a-token"), None).await;
    assert_eq!(s, 401);
    let (s, _) = env.call("POST", "/api/v1/workers/session", None, Some(json!({ "payout_addr": "bitcoincash:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzxa2fnhm", "kernel_hash": "k" }))).await;
    assert_eq!(s, 400, "mainnet address on chipnet");

    // A summary that doesn't reproduce the hash is rejected.
    env.funded_job(1, 500).await;
    let (t, _) = env.worker("test/x").await;
    let lease = env.next(&t).await.unwrap();
    let (s, _) = compute(&lease);
    let (code, v) = env.submit(&t, &lease, &s, [0u8; 32]).await;
    assert_eq!(code, 400, "{v}");
}

#[tokio::test]
async fn payout_broadcast_retries_after_a_network_failure() {
    let env = env().await;
    env.funded_job(1, 500).await;
    let (t1, _) = env.worker("test/r1").await;
    let (t2, _) = env.worker("test/r2").await;
    for t in [&t1, &t2] {
        let l = env.next(t).await.unwrap();
        let (s, h) = compute(&l);
        env.submit(t, &l, &s, h).await;
    }
    env.chain.fail_next_broadcasts(1);
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 0);
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 0, "backoff: not due yet");
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 1);
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), 0, "never re-sent once broadcast");
    assert_eq!(env.chain.broadcasts().len(), 1);
}

#[test]
fn summary_hash_matches_kernel() {
    let r = nova_kernel::run_chunk(nova_kernel::Params { thickness_cm: 10.0, mfp_cm: 3.0, absorb_prob: 0.18 }, [0; 32], b"0xNOVA2026", 7, 10_000);
    let s = Summary { transmitted: r.transmitted, reflected: r.reflected, absorbed: r.absorbed, histogram: r.histogram };
    assert_eq!(hex::encode(s.chunk_hash(&[0; 32], 7)), r.hash);
    assert_eq!(r.hash, "26b1ba63e890f7348ddab97872a95b5f11e6cfee533228373c9a6ed2a1976ba6", "kernel GOLDEN");
}

#[tokio::test]
async fn fund_with_raw_tx_checks_before_broadcasting_then_records() {
    let env = env().await;
    let (s, job) = env
        .call("POST", "/api/v1/jobs", None, Some(json!({ "params": { "thickness_cm": 10.0, "mfp_cm": 3.0, "absorb_prob": 0.18 }, "chunk_count": 2, "trials_per_chunk": 500, "price_per_worker": 1200 })))
        .await;
    assert_eq!(s, 201);
    let id = job["job_id"].as_str().unwrap();
    let lb = hex::decode(job["locking_bytecode"].as_str().unwrap()).unwrap();
    // The researcher's coins, already on chain.
    let coins = Transaction { version: 2, inputs: vec![TxIn { outpoint: OutPoint { txid: sha256(b"cb"), vout: 0 }, unlocking_bytecode: vec![], sequence: 0 }], outputs: vec![TxOut { value: 50_000, locking_bytecode: vec![0x51] }], locktime: 0 };
    env.chain.add_confirmed(&coins);
    let spend = |values: &[u64]| Transaction {
        version: 2,
        inputs: vec![TxIn { outpoint: OutPoint { txid: coins.txid(), vout: 0 }, unlocking_bytecode: vec![0x51], sequence: 0xffff_ffff }],
        outputs: values.iter().map(|v| TxOut { value: *v, locking_bytecode: lb.clone() }).collect(),
        locktime: 0,
    };

    // Wrong amounts: rejected and NOT broadcast.
    let (s, v) = env.call("POST", &format!("/api/v1/jobs/{id}/fund"), None, Some(json!({ "raw_tx": spend(&[3000, 2999]).to_hex() }))).await;
    assert_eq!(s, 400, "{v}");
    assert!(env.chain.broadcasts().is_empty());

    // Right amounts: broadcast via the chain client, then recorded.
    let good = spend(&[3000, 3000]);
    let (s, v) = env.call("POST", &format!("/api/v1/jobs/{id}/fund"), None, Some(json!({ "raw_tx": good.to_hex() }))).await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["status"], "running");
    assert_eq!(v["funding_txid"], good.txid_hex());
    assert_eq!(env.chain.broadcasts(), vec![good.to_hex()]);
    // Idempotent resend.
    let (s, _) = env.call("POST", &format!("/api/v1/jobs/{id}/fund"), None, Some(json!({ "raw_tx": good.to_hex() }))).await;
    assert_eq!(s, 200);

    // GET /tx/{txid} returns the raw tx through the coordinator.
    let (s, t) = env.call("GET", &format!("/api/v1/tx/{}", good.txid_hex()), None, None).await;
    assert_eq!(s, 200);
    assert_eq!(t["hex"], good.to_hex());

    // active_leases shows who is computing.
    let (tok, _) = env.worker("test/lease-a").await;
    let lease = env.next(&tok).await.unwrap();
    let (_, chunks) = env.call("GET", &format!("/api/v1/jobs/{id}/chunks"), None, None).await;
    assert_eq!(chunks[lease["index"].as_u64().unwrap() as usize]["active_leases"], 1);
}

// ---------------------------------------------------------------- templates

impl Env {
    /// Creates a template job and funds it with a fake on-chain funding tx.
    async fn funded_template_job(&self, template: &str, params: Value, chunks: u32) -> Value {
        let (s, job) = self
            .call("POST", "/api/v1/jobs", None, Some(json!({ "template": template, "params": params, "chunk_count": chunks, "price_per_worker": 1200, "master_seed": hex::encode(b"0xNOVA2026") })))
            .await;
        assert_eq!(s, 201, "{job}");
        let lb = hex::decode(job["locking_bytecode"].as_str().unwrap()).unwrap();
        let funding = Transaction {
            version: 2,
            inputs: vec![TxIn { outpoint: OutPoint { txid: sha256(template.as_bytes()), vout: 0 }, unlocking_bytecode: vec![], sequence: 0 }],
            outputs: (0..chunks).map(|_| TxOut { value: 3000, locking_bytecode: lb.clone() }).collect(),
            locktime: 0,
        };
        self.chain.add_confirmed(&funding);
        let (s, v) = self.call("POST", &format!("/api/v1/jobs/{}/funded", job["job_id"].as_str().unwrap()), None, Some(json!({ "txid": funding.txid_hex() }))).await;
        assert_eq!(s, 200, "{v}");
        assert_eq!(v["template"], template);
        v
    }

    async fn submit_output(&self, token: &str, lease: &Value, hash: &str, output: &[u8]) -> (u16, Value) {
        self.call("POST", &format!("/api/v1/work/{}/result", lease["assignment_id"].as_str().unwrap()), Some(token), Some(json!({ "hash": hash, "output": hex::encode(output) }))).await
    }
}

/// What an honest browser worker does for any template.
fn compute_template(lease: &Value) -> nova_kernel::templates::TemplateOutput {
    nova_kernel::templates::run_chunk(
        nova_kernel::templates::Template::parse(lease["template"].as_str().unwrap()).unwrap(),
        &lease["params"].to_string(),
        hex::decode(lease["job_id"].as_str().unwrap()).unwrap().try_into().unwrap(),
        &hex::decode(lease["master_seed"].as_str().unwrap()).unwrap(),
        lease["index"].as_u64().unwrap() as u32,
        lease["trials"].as_u64().unwrap() as u32,
    )
    .unwrap()
}

/// Two honest workers compute every chunk; then payouts + OP_RETURN, checked like the neutron test.
async fn run_template_job(env: &Env, template: &str, params: Value, chunks: u32) -> Value {
    let job = env.funded_template_job(template, params, chunks).await;
    let (t1, k1) = env.worker(&format!("test/{template}/w1")).await;
    let (t2, k2) = env.worker(&format!("test/{template}/w2")).await;
    let mut idle = 0;
    while idle < 2 {
        idle = 0;
        for t in [&t1, &t2] {
            match env.next(t).await {
                Some(lease) => {
                    assert_eq!(lease["template"], template);
                    let out = compute_template(&lease);
                    let (code, v) = env.submit_output(t, &lease, &out.hash, &out.output).await;
                    assert_eq!(code, 200, "{v}");
                }
                None => idle += 1,
            }
        }
    }
    assert_eq!(env.coord.process_payouts_once().await.unwrap(), chunks as usize);
    assert_eq!(env.coord.finalize_ready_jobs().await.unwrap().len(), 1);
    let txs: Vec<Transaction> = env.chain.broadcasts().iter().map(|h| Transaction::parse_hex(h).unwrap()).collect();
    assert_eq!(txs.len(), chunks as usize + 1, "payouts + OP_RETURN");
    let escrow = escrow_from_job(env, &job);
    for tx in &txs[..chunks as usize] {
        check_payout_tx(&escrow, tx, &[3000]).expect("payout satisfies the contract rules");
        let payees = [tx.outputs[0].locking_bytecode.clone(), tx.outputs[1].locking_bytecode.clone()];
        assert!(payees.contains(&p2pkh(&k1.pkh())) && payees.contains(&p2pkh(&k2.pkh())));
    }
    let (_, proof) = env.call("GET", &format!("/api/v1/jobs/{}/proof", job["job_id"].as_str().unwrap()), None, None).await;
    let leaves: Vec<[u8; 32]> = proof["leaves"].as_array().unwrap().iter().map(|l| hex::decode(l["hash"].as_str().unwrap()).unwrap().try_into().unwrap()).collect();
    assert_eq!(leaves.len(), chunks as usize);
    assert_eq!(txs[chunks as usize].outputs[0].locking_bytecode, op_return_script(&escrow.params.job_id, &merkle_root(&leaves).unwrap()));
    job
}

#[tokio::test]
async fn ising_job_end_to_end() {
    let env = env().await;
    let params = json!({ "L": 16, "t_min": 1.5, "t_max": 3.5, "eq_sweeps": 100, "meas_sweeps": 200 });
    let job = run_template_job(&env, "ising_2d", params, 8).await;
    assert_eq!(job["params"]["n_temps"], 8, "n_temps = chunk count");
    assert_eq!(job["trials_per_chunk"], 200, "trials = meas_sweeps");
    let (_, r) = env.call("GET", &format!("/api/v1/jobs/{}/result", job["job_id"].as_str().unwrap()), None, None).await;
    assert_eq!(r["template"], "ising_2d");
    assert_eq!(r["status"], "complete");
    let pts = r["points"].as_array().unwrap();
    assert_eq!(pts.len(), 8);
    let ts: Vec<f64> = pts.iter().map(|p| p["T"].as_f64().unwrap()).collect();
    assert!(ts.windows(2).all(|w| w[0] < w[1]), "sorted by T: {ts:?}");
    assert!((ts[0] - 1.5).abs() < 1e-12 && (ts[7] - 3.5).abs() < 1e-12);
    assert!(pts[0]["m"].as_f64().unwrap() > 0.9 && pts[7]["m"].as_f64().unwrap() < 0.4, "ordered to disordered: {pts:?}");
    let tc = r["tc"].as_f64().unwrap();
    assert!((1.9..=2.7).contains(&tc), "chi peaks near the transition: {tc}");
    assert_eq!(r["lattice"]["L"], 16);
    assert_eq!(r["lattice"]["bits"].as_str().unwrap().len(), 16 * 16 / 8 * 2);
    assert!((r["tc_theory"].as_f64().unwrap() - 2.269185).abs() < 1e-5);
}

#[tokio::test]
async fn sir_job_end_to_end() {
    let env = env().await;
    let params = json!({ "population": 1000, "initial_infected": 5, "r0": 3.0, "recovery_days": 7, "runs_per_chunk": 30 });
    let job = run_template_job(&env, "sir_epidemic", params, 4).await;
    assert_eq!(job["trials_per_chunk"], 30, "trials = runs_per_chunk");
    let (_, r) = env.call("GET", &format!("/api/v1/jobs/{}/result", job["job_id"].as_str().unwrap()), None, None).await;
    assert_eq!(r["template"], "sir_epidemic");
    assert_eq!(r["runs"], 120);
    assert_eq!(r["final_size_hist"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).sum::<u64>(), 120);
    let p = r["p_major"].as_f64().unwrap();
    assert!(p > 0.8, "r0=3 with 5 initial cases: most runs take off ({p})");
    let fs = r["major_final_size_mean"].as_f64().unwrap();
    assert!((0.9..=0.97).contains(&fs), "final size near 0.94: {fs}");
    assert!(r["mean_peak_day"].as_f64().unwrap() > 0.0);
    assert_eq!(r["sample_curves"].as_array().unwrap().len(), 4);
    assert_eq!(r["sample_curves"][0].as_array().unwrap().len(), 180);
}

#[tokio::test]
async fn template_results_are_checked_before_acceptance() {
    let env = env().await;
    env.funded_template_job("ising_2d", json!({ "L": 16, "eq_sweeps": 10, "meas_sweeps": 20 }), 8).await;
    let (t, _) = env.worker("test/check").await;
    let lease = env.next(&t).await.unwrap();
    let good = compute_template(&lease);
    // Output that does not match the claimed hash.
    let mut tampered = good.output.clone();
    tampered[8] ^= 1;
    let (code, v) = env.submit_output(&t, &lease, &good.hash, &tampered).await;
    assert_eq!(code, 400, "{v}");
    // A self-consistent result computed for another temperature (another chunk index).
    let mut other = lease.clone();
    other["index"] = json!((lease["index"].as_u64().unwrap() + 1) % 8);
    let wrong = compute_template(&other);
    let jid: [u8; 32] = hex::decode(lease["job_id"].as_str().unwrap()).unwrap().try_into().unwrap();
    let wrong_hash = nova_kernel::templates::output_hash(&jid, lease["index"].as_u64().unwrap() as u32, &wrong.output);
    let (code, v) = env.submit_output(&t, &lease, &wrong_hash, &wrong.output).await;
    assert_eq!(code, 400, "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("different temperature"), "{v}");
    // Neutron-style summaries are refused for template jobs; the honest output is accepted.
    let summary = json!({ "transmitted": 0, "reflected": 0, "absorbed": 0, "histogram": vec![0; 64] });
    let (code, _) = env.call("POST", &format!("/api/v1/work/{}/result", lease["assignment_id"].as_str().unwrap()), Some(&t), Some(json!({ "hash": good.hash, "summary": summary }))).await;
    assert_eq!(code, 400);
    let (code, v) = env.submit_output(&t, &lease, &good.hash, &good.output).await;
    assert_eq!(code, 200, "{v}");

    // Per-template chunk limits and param validation.
    let (code, _) = env.call("POST", "/api/v1/jobs", None, Some(json!({ "template": "ising_2d", "params": {}, "chunk_count": 4, "price_per_worker": 1200 }))).await;
    assert_eq!(code, 400, "Ising needs 8..=64 temperatures");
    let (code, _) = env.call("POST", "/api/v1/jobs", None, Some(json!({ "template": "sir_epidemic", "params": { "r0": 9 }, "chunk_count": 4, "price_per_worker": 1200 }))).await;
    assert_eq!(code, 400, "r0 out of range");
}
