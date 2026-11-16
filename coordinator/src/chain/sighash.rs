//! BCH transaction signing for the coordinator's own P2PKH fee wallet:
//! BIP143-style digest with SIGHASH_ALL | SIGHASH_FORKID (0x41), ECDSA low-S DER signatures.

use k256::ecdsa::{Signature, SigningKey, signature::hazmat::PrehashSigner};

use super::{
    ChainError,
    hash::sha256d,
    keys::PrivateKey,
    script::push_data,
    tx::{Transaction, write_bytes},
};

pub const SIGHASH_ALL_FORKID: u32 = 0x41;

/// The output being spent by an input (needed for the BCH sighash).
#[derive(Clone, Debug)]
pub struct PrevOut {
    pub value: u64,
    pub locking_bytecode: Vec<u8>,
}

/// BIP143 / BCH replay-protected sighash for `input`, SIGHASH_ALL | FORKID.
pub fn sighash_all(tx: &Transaction, input: usize, script_code: &[u8], value: u64) -> [u8; 32] {
    let mut prevouts = Vec::new();
    let mut sequences = Vec::new();
    for i in &tx.inputs {
        prevouts.extend_from_slice(&i.outpoint.internal_hash());
        prevouts.extend_from_slice(&i.outpoint.vout.to_le_bytes());
        sequences.extend_from_slice(&i.sequence.to_le_bytes());
    }
    let mut outputs = Vec::new();
    for o in &tx.outputs {
        o.serialize_into(&mut outputs);
    }

    let this = &tx.inputs[input];
    let mut pre = Vec::new();
    pre.extend_from_slice(&tx.version.to_le_bytes());
    pre.extend_from_slice(&sha256d(&prevouts));
    pre.extend_from_slice(&sha256d(&sequences));
    pre.extend_from_slice(&this.outpoint.internal_hash());
    pre.extend_from_slice(&this.outpoint.vout.to_le_bytes());
    write_bytes(&mut pre, script_code);
    pre.extend_from_slice(&value.to_le_bytes());
    pre.extend_from_slice(&this.sequence.to_le_bytes());
    pre.extend_from_slice(&sha256d(&outputs));
    pre.extend_from_slice(&tx.locktime.to_le_bytes());
    pre.extend_from_slice(&SIGHASH_ALL_FORKID.to_le_bytes());
    sha256d(&pre)
}

/// Signs every input of `tx` as P2PKH spends of `key` (all inputs must belong to `key`).
pub fn sign_p2pkh_inputs(tx: &mut Transaction, key: &PrivateKey, prevouts: &[PrevOut]) -> Result<(), ChainError> {
    if prevouts.len() != tx.inputs.len() {
        return Err(ChainError::InvalidArgument("one prevout per input required"));
    }
    let script_code = key.p2pkh_script();
    let signer = SigningKey::from(key.secret());
    let pubkey = key.pubkey();
    for (i, prev) in prevouts.iter().enumerate() {
        if prev.locking_bytecode != script_code {
            return Err(ChainError::InvalidArgument("prevout is not P2PKH of the signing key"));
        }
        let digest = sighash_all(tx, i, &script_code, prev.value);
        let sig: Signature = signer.sign_prehash(&digest).map_err(|_| ChainError::InvalidKey("signing failed"))?;
        let sig = sig.normalize_s().unwrap_or(sig);
        let mut sig_bytes = sig.to_der().as_bytes().to_vec();
        sig_bytes.push(SIGHASH_ALL_FORKID as u8);
        let mut unlocking = Vec::new();
        push_data(&mut unlocking, &sig_bytes);
        push_data(&mut unlocking, &pubkey);
        tx.inputs[i].unlocking_bytecode = unlocking;
    }
    Ok(())
}
