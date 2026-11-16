//! NovaEscrow.payout transactions. No wallet signature is needed: each chunk input carries the
//! oracle attestation; the input's leftover value (the fee margin) is the miner fee.

use super::{
    ChainError,
    contract::Escrow,
    script::{p2pkh, push_data, script_num},
    tx::{OutPoint, Transaction, TxIn, TxOut},
};

/// CashScript's default input sequence (non-final, enables locktime checks).
pub const DEFAULT_SEQUENCE: u32 = 0xffff_fffe;

#[derive(Clone, Debug)]
pub struct PayoutItem {
    pub outpoint: OutPoint,
    pub value: u64,
    pub attestation: [u8; 64],
    pub worker_a: [u8; 20],
    pub worker_b: [u8; 20],
    pub result_hash: [u8; 32],
}

/// Unlocking bytecode for `payout(attestation, workerA, workerB, resultHash)`:
/// args pushed in reverse order, then the function selector, then the redeem script.
pub fn payout_unlocking_bytecode(escrow: &Escrow, item: &PayoutItem) -> Vec<u8> {
    let mut u = Vec::new();
    push_data(&mut u, &item.result_hash);
    push_data(&mut u, &item.worker_b);
    push_data(&mut u, &item.worker_a);
    push_data(&mut u, &item.attestation);
    push_data(&mut u, &script_num(escrow.payout_selector));
    push_data(&mut u, &escrow.redeem_script);
    u
}

/// Builds a payout tx. Item i spends input i and pays outputs 2i (workerA) and 2i+1 (workerB),
/// each exactly `price_per_worker`; no change output.
pub fn build_payout_tx(escrow: &Escrow, items: &[PayoutItem]) -> Result<Transaction, ChainError> {
    if items.is_empty() {
        return Err(ChainError::InvalidArgument("no payout items"));
    }
    let price = escrow.params.price_per_worker;
    let mut tx = Transaction { version: 2, inputs: Vec::new(), outputs: Vec::new(), locktime: 0 };
    for item in items {
        if item.worker_a == item.worker_b {
            return Err(ChainError::InvalidArgument("workers must differ"));
        }
        if item.value < 2 * price {
            return Err(ChainError::InvalidArgument("chunk UTXO value below 2 × price"));
        }
        tx.inputs.push(TxIn { outpoint: item.outpoint.clone(), unlocking_bytecode: payout_unlocking_bytecode(escrow, item), sequence: DEFAULT_SEQUENCE });
        tx.outputs.push(TxOut { value: price, locking_bytecode: p2pkh(&item.worker_a) });
        tx.outputs.push(TxOut { value: price, locking_bytecode: p2pkh(&item.worker_b) });
    }
    Ok(tx)
}
