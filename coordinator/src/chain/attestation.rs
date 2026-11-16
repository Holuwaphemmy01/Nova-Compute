//! Oracle attestations checked by NovaEscrow via OP_CHECKDATASIG.
//!
//! payout: jobId(32) ‖ outpointTxHash(32, internal order = reversed txid) ‖ outpointIndex(u32 LE)
//!         ‖ workerA_pkh(20) ‖ workerB_pkh(20) ‖ resultHash(32)        (140 bytes)
//! close:  jobId(32) ‖ "close"

use super::{keys::PrivateKey, schnorr, tx::OutPoint};

pub fn payout_message(job_id: &[u8; 32], outpoint: &OutPoint, worker_a: &[u8; 20], worker_b: &[u8; 20], result_hash: &[u8; 32]) -> [u8; 140] {
    let mut m = [0u8; 140];
    m[..32].copy_from_slice(job_id);
    m[32..64].copy_from_slice(&outpoint.internal_hash());
    m[64..68].copy_from_slice(&outpoint.vout.to_le_bytes());
    m[68..88].copy_from_slice(worker_a);
    m[88..108].copy_from_slice(worker_b);
    m[108..].copy_from_slice(result_hash);
    m
}

pub fn close_message(job_id: &[u8; 32]) -> Vec<u8> {
    let mut m = job_id.to_vec();
    m.extend_from_slice(b"close");
    m
}

pub fn sign_payout(oracle: &PrivateKey, job_id: &[u8; 32], outpoint: &OutPoint, worker_a: &[u8; 20], worker_b: &[u8; 20], result_hash: &[u8; 32]) -> [u8; 64] {
    schnorr::sign_data(oracle, &payout_message(job_id, outpoint, worker_a, worker_b, result_hash))
}

pub fn sign_close(oracle: &PrivateKey, job_id: &[u8; 32]) -> [u8; 64] {
    schnorr::sign_data(oracle, &close_message(job_id))
}
