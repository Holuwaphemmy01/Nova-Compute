//! The coordinator's small P2PKH fee wallet: builds and signs transactions (OP_RETURN, funding).

use super::{
    ChainError,
    keys::PrivateKey,
    payout::DEFAULT_SEQUENCE,
    sighash::{PrevOut, sign_p2pkh_inputs},
    tx::{OutPoint, Transaction, TxIn, TxOut},
};

pub const DUST: u64 = 546;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Utxo {
    pub outpoint: OutPoint,
    pub value: u64,
}

/// Builds a signed tx spending `utxos` (all P2PKH of `key`) to `outputs`, with change back to
/// `key` if above dust. Fee = `fee_rate` sat/byte of the final signed size (rounded up).
pub fn build_signed(key: &PrivateKey, utxos: &[Utxo], outputs: Vec<TxOut>, fee_rate: u64) -> Result<Transaction, ChainError> {
    if utxos.is_empty() {
        return Err(ChainError::InvalidArgument("no inputs"));
    }
    let total_in: u64 = utxos.iter().map(|u| u.value).sum();
    let total_out: u64 = outputs.iter().map(|o| o.value).sum();
    let script = key.p2pkh_script();
    let prevouts: Vec<PrevOut> = utxos.iter().map(|u| PrevOut { value: u.value, locking_bytecode: script.clone() }).collect();

    let make = |change: Option<u64>| -> Result<Transaction, ChainError> {
        let mut outs = outputs.clone();
        if let Some(c) = change {
            outs.push(TxOut { value: c, locking_bytecode: script.clone() });
        }
        let mut tx = Transaction {
            version: 2,
            inputs: utxos.iter().map(|u| TxIn { outpoint: u.outpoint.clone(), unlocking_bytecode: Vec::new(), sequence: DEFAULT_SEQUENCE }).collect(),
            outputs: outs,
            locktime: 0,
        };
        sign_p2pkh_inputs(&mut tx, key, &prevouts)?;
        Ok(tx)
    };

    // DER signatures vary by a byte or two; pad the estimate so the final rate stays >= fee_rate.
    let pad = 2 * utxos.len() as u64;
    let with_change = make(Some(0))?;
    let fee = (with_change.serialize().len() as u64 + pad) * fee_rate;
    if total_in >= total_out + fee + DUST {
        return make(Some(total_in - total_out - fee));
    }
    let without = make(None)?;
    let fee = (without.serialize().len() as u64 + pad) * fee_rate;
    if total_in < total_out + fee {
        return Err(ChainError::InvalidArgument("insufficient funds in fee wallet"));
    }
    Ok(without)
}
