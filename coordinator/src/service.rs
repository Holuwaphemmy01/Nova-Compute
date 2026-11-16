//! Core coordinator logic: jobs, chunk scheduling (2 distinct workers per chunk), result
//! verification, oracle attestations, payouts and job finalization (Merkle root OP_RETURN).
//! The HTTP layer (`api`) and background loop (`run_background`) call into [`Coordinator`].

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nova_kernel::{HIST_BINS, Params};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use thiserror::Error;
use tokio::sync::{Mutex, Notify};

use crate::chain::{
    Network,
    attestation::{close_message, payout_message, sign_close, sign_payout},
    cashaddr::decode_p2pkh,
    contract::{Artifact, Escrow, EscrowParams, chunk_value, electrum_scripthash},
    hash::sha256,
    keys::PrivateKey,
    merkle::{merkle_root, op_return_script},
    payout::{PayoutItem, build_payout_tx},
    tx::{OutPoint, Transaction, TxOut},
    wallet::{DUST, Utxo, build_signed},
};
use crate::chain_client::{ChainClient, ChainClientError};
use crate::contract_rules::check_payout_tx;

// ---------------------------------------------------------------- settings & errors

#[derive(Clone, Debug)]
pub struct Settings {
    pub network: Network,
    pub oracle: PrivateKey,
    pub fee: PrivateKey,
    /// Lease length for a chunk assignment.
    pub lease_ms: i64,
    /// Failed (mismatched) attempts before the coordinator computes the chunk itself.
    pub max_attempts: i64,
    /// Fee rate for coordinator-signed txs (sat/byte).
    pub fee_rate: u64,
    /// Default escrow refund delay when a job doesn't specify one.
    pub default_refund_delay_secs: i64,
}

impl Settings {
    pub fn new(network: Network, oracle: PrivateKey, fee: PrivateKey) -> Self {
        Self { network, oracle, fee, lease_ms: 60_000, max_attempts: 3, fee_rate: 1, default_refund_delay_secs: 7 * 24 * 3600 }
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("missing or invalid credentials")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Conflict(String),
    #[error("lease expired")]
    LeaseExpired,
    #[error("blockchain: {0}")]
    Chain(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::BadRequest(_) => "bad_request",
            AppError::NotFound(_) => "not_found",
            AppError::Unauthorized => "unauthorized",
            AppError::Forbidden(_) => "forbidden",
            AppError::Conflict(_) => "conflict",
            AppError::LeaseExpired => "lease_expired",
            AppError::Chain(_) => "chain_error",
            AppError::Internal(_) => "internal",
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<ChainClientError> for AppError {
    fn from(e: ChainClientError) -> Self {
        AppError::Chain(e.to_string())
    }
}

type R<T> = Result<T, AppError>;

fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    rand::rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn hex32(s: &str) -> R<[u8; 32]> {
    hex::decode(s).ok().and_then(|b| b.try_into().ok()).ok_or_else(|| bad("expected 32-byte hex"))
}

fn hex20(s: &str) -> R<[u8; 20]> {
    hex::decode(s).ok().and_then(|b| b.try_into().ok()).ok_or_else(|| AppError::Internal("bad stored pkh".into()))
}

// ---------------------------------------------------------------- API types

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JobParams {
    pub thickness_cm: f64,
    pub mfp_cm: f64,
    pub absorb_prob: f64,
}

#[derive(Debug, Deserialize)]
pub struct CreateJob {
    pub params: JobParams,
    pub chunk_count: u32,
    pub trials_per_chunk: u32,
    pub price_per_worker: u64,
    /// Hex; random if omitted.
    pub master_seed: Option<String>,
    /// nLockTime value after which the researcher may refund alone; default now + 7 days.
    pub refund_after: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct JobCreated {
    pub job_id: String,
    pub config_hash: String,
    pub chunk_count: u32,
    pub escrow_address: String,
    pub locking_bytecode: String,
    pub per_chunk_value: u64,
    pub total_sats: u64,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct Progress {
    pub pending: i64,
    pub paying: i64,
    pub paid: i64,
    pub unpaid: i64,
}

#[derive(Debug, Serialize)]
pub struct JobView {
    pub job_id: String,
    pub researcher_addr: String,
    pub status: String,
    pub params: JobParams,
    pub master_seed: String,
    pub chunk_count: i64,
    pub trials_per_chunk: i64,
    pub price_per_worker: i64,
    pub per_chunk_value: i64,
    pub total_sats: i64,
    pub refund_after: i64,
    pub config_hash: String,
    pub escrow_address: String,
    pub funding_txid: Option<String>,
    pub merkle_root: Option<String>,
    pub op_return_txid: Option<String>,
    pub last_error: Option<String>,
    pub progress: Progress,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ChunkView {
    pub index: i64,
    pub status: String,
    pub attempt: i64,
    pub outpoint: Option<String>,
    pub verified_hash: Option<String>,
    pub resolved_by: Option<String>,
    pub payout_txid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Summary {
    pub transmitted: u32,
    pub reflected: u32,
    pub absorbed: u32,
    pub histogram: Vec<u32>,
}

impl Summary {
    /// The kernel's canonical output bytes: u32 LE t, r, a, then 64 × u32 LE bins.
    pub fn output_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 * (3 + HIST_BINS));
        for v in [self.transmitted, self.reflected, self.absorbed].iter().chain(self.histogram.iter()) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// The kernel's chunk hash: sha256(job_id ‖ index u32 BE ‖ output bytes).
    pub fn chunk_hash(&self, job_id: &[u8; 32], index: u32) -> [u8; 32] {
        let mut b = job_id.to_vec();
        b.extend_from_slice(&index.to_be_bytes());
        b.extend_from_slice(&self.output_bytes());
        sha256(&b)
    }
}

#[derive(Debug, Serialize)]
pub struct JobResult {
    pub job_id: String,
    pub status: String,
    pub chunks_verified: i64,
    pub chunk_count: i64,
    pub trials: u64,
    pub transmitted: u64,
    pub reflected: u64,
    pub absorbed: u64,
    pub transmitted_fraction: f64,
    pub transmitted_std_error: f64,
    pub histogram: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub struct ProofLeaf {
    pub index: i64,
    pub hash: String,
    pub resolved_by: Option<String>,
    pub payout_txid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct JobProof {
    pub job_id: String,
    pub config_hash: String,
    pub escrow_address: String,
    pub funding_txid: Option<String>,
    pub merkle_root: Option<String>,
    pub op_return_txid: Option<String>,
    pub merkle_rule: &'static str,
    pub leaves: Vec<ProofLeaf>,
}

#[derive(Debug, Serialize)]
pub struct WorkerSession {
    pub worker_id: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct Worker {
    pub id: String,
    pub payout_addr: String,
    pub payout_pkh: String,
}

#[derive(Debug, Serialize)]
pub struct WorkerView {
    pub worker_id: String,
    pub payout_addr: String,
    pub kernel_hash: String,
    pub verified: i64,
    pub mismatched: i64,
    pub earned_sats: i64,
    pub active_lease: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Lease {
    pub assignment_id: String,
    pub job_id: String,
    pub index: u32,
    pub master_seed: String,
    pub params: JobParams,
    pub trials: u32,
    pub deadline: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubmitOutcome {
    /// Waiting for the other worker's result.
    Accepted,
    /// Both results matched; the payout is queued.
    Verified,
    /// Results differed; the chunk is reassigned (or resolved by the coordinator).
    Mismatch,
}

#[derive(Debug, Serialize)]
pub struct CloseInfo {
    pub job_id: String,
    pub message: String,
    pub oracle_close_signature: String,
    pub oracle_pubkey: String,
    pub remaining: Vec<RemainingUtxo>,
}

#[derive(Debug, Serialize)]
pub struct RemainingUtxo {
    pub index: i64,
    pub txid: String,
    pub vout: i64,
    pub value: i64,
}

// ---------------------------------------------------------------- coordinator

pub struct Coordinator {
    pub db: SqlitePool,
    pub chain: Arc<dyn ChainClient>,
    pub settings: Settings,
    artifact: Artifact,
    /// Serializes state transitions (leasing, submissions, payouts, finalization).
    lock: Mutex<()>,
    pub wake: Notify,
}

struct JobRow {
    id: String,
    researcher_addr: String,
    researcher_pkh: String,
    params: JobParams,
    master_seed: String,
    chunk_count: i64,
    trials_per_chunk: i64,
    price_per_worker: i64,
    refund_after: i64,
    config_hash: String,
    escrow_address: String,
    locking_bytecode: String,
    per_chunk_value: i64,
    status: String,
    funding_txid: Option<String>,
    merkle_root: Option<String>,
    op_return_txid: Option<String>,
    last_error: Option<String>,
    created_at: i64,
}

impl JobRow {
    fn from_row(r: &SqliteRow) -> Self {
        Self {
            id: r.get("id"),
            researcher_addr: r.get("researcher_addr"),
            researcher_pkh: r.get("researcher_pkh"),
            params: JobParams { thickness_cm: r.get("thickness_cm"), mfp_cm: r.get("mfp_cm"), absorb_prob: r.get("absorb_prob") },
            master_seed: r.get("master_seed"),
            chunk_count: r.get("chunk_count"),
            trials_per_chunk: r.get("trials_per_chunk"),
            price_per_worker: r.get("price_per_worker"),
            refund_after: r.get("refund_after"),
            config_hash: r.get("config_hash"),
            escrow_address: r.get("escrow_address"),
            locking_bytecode: r.get("locking_bytecode"),
            per_chunk_value: r.get("per_chunk_value"),
            status: r.get("status"),
            funding_txid: r.get("funding_txid"),
            merkle_root: r.get("merkle_root"),
            op_return_txid: r.get("op_return_txid"),
            last_error: r.get("last_error"),
            created_at: r.get("created_at"),
        }
    }

    fn job_id(&self) -> [u8; 32] {
        hex32(&self.id).expect("stored job id")
    }

    fn kernel_params(&self) -> Params {
        Params { thickness_cm: self.params.thickness_cm, mfp_cm: self.params.mfp_cm, absorb_prob: self.params.absorb_prob }
    }
}

impl Coordinator {
    pub fn new(db: SqlitePool, chain: Arc<dyn ChainClient>, settings: Settings) -> Self {
        Self { db, chain, settings, artifact: Artifact::embedded(), lock: Mutex::new(()), wake: Notify::new() }
    }

    fn prefix(&self) -> &'static str {
        self.settings.network.cashaddr_prefix()
    }

    fn escrow_for(&self, job: &JobRow) -> R<Escrow> {
        let params = EscrowParams {
            researcher_pkh: hex20(&job.researcher_pkh)?,
            oracle_pk: self.settings.oracle.pubkey(),
            job_id: job.job_id(),
            price_per_worker: job.price_per_worker as u64,
            refund_after: job.refund_after as u32,
        };
        Escrow::new(&self.artifact, params).map_err(|e| AppError::Internal(e.to_string()))
    }

    async fn job(&self, id: &str) -> R<JobRow> {
        let row = sqlx::query("SELECT * FROM jobs WHERE id = ?").bind(id).fetch_optional(&self.db).await?;
        row.map(|r| JobRow::from_row(&r)).ok_or(AppError::NotFound("job"))
    }

    // ------------------------------------------------------------ jobs

    pub async fn create_job(&self, researcher_addr: &str, req: CreateJob) -> R<JobCreated> {
        let researcher_pkh = decode_p2pkh(researcher_addr, self.prefix()).map_err(|e| bad(format!("researcher address: {e}")))?;
        let p = Params { thickness_cm: req.params.thickness_cm, mfp_cm: req.params.mfp_cm, absorb_prob: req.params.absorb_prob };
        p.validate().map_err(|e| bad(e.to_string()))?;
        if req.price_per_worker < DUST {
            return Err(bad(format!("price_per_worker must be >= {DUST} sats (dust limit)")));
        }
        if req.price_per_worker > 100_000_000 {
            return Err(bad("price_per_worker too large"));
        }
        if !(1..=1000).contains(&req.chunk_count) {
            return Err(bad("chunk_count must be 1..=1000"));
        }
        if !(1..=5_000_000).contains(&req.trials_per_chunk) {
            return Err(bad("trials_per_chunk must be 1..=5,000,000"));
        }
        let master_seed = match req.master_seed {
            Some(s) => {
                let b = hex::decode(&s).map_err(|_| bad("master_seed must be hex"))?;
                if b.is_empty() || b.len() > 64 {
                    return Err(bad("master_seed must be 1..=64 bytes"));
                }
                hex::encode(b)
            }
            None => random_hex(32),
        };
        let refund_after = match req.refund_after {
            Some(t) => t,
            None => ((now_ms() / 1000) + self.settings.default_refund_delay_secs) as u32,
        };

        // config_hash commits to everything a worker computes with, plus pricing.
        let config = serde_json::json!({
            "kernel": "nova-kernel/0.1",
            "params": { "thickness_cm": p.thickness_cm, "mfp_cm": p.mfp_cm, "absorb_prob": p.absorb_prob },
            "chunk_count": req.chunk_count,
            "trials_per_chunk": req.trials_per_chunk,
            "master_seed": master_seed,
            "price_per_worker": req.price_per_worker,
        });
        let config_hash = sha256(config.to_string().as_bytes());
        let mut job_id_pre = config_hash.to_vec();
        job_id_pre.extend_from_slice(&researcher_pkh);
        job_id_pre.extend_from_slice(&hex::decode(random_hex(16)).unwrap());
        let job_id = sha256(&job_id_pre);

        let escrow = Escrow::new(
            &self.artifact,
            EscrowParams { researcher_pkh, oracle_pk: self.settings.oracle.pubkey(), job_id, price_per_worker: req.price_per_worker, refund_after },
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        let per_chunk_value = chunk_value(req.price_per_worker);
        let address = escrow.address(self.settings.network);
        let now = now_ms();

        let mut tx = self.db.begin().await?;
        sqlx::query(
            "INSERT INTO jobs (id, researcher_addr, researcher_pkh, thickness_cm, mfp_cm, absorb_prob, master_seed, chunk_count, trials_per_chunk,
             price_per_worker, refund_after, config_hash, escrow_address, locking_bytecode, per_chunk_value, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_funding', ?, ?)",
        )
        .bind(hex::encode(job_id))
        .bind(researcher_addr)
        .bind(hex::encode(researcher_pkh))
        .bind(p.thickness_cm)
        .bind(p.mfp_cm)
        .bind(p.absorb_prob)
        .bind(&master_seed)
        .bind(req.chunk_count as i64)
        .bind(req.trials_per_chunk as i64)
        .bind(req.price_per_worker as i64)
        .bind(refund_after as i64)
        .bind(hex::encode(config_hash))
        .bind(&address)
        .bind(hex::encode(&escrow.locking_bytecode))
        .bind(per_chunk_value as i64)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        for idx in 0..req.chunk_count {
            sqlx::query("INSERT INTO chunks (job_id, idx) VALUES (?, ?)").bind(hex::encode(job_id)).bind(idx as i64).execute(&mut *tx).await?;
        }
        tx.commit().await?;

        Ok(JobCreated {
            job_id: hex::encode(job_id),
            config_hash: hex::encode(config_hash),
            chunk_count: req.chunk_count,
            escrow_address: address,
            locking_bytecode: hex::encode(&escrow.locking_bytecode),
            per_chunk_value,
            total_sats: per_chunk_value * req.chunk_count as u64,
            status: "awaiting_funding".into(),
        })
    }

    /// Verifies the funding tx has `chunk_count` outputs of `per_chunk_value` to the escrow and
    /// records each chunk's outpoint. Accepts unconfirmed (0-conf) funding.
    pub async fn mark_funded(&self, job_id: &str, researcher_addr: &str, txid: &str) -> R<JobView> {
        let _g = self.lock.lock().await;
        let job = self.job(job_id).await?;
        if job.researcher_addr != researcher_addr {
            return Err(AppError::Forbidden("not this job's researcher".into()));
        }
        if job.status != "awaiting_funding" {
            if job.funding_txid.as_deref() == Some(txid) {
                drop(_g);
                return self.get_job(job_id).await; // idempotent
            }
            return Err(AppError::Conflict(format!("job is {}", job.status)));
        }
        hex32(txid).map_err(|_| bad("txid must be 32-byte hex"))?;
        let raw = self.chain.get_transaction(txid).await?;
        let tx = Transaction::parse_hex(&raw).map_err(|e| bad(format!("funding tx: {e}")))?;
        if tx.txid_hex() != txid {
            return Err(AppError::Chain("server returned a different transaction".into()));
        }
        let lb = hex::decode(&job.locking_bytecode).unwrap();
        let matches: Vec<u32> = tx
            .outputs
            .iter()
            .enumerate()
            .filter(|(_, o)| o.locking_bytecode == lb && o.value == job.per_chunk_value as u64)
            .map(|(i, _)| i as u32)
            .collect();
        if (matches.len() as i64) < job.chunk_count {
            return Err(bad(format!(
                "funding tx has {} outputs of {} sats to the escrow, need {}",
                matches.len(),
                job.per_chunk_value,
                job.chunk_count
            )));
        }
        let mut dbtx = self.db.begin().await?;
        for (idx, vout) in matches.iter().take(job.chunk_count as usize).enumerate() {
            sqlx::query("UPDATE chunks SET outpoint_txid = ?, outpoint_vout = ?, value = ? WHERE job_id = ? AND idx = ?")
                .bind(txid)
                .bind(*vout as i64)
                .bind(job.per_chunk_value)
                .bind(job_id)
                .bind(idx as i64)
                .execute(&mut *dbtx)
                .await?;
        }
        sqlx::query("UPDATE jobs SET status = 'running', funding_txid = ?, updated_at = ? WHERE id = ?").bind(txid).bind(now_ms()).bind(job_id).execute(&mut *dbtx).await?;
        dbtx.commit().await?;
        drop(_g);
        self.get_job(job_id).await
    }

    async fn progress(&self, job_id: &str) -> R<Progress> {
        let rows = sqlx::query("SELECT status, COUNT(*) AS n FROM chunks WHERE job_id = ? GROUP BY status").bind(job_id).fetch_all(&self.db).await?;
        let mut p = Progress { pending: 0, paying: 0, paid: 0, unpaid: 0 };
        for r in rows {
            let n: i64 = r.get("n");
            match r.get::<String, _>("status").as_str() {
                "pending" => p.pending = n,
                "paying" => p.paying = n,
                "paid" => p.paid = n,
                "unpaid" => p.unpaid = n,
                _ => {}
            }
        }
        Ok(p)
    }

    fn view(job: JobRow, progress: Progress) -> JobView {
        JobView {
            total_sats: job.per_chunk_value * job.chunk_count,
            job_id: job.id,
            researcher_addr: job.researcher_addr,
            status: job.status,
            params: job.params,
            master_seed: job.master_seed,
            chunk_count: job.chunk_count,
            trials_per_chunk: job.trials_per_chunk,
            price_per_worker: job.price_per_worker,
            per_chunk_value: job.per_chunk_value,
            refund_after: job.refund_after,
            config_hash: job.config_hash,
            escrow_address: job.escrow_address,
            funding_txid: job.funding_txid,
            merkle_root: job.merkle_root,
            op_return_txid: job.op_return_txid,
            last_error: job.last_error,
            progress,
            created_at: job.created_at,
        }
    }

    pub async fn get_job(&self, id: &str) -> R<JobView> {
        let job = self.job(id).await?;
        let p = self.progress(id).await?;
        Ok(Self::view(job, p))
    }

    pub async fn list_jobs(&self, researcher_addr: Option<&str>) -> R<Vec<JobView>> {
        let rows = match researcher_addr {
            Some(a) => sqlx::query("SELECT * FROM jobs WHERE researcher_addr = ? ORDER BY created_at DESC").bind(a).fetch_all(&self.db).await?,
            None => sqlx::query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").fetch_all(&self.db).await?,
        };
        let mut out = Vec::new();
        for r in rows {
            let job = JobRow::from_row(&r);
            let p = self.progress(&job.id).await?;
            out.push(Self::view(job, p));
        }
        Ok(out)
    }

    pub async fn get_chunks(&self, job_id: &str) -> R<Vec<ChunkView>> {
        self.job(job_id).await?;
        let rows = sqlx::query(
            "SELECT c.*, p.txid AS payout_txid, p.status AS payout_status FROM chunks c
             LEFT JOIN payouts p ON p.job_id = c.job_id AND p.idx = c.idx WHERE c.job_id = ? ORDER BY c.idx",
        )
        .bind(job_id)
        .fetch_all(&self.db)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let txid: Option<String> = r.get("outpoint_txid");
                let vout: Option<i64> = r.get("outpoint_vout");
                let payout_status: Option<String> = r.get("payout_status");
                ChunkView {
                    index: r.get("idx"),
                    status: r.get("status"),
                    attempt: r.get("attempt"),
                    outpoint: txid.zip(vout).map(|(t, v)| format!("{t}:{v}")),
                    verified_hash: r.get("verified_hash"),
                    resolved_by: r.get("resolved_by"),
                    payout_txid: if payout_status.as_deref() == Some("broadcast") { r.get("payout_txid") } else { None },
                }
            })
            .collect())
    }

    pub async fn get_result(&self, job_id: &str) -> R<JobResult> {
        let job = self.job(job_id).await?;
        let rows = sqlx::query("SELECT verified_summary FROM chunks WHERE job_id = ? AND verified_summary IS NOT NULL ORDER BY idx").bind(job_id).fetch_all(&self.db).await?;
        let mut res = JobResult {
            job_id: job.id.clone(),
            status: job.status.clone(),
            chunks_verified: rows.len() as i64,
            chunk_count: job.chunk_count,
            trials: 0,
            transmitted: 0,
            reflected: 0,
            absorbed: 0,
            transmitted_fraction: 0.0,
            transmitted_std_error: 0.0,
            histogram: vec![0; HIST_BINS],
        };
        for r in rows {
            let s: Summary = serde_json::from_str(&r.get::<String, _>("verified_summary")).map_err(|e| AppError::Internal(e.to_string()))?;
            res.transmitted += s.transmitted as u64;
            res.reflected += s.reflected as u64;
            res.absorbed += s.absorbed as u64;
            for (h, v) in res.histogram.iter_mut().zip(&s.histogram) {
                *h += *v as u64;
            }
        }
        res.trials = res.transmitted + res.reflected + res.absorbed;
        if res.trials > 0 {
            let p = res.transmitted as f64 / res.trials as f64;
            res.transmitted_fraction = p;
            res.transmitted_std_error = (p * (1.0 - p) / res.trials as f64).sqrt();
        }
        Ok(res)
    }

    pub async fn get_proof(&self, job_id: &str) -> R<JobProof> {
        let job = self.job(job_id).await?;
        let chunks = self.get_chunks(job_id).await?;
        Ok(JobProof {
            job_id: job.id,
            config_hash: job.config_hash,
            escrow_address: job.escrow_address,
            funding_txid: job.funding_txid,
            merkle_root: job.merkle_root,
            op_return_txid: job.op_return_txid,
            merkle_rule: "SHA-256 over pairs of verified chunk hashes in chunk-index order, duplicating the last when odd; OP_RETURN 'NOVA' ‖ job_id ‖ root",
            leaves: chunks
                .into_iter()
                .filter_map(|c| c.verified_hash.clone().map(|hash| ProofLeaf { index: c.index, hash, resolved_by: c.resolved_by, payout_txid: c.payout_txid }))
                .collect(),
        })
    }

    /// Oracle close signature for the researcher (to sweep unused chunk UTXOs with `close`).
    /// Refused while any verified chunk is still waiting for its payout. Stops scheduling.
    pub async fn close_job(&self, job_id: &str, researcher_addr: &str) -> R<CloseInfo> {
        let _g = self.lock.lock().await;
        let job = self.job(job_id).await?;
        if job.researcher_addr != researcher_addr {
            return Err(AppError::Forbidden("not this job's researcher".into()));
        }
        let paying: i64 = sqlx::query("SELECT COUNT(*) AS n FROM chunks WHERE job_id = ? AND status = 'paying'").bind(job_id).fetch_one(&self.db).await?.get("n");
        if paying > 0 {
            return Err(AppError::Conflict(format!("{paying} verified chunk(s) are still being paid; try again shortly")));
        }
        if job.status != "complete" && job.status != "closed" {
            sqlx::query("UPDATE jobs SET status = 'closed', updated_at = ? WHERE id = ?").bind(now_ms()).bind(job_id).execute(&self.db).await?;
            sqlx::query("UPDATE assignments SET status = 'expired' WHERE job_id = ? AND status = 'active'").bind(job_id).execute(&self.db).await?;
        }
        let jid = job.job_id();
        let rows = sqlx::query("SELECT idx, outpoint_txid, outpoint_vout, value FROM chunks WHERE job_id = ? AND status IN ('pending', 'unpaid') AND outpoint_txid IS NOT NULL ORDER BY idx")
            .bind(job_id)
            .fetch_all(&self.db)
            .await?;
        Ok(CloseInfo {
            job_id: job.id,
            message: hex::encode(close_message(&jid)),
            oracle_close_signature: hex::encode(sign_close(&self.settings.oracle, &jid)),
            oracle_pubkey: hex::encode(self.settings.oracle.pubkey()),
            remaining: rows.iter().map(|r| RemainingUtxo { index: r.get("idx"), txid: r.get("outpoint_txid"), vout: r.get("outpoint_vout"), value: r.get("value") }).collect(),
        })
    }

    // ------------------------------------------------------------ workers

    pub async fn create_worker(&self, payout_addr: &str, kernel_hash: &str) -> R<WorkerSession> {
        let pkh = decode_p2pkh(payout_addr, self.prefix()).map_err(|e| bad(format!("payout_addr: {e}")))?;
        if kernel_hash.is_empty() || kernel_hash.len() > 128 {
            return Err(bad("kernel_hash required"));
        }
        let id = format!("w_{}", random_hex(8));
        let token = random_hex(32);
        let now = now_ms();
        sqlx::query("INSERT INTO workers (id, token_hash, payout_addr, payout_pkh, kernel_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(hex::encode(sha256(token.as_bytes())))
            .bind(payout_addr)
            .bind(hex::encode(pkh))
            .bind(kernel_hash)
            .bind(now)
            .bind(now)
            .execute(&self.db)
            .await?;
        Ok(WorkerSession { worker_id: id, token })
    }

    pub async fn auth_worker(&self, token: &str) -> R<Worker> {
        let row = sqlx::query("SELECT id, payout_addr, payout_pkh FROM workers WHERE token_hash = ?").bind(hex::encode(sha256(token.as_bytes()))).fetch_optional(&self.db).await?;
        let r = row.ok_or(AppError::Unauthorized)?;
        let w = Worker { id: r.get("id"), payout_addr: r.get("payout_addr"), payout_pkh: r.get("payout_pkh") };
        sqlx::query("UPDATE workers SET last_seen = ? WHERE id = ?").bind(now_ms()).bind(&w.id).execute(&self.db).await?;
        Ok(w)
    }

    pub async fn worker_view(&self, w: &Worker) -> R<WorkerView> {
        let r = sqlx::query("SELECT * FROM workers WHERE id = ?").bind(&w.id).fetch_one(&self.db).await?;
        let lease: Option<String> = sqlx::query("SELECT id FROM assignments WHERE worker_id = ? AND status = 'active' AND deadline >= ?")
            .bind(&w.id)
            .bind(now_ms())
            .fetch_optional(&self.db)
            .await?
            .map(|r| r.get("id"));
        Ok(WorkerView {
            worker_id: r.get("id"),
            payout_addr: r.get("payout_addr"),
            kernel_hash: r.get("kernel_hash"),
            verified: r.get("verified"),
            mismatched: r.get("mismatched"),
            earned_sats: r.get("earned_sats"),
            active_lease: lease,
        })
    }

    // ------------------------------------------------------------ scheduling

    async fn lease_view(&self, assignment_id: &str) -> R<Lease> {
        let r = sqlx::query("SELECT a.id, a.idx, a.deadline, j.* FROM assignments a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?").bind(assignment_id).fetch_one(&self.db).await?;
        let job = JobRow::from_row(&r);
        Ok(Lease {
            assignment_id: assignment_id.to_string(),
            job_id: job.id.clone(),
            index: r.get::<i64, _>("idx") as u32,
            master_seed: job.master_seed.clone(),
            params: job.params.clone(),
            trials: job.trials_per_chunk as u32,
            deadline: r.get("deadline"),
        })
    }

    /// Leases the next chunk to `w`, or None if there is no work for this worker.
    /// Rules: one active lease per worker; each chunk attempt goes to 2 different workers with
    /// different payout addresses; a worker never gets a chunk it already worked on.
    pub async fn next_work(&self, w: &Worker) -> R<Option<Lease>> {
        let _g = self.lock.lock().await;
        let now = now_ms();
        sqlx::query("UPDATE assignments SET status = 'expired' WHERE status = 'active' AND deadline < ?").bind(now).execute(&self.db).await?;

        if let Some(r) = sqlx::query("SELECT id FROM assignments WHERE worker_id = ? AND status = 'active'").bind(&w.id).fetch_optional(&self.db).await? {
            let id: String = r.get("id");
            drop(_g);
            return self.lease_view(&id).await.map(Some);
        }

        let candidates = sqlx::query(
            "SELECT c.job_id, c.idx, c.attempt FROM chunks c JOIN jobs j ON j.id = c.job_id
             WHERE j.status = 'running' AND c.status = 'pending'
               AND (SELECT COUNT(*) FROM assignments a WHERE a.job_id = c.job_id AND a.idx = c.idx AND a.attempt = c.attempt
                    AND a.status IN ('active', 'submitted')) < 2
               AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = c.job_id AND a.idx = c.idx
                    AND a.status != 'expired' AND (a.worker_id = ? OR a.payout_pkh = ?))
             ORDER BY j.created_at, c.idx LIMIT 1",
        )
        .bind(&w.id)
        .bind(&w.payout_pkh)
        .fetch_optional(&self.db)
        .await?;
        let Some(c) = candidates else { return Ok(None) };

        let id = format!("a_{}", random_hex(12));
        let deadline = now + self.settings.lease_ms;
        sqlx::query("INSERT INTO assignments (id, job_id, idx, attempt, worker_id, payout_pkh, status, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)")
            .bind(&id)
            .bind(c.get::<String, _>("job_id"))
            .bind(c.get::<i64, _>("idx"))
            .bind(c.get::<i64, _>("attempt"))
            .bind(&w.id)
            .bind(&w.payout_pkh)
            .bind(deadline)
            .bind(now)
            .execute(&self.db)
            .await?;
        drop(_g);
        self.lease_view(&id).await.map(Some)
    }

    // ------------------------------------------------------------ verification

    pub async fn submit_result(&self, w: &Worker, assignment_id: &str, hash: &str, summary: Summary) -> R<SubmitOutcome> {
        let _g = self.lock.lock().await;
        let a = sqlx::query("SELECT * FROM assignments WHERE id = ?").bind(assignment_id).fetch_optional(&self.db).await?.ok_or(AppError::NotFound("assignment"))?;
        if a.get::<String, _>("worker_id") != w.id {
            return Err(AppError::Forbidden("not your assignment".into()));
        }
        match a.get::<String, _>("status").as_str() {
            "active" => {}
            "submitted" => return Err(AppError::Conflict("result already submitted".into())),
            _ => return Err(AppError::LeaseExpired),
        }
        let now = now_ms();
        if a.get::<i64, _>("deadline") < now {
            sqlx::query("UPDATE assignments SET status = 'expired' WHERE id = ?").bind(assignment_id).execute(&self.db).await?;
            return Err(AppError::LeaseExpired);
        }
        let job_id: String = a.get("job_id");
        let idx: i64 = a.get("idx");
        let attempt: i64 = a.get("attempt");
        let job = self.job(&job_id).await?;

        // The summary must reproduce the hash, so aggregated results are as trustworthy as the hash.
        if summary.histogram.len() != HIST_BINS {
            return Err(bad(format!("histogram must have {HIST_BINS} bins")));
        }
        let total = summary.transmitted as u64 + summary.reflected as u64 + summary.absorbed as u64;
        if total != job.trials_per_chunk as u64 {
            return Err(bad("counts must sum to trials"));
        }
        let hash = hash.to_ascii_lowercase();
        let claimed = hex32(&hash)?;
        if summary.chunk_hash(&job.job_id(), idx as u32) != claimed {
            return Err(bad("hash does not match summary"));
        }

        sqlx::query("UPDATE assignments SET status = 'submitted' WHERE id = ?").bind(assignment_id).execute(&self.db).await?;
        sqlx::query("INSERT INTO results (assignment_id, job_id, idx, attempt, worker_id, payout_pkh, hash, summary, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(assignment_id)
            .bind(&job_id)
            .bind(idx)
            .bind(attempt)
            .bind(&w.id)
            .bind(&w.payout_pkh)
            .bind(&hash)
            .bind(serde_json::to_string(&summary).unwrap())
            .bind(now)
            .execute(&self.db)
            .await?;

        let results = sqlx::query("SELECT * FROM results WHERE job_id = ? AND idx = ? AND attempt = ? AND outcome = 'pending' ORDER BY submitted_at, rowid")
            .bind(&job_id)
            .bind(idx)
            .bind(attempt)
            .fetch_all(&self.db)
            .await?;
        if results.len() < 2 {
            return Ok(SubmitOutcome::Accepted);
        }
        let (r1, r2) = (&results[0], &results[1]);
        let (h1, h2): (String, String) = (r1.get("hash"), r2.get("hash"));
        let (w1, w2): (String, String) = (r1.get("worker_id"), r2.get("worker_id"));

        if h1 == h2 {
            sqlx::query("UPDATE results SET outcome = 'matched' WHERE job_id = ? AND idx = ? AND attempt = ?").bind(&job_id).bind(idx).bind(attempt).execute(&self.db).await?;
            sqlx::query("UPDATE workers SET verified = verified + 1 WHERE id IN (?, ?)").bind(&w1).bind(&w2).execute(&self.db).await?;
            let summary: String = r1.get("summary");
            self.verify_chunk(&job, idx, &h1, &summary, "workers", Payee::Worker(w1, r1.get("payout_pkh")), Payee::Worker(w2, r2.get("payout_pkh"))).await?;
            return Ok(SubmitOutcome::Verified);
        }

        // Mismatch: discard both, penalize both, reassign (or resolve after max attempts).
        tracing::warn!(job = %job_id, idx, attempt, "result mismatch");
        sqlx::query("UPDATE results SET outcome = 'mismatched' WHERE job_id = ? AND idx = ? AND attempt = ?").bind(&job_id).bind(idx).bind(attempt).execute(&self.db).await?;
        sqlx::query("UPDATE assignments SET status = 'discarded' WHERE job_id = ? AND idx = ? AND attempt = ?").bind(&job_id).bind(idx).bind(attempt).execute(&self.db).await?;
        sqlx::query("UPDATE workers SET mismatched = mismatched + 1 WHERE id IN (?, ?)").bind(&w1).bind(&w2).execute(&self.db).await?;
        sqlx::query("UPDATE chunks SET attempt = attempt + 1 WHERE job_id = ? AND idx = ?").bind(&job_id).bind(idx).execute(&self.db).await?;
        if attempt + 1 >= self.settings.max_attempts {
            self.resolve_by_coordinator(&job, idx).await?;
        }
        Ok(SubmitOutcome::Mismatch)
    }

    /// After too many mismatches the coordinator computes the chunk itself and pays the
    /// (distinct-address) workers whose submissions match. The contract needs two different
    /// payees: with one match, the coordinator's fee wallet takes the second share.
    async fn resolve_by_coordinator(&self, job: &JobRow, idx: i64) -> R<()> {
        let (params, job_id, seed, trials) = (job.kernel_params(), job.job_id(), hex::decode(&job.master_seed).unwrap(), job.trials_per_chunk as u32);
        let r = tokio::task::spawn_blocking(move || nova_kernel::run_chunk(params, job_id, &seed, idx as u32, trials)).await.map_err(|e| AppError::Internal(e.to_string()))?;
        let summary = Summary { transmitted: r.transmitted, reflected: r.reflected, absorbed: r.absorbed, histogram: r.histogram.clone() };
        tracing::warn!(job = %job.id, idx, hash = %r.hash, "chunk resolved by coordinator");

        let matching = sqlx::query("SELECT worker_id, payout_pkh FROM results WHERE job_id = ? AND idx = ? AND hash = ? ORDER BY submitted_at, rowid")
            .bind(&job.id)
            .bind(idx)
            .bind(&r.hash)
            .fetch_all(&self.db)
            .await?;
        let mut payees: Vec<(String, String)> = Vec::new();
        for m in &matching {
            let pkh: String = m.get("payout_pkh");
            if !payees.iter().any(|(_, p)| *p == pkh) {
                payees.push((m.get("worker_id"), pkh));
            }
        }
        sqlx::query("UPDATE results SET outcome = 'coordinator_matched' WHERE job_id = ? AND idx = ? AND hash = ?").bind(&job.id).bind(idx).bind(&r.hash).execute(&self.db).await?;
        let summary_json = serde_json::to_string(&summary).unwrap();
        let fee_pkh = hex::encode(self.settings.fee.pkh());
        match payees.len() {
            0 => {
                sqlx::query("UPDATE chunks SET status = 'unpaid', verified_hash = ?, verified_summary = ?, resolved_by = 'coordinator' WHERE job_id = ? AND idx = ?")
                    .bind(&r.hash)
                    .bind(&summary_json)
                    .bind(&job.id)
                    .bind(idx)
                    .execute(&self.db)
                    .await?;
                self.wake.notify_one();
                Ok(())
            }
            1 => {
                let (wid, pkh) = payees.remove(0);
                self.verify_chunk(job, idx, &r.hash, &summary_json, "coordinator", Payee::Worker(wid, pkh), Payee::Coordinator(fee_pkh)).await
            }
            _ => {
                let (a, b) = (payees.remove(0), payees.remove(0));
                self.verify_chunk(job, idx, &r.hash, &summary_json, "coordinator", Payee::Worker(a.0, a.1), Payee::Worker(b.0, b.1)).await
            }
        }
    }

    /// Marks a chunk verified, signs the attestation, builds + self-checks the payout tx, queues it.
    #[allow(clippy::too_many_arguments)]
    async fn verify_chunk(&self, job: &JobRow, idx: i64, hash: &str, summary_json: &str, resolved_by: &str, a: Payee, b: Payee) -> R<()> {
        let chunk = sqlx::query("SELECT outpoint_txid, outpoint_vout, value FROM chunks WHERE job_id = ? AND idx = ?").bind(&job.id).bind(idx).fetch_one(&self.db).await?;
        let outpoint = OutPoint::from_txid_hex(&chunk.get::<String, _>("outpoint_txid"), chunk.get::<i64, _>("outpoint_vout") as u32).map_err(|e| AppError::Internal(e.to_string()))?;
        let value = chunk.get::<i64, _>("value") as u64;
        let escrow = self.escrow_for(job)?;
        let (pkh_a, pkh_b) = (hex20(a.pkh())?, hex20(b.pkh())?);
        let result_hash = hex32(hash)?;

        let sig = sign_payout(&self.settings.oracle, &escrow.params.job_id, &outpoint, &pkh_a, &pkh_b, &result_hash);
        let msg = payout_message(&escrow.params.job_id, &outpoint, &pkh_a, &pkh_b, &result_hash);
        let tx = build_payout_tx(&escrow, &[PayoutItem { outpoint, value, attestation: sig, worker_a: pkh_a, worker_b: pkh_b, result_hash }]).map_err(|e| AppError::Internal(e.to_string()))?;
        check_payout_tx(&escrow, &tx, &[value]).map_err(|e| AppError::Internal(format!("payout failed self-check: {e}")))?;

        let now = now_ms();
        let mut dbtx = self.db.begin().await?;
        sqlx::query("UPDATE chunks SET status = 'paying', verified_hash = ?, verified_summary = ?, resolved_by = ? WHERE job_id = ? AND idx = ? AND status = 'pending'")
            .bind(hash)
            .bind(summary_json)
            .bind(resolved_by)
            .bind(&job.id)
            .bind(idx)
            .execute(&mut *dbtx)
            .await?;
        sqlx::query("INSERT INTO attestations (job_id, idx, worker_a_pkh, worker_b_pkh, result_hash, message, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&job.id)
            .bind(idx)
            .bind(a.pkh())
            .bind(b.pkh())
            .bind(hash)
            .bind(hex::encode(msg))
            .bind(hex::encode(sig))
            .bind(now)
            .execute(&mut *dbtx)
            .await?;
        // PRIMARY KEY (job_id, idx): a chunk can only ever have one payout tx.
        sqlx::query("INSERT INTO payouts (job_id, idx, worker_a_id, worker_b_id, tx_hex, txid, status, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)")
            .bind(&job.id)
            .bind(idx)
            .bind(a.worker_id())
            .bind(b.worker_id())
            .bind(tx.to_hex())
            .bind(tx.txid_hex())
            .bind(now)
            .execute(&mut *dbtx)
            .await?;
        dbtx.commit().await?;
        self.wake.notify_one();
        Ok(())
    }

    // ------------------------------------------------------------ payouts & finalization

    /// Broadcasts due payouts. Only the stored tx for a chunk is ever broadcast, so a chunk
    /// UTXO can't be double-spent; failures back off exponentially (1 s … 60 s).
    pub async fn process_payouts_once(&self) -> R<usize> {
        let _g = self.lock.lock().await;
        let due = sqlx::query("SELECT p.*, j.price_per_worker FROM payouts p JOIN jobs j ON j.id = p.job_id WHERE p.status = 'queued' AND p.next_attempt_at <= ? ORDER BY p.next_attempt_at")
            .bind(now_ms())
            .fetch_all(&self.db)
            .await?;
        let mut sent = 0;
        for p in due {
            let (job_id, idx, txid, hex_tx): (String, i64, String, String) = (p.get("job_id"), p.get("idx"), p.get("txid"), p.get("tx_hex"));
            let attempts: i64 = p.get("attempts");
            let outcome = match self.chain.broadcast(&hex_tx).await {
                Ok(got) if got == txid => Ok(()),
                Ok(got) => Err(format!("server returned txid {got}, expected {txid}")),
                Err(e) => {
                    // A previous attempt may have reached the network before a disconnect.
                    if self.chain.get_transaction(&txid).await.is_ok() { Ok(()) } else { Err(e.to_string()) }
                }
            };
            match outcome {
                Ok(()) => {
                    let price: i64 = p.get("price_per_worker");
                    sqlx::query("UPDATE payouts SET status = 'broadcast', broadcast_at = ?, attempts = attempts + 1, last_error = NULL WHERE job_id = ? AND idx = ?").bind(now_ms()).bind(&job_id).bind(idx).execute(&self.db).await?;
                    sqlx::query("UPDATE chunks SET status = 'paid' WHERE job_id = ? AND idx = ?").bind(&job_id).bind(idx).execute(&self.db).await?;
                    for wid in [p.get::<Option<String>, _>("worker_a_id"), p.get::<Option<String>, _>("worker_b_id")].into_iter().flatten() {
                        sqlx::query("UPDATE workers SET earned_sats = earned_sats + ? WHERE id = ?").bind(price).bind(&wid).execute(&self.db).await?;
                    }
                    tracing::info!(job = %job_id, idx, %txid, "payout broadcast");
                    sent += 1;
                }
                Err(err) => {
                    let backoff = (1000i64 << attempts.min(6)).min(60_000);
                    let status = if attempts + 1 >= 50 { "failed" } else { "queued" };
                    tracing::warn!(job = %job_id, idx, %err, attempts = attempts + 1, "payout broadcast failed");
                    sqlx::query("UPDATE payouts SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, status = ? WHERE job_id = ? AND idx = ?")
                        .bind(&err)
                        .bind(now_ms() + backoff)
                        .bind(status)
                        .bind(&job_id)
                        .bind(idx)
                        .execute(&self.db)
                        .await?;
                }
            }
        }
        Ok(sent)
    }

    /// For running jobs whose chunks are all paid/unpaid: broadcast the Merkle-root OP_RETURN
    /// from the fee wallet and mark the job complete. Returns the OP_RETURN txids.
    pub async fn finalize_ready_jobs(&self) -> R<Vec<String>> {
        let _g = self.lock.lock().await;
        let jobs = sqlx::query(
            "SELECT * FROM jobs j WHERE j.status IN ('running', 'finalizing')
               AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.job_id = j.id AND c.status NOT IN ('paid', 'unpaid'))",
        )
        .fetch_all(&self.db)
        .await?;
        let mut done = Vec::new();
        for r in jobs {
            let job = JobRow::from_row(&r);
            match self.finalize(&job).await {
                Ok(txid) => done.push(txid),
                Err(e) => {
                    tracing::warn!(job = %job.id, error = %e, "finalize failed; will retry");
                    sqlx::query("UPDATE jobs SET status = 'finalizing', last_error = ?, updated_at = ? WHERE id = ?").bind(e.to_string()).bind(now_ms()).bind(&job.id).execute(&self.db).await?;
                }
            }
        }
        Ok(done)
    }

    async fn finalize(&self, job: &JobRow) -> R<String> {
        let leaves: Vec<[u8; 32]> = sqlx::query("SELECT verified_hash FROM chunks WHERE job_id = ? ORDER BY idx")
            .bind(&job.id)
            .fetch_all(&self.db)
            .await?
            .iter()
            .map(|r| hex32(&r.get::<String, _>("verified_hash")))
            .collect::<R<_>>()?;
        let root = merkle_root(&leaves).ok_or_else(|| AppError::Internal("no leaves".into()))?;

        let fee_script = self.settings.fee.p2pkh_script();
        let utxos: Vec<Utxo> = self
            .chain
            .list_unspent(&electrum_scripthash(&fee_script))
            .await?
            .into_iter()
            .map(|u| OutPoint::from_txid_hex(&u.tx_hash, u.tx_pos).map(|o| Utxo { outpoint: o, value: u.value }))
            .collect::<Result<_, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if utxos.is_empty() {
            return Err(AppError::Chain(format!("fee wallet {} is empty", self.settings.fee.address(self.settings.network))));
        }
        let tx = build_signed(&self.settings.fee, &utxos, vec![TxOut { value: 0, locking_bytecode: op_return_script(&job.job_id(), &root) }], self.settings.fee_rate)
            .map_err(|e| AppError::Chain(e.to_string()))?;
        let txid = self.chain.broadcast(&tx.to_hex()).await?;
        sqlx::query("UPDATE jobs SET status = 'complete', merkle_root = ?, op_return_txid = ?, last_error = NULL, updated_at = ? WHERE id = ?")
            .bind(hex::encode(root))
            .bind(&txid)
            .bind(now_ms())
            .bind(&job.id)
            .execute(&self.db)
            .await?;
        tracing::info!(job = %job.id, %txid, root = %hex::encode(root), "job complete");
        Ok(txid)
    }
}

enum Payee {
    Worker(String, String), // (worker_id, payout_pkh hex)
    Coordinator(String),    // fee wallet pkh hex
}

impl Payee {
    fn pkh(&self) -> &str {
        match self {
            Payee::Worker(_, p) | Payee::Coordinator(p) => p,
        }
    }
    fn worker_id(&self) -> Option<&str> {
        match self {
            Payee::Worker(id, _) => Some(id),
            Payee::Coordinator(_) => None,
        }
    }
}

/// Background task: broadcasts payouts and finalizes jobs. Wakes on new payouts or every 2 s.
pub async fn run_background(c: Arc<Coordinator>) {
    loop {
        tokio::select! {
            _ = c.wake.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        if let Err(e) = c.process_payouts_once().await {
            tracing::error!(error = %e, "payout loop");
        }
        if let Err(e) = c.finalize_ready_jobs().await {
            tracing::error!(error = %e, "finalize loop");
        }
    }
}

/// Opens (creating if needed) the SQLite database and runs migrations.
pub async fn connect_db(url: &str) -> Result<SqlitePool, sqlx::Error> {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
    use std::str::FromStr;
    let memory = url.contains(":memory:");
    let opts = SqliteConnectOptions::from_str(url)?.create_if_missing(true).foreign_keys(true).journal_mode(if memory { SqliteJournalMode::Memory } else { SqliteJournalMode::Wal });
    // An in-memory DB exists per connection, so use a single connection for it.
    let pool = SqlitePoolOptions::new().max_connections(if memory { 1 } else { 5 }).connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}
