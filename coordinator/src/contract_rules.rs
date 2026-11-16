//! Re-checks a payout transaction against NovaEscrow.payout's rules in Rust, before it is ever
//! broadcast (and in tests). Mirrors the contract: for input i spending a chunk UTXO,
//!   workerA != workerB
//!   checkDataSig(attestation, jobId ‖ outpoint(i) ‖ workerA ‖ workerB ‖ resultHash, oraclePk)
//!   outputs[2i]   = P2PKH(workerA), value >= price
//!   outputs[2i+1] = P2PKH(workerB), value >= price
//! plus: the unlocking bytecode is exactly what CashScript would produce for that call, and the
//! redeem script hashes to the escrow's locking bytecode.

use crate::chain::{
    attestation::payout_message,
    contract::Escrow,
    payout::{PayoutItem, payout_unlocking_bytecode},
    schnorr,
    script::p2pkh,
    tx::Transaction,
};

/// Parses the payout args back out of an unlocking bytecode built by `payout_unlocking_bytecode`.
fn parse_payout_args(unlocking: &[u8]) -> Option<([u8; 32], [u8; 20], [u8; 20], [u8; 64])> {
    let mut i = 0;
    let mut take = |n: usize| -> Option<&[u8]> {
        if unlocking.get(i)? != &(n as u8) {
            return None;
        }
        let s = unlocking.get(i + 1..i + 1 + n)?;
        i += 1 + n;
        Some(s)
    };
    let result_hash = take(32)?.try_into().ok()?;
    let worker_b = take(20)?.try_into().ok()?;
    let worker_a = take(20)?.try_into().ok()?;
    let sig = take(64)?.try_into().ok()?;
    Some((result_hash, worker_b, worker_a, sig))
}

/// Returns Ok if every input of `tx` is a valid NovaEscrow payout for `escrow`.
/// `input_values[i]` is the value of the UTXO spent by input i.
pub fn check_payout_tx(escrow: &Escrow, tx: &Transaction, input_values: &[u64]) -> Result<(), String> {
    if tx.inputs.is_empty() || input_values.len() != tx.inputs.len() {
        return Err("input values must match inputs".into());
    }
    let price = escrow.params.price_per_worker;
    for (i, input) in tx.inputs.iter().enumerate() {
        let (result_hash, worker_b, worker_a, sig) = parse_payout_args(&input.unlocking_bytecode).ok_or(format!("input {i}: not a payout unlocking bytecode"))?;
        let item = PayoutItem { outpoint: input.outpoint.clone(), value: input_values[i], attestation: sig, worker_a, worker_b, result_hash };
        if payout_unlocking_bytecode(escrow, &item) != input.unlocking_bytecode {
            return Err(format!("input {i}: unlocking bytecode differs from CashScript's encoding"));
        }
        if worker_a == worker_b {
            return Err(format!("input {i}: workers must differ"));
        }
        let msg = payout_message(&escrow.params.job_id, &input.outpoint, &worker_a, &worker_b, &result_hash);
        if !schnorr::verify_data(&escrow.params.oracle_pk, &msg, &sig) {
            return Err(format!("input {i}: bad attestation"));
        }
        let (a, b) = (tx.outputs.get(2 * i).ok_or(format!("input {i}: missing output A"))?, tx.outputs.get(2 * i + 1).ok_or(format!("input {i}: missing output B"))?);
        if a.locking_bytecode != p2pkh(&worker_a) || a.value < price {
            return Err(format!("input {i}: output A must pay workerA >= price"));
        }
        if b.locking_bytecode != p2pkh(&worker_b) || b.value < price {
            return Err(format!("input {i}: output B must pay workerB >= price"));
        }
    }
    let total_in: u64 = input_values.iter().sum();
    let total_out: u64 = tx.outputs.iter().map(|o| o.value).sum();
    if total_out > total_in {
        return Err("outputs exceed inputs".into());
    }
    if total_in - total_out < tx.serialize().len() as u64 {
        return Err("fee below 1 sat/byte".into());
    }
    Ok(())
}
