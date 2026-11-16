use ripemd::Ripemd160;
use sha2::{Digest, Sha256};

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// Double SHA-256 (used for txids, sighash, OP_HASH256).
pub fn sha256d(data: &[u8]) -> [u8; 32] {
    sha256(&sha256(data))
}

/// RIPEMD-160(SHA-256(data)), i.e. OP_HASH160.
pub fn hash160(data: &[u8]) -> [u8; 20] {
    Ripemd160::digest(sha256(data)).into()
}

/// Reverses a 32-byte hash (internal byte order ↔ display order).
pub fn reversed(h: [u8; 32]) -> [u8; 32] {
    let mut r = h;
    r.reverse();
    r
}
