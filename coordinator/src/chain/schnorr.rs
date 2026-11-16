//! BCH Schnorr signatures (Bitcoin Cash 2019-05-15 upgrade spec). NOT BIP-340:
//!
//! * challenge `e = sha256(R.x ‖ compressed(P) ‖ m) mod n` (33-byte compressed pubkey)
//! * the nonce point R must have a y coordinate that is a quadratic residue (jacobi = 1)
//! * signature = `R.x (32) ‖ s (32)`
//!
//! For OP_CHECKDATASIG the signed `m` is `sha256(message)`.
//!
//! The nonce is derived like Bitcoin ABC's libsecp256k1 (which libauth compiles to WASM):
//! RFC 6979 HMAC-DRBG keyed with `seckey ‖ m ‖ "Schnorr+SHA256  "`, so signatures are
//! deterministic and equal libauth's byte for byte.

use hmac::{Hmac, Mac};
use k256::{
    AffinePoint, FieldBytes, FieldElement, ProjectivePoint, PublicKey, Scalar, U256,
    elliptic_curve::{PrimeField, ops::Reduce, point::AffineCoordinates, sec1::ToEncodedPoint},
};
use sha2::{Digest, Sha256};

use super::{hash::sha256, keys::PrivateKey};

const ALGO16: &[u8; 16] = b"Schnorr+SHA256  ";

type HmacSha256 = Hmac<Sha256>;

fn hmac(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut m = HmacSha256::new_from_slice(key).expect("hmac accepts any key length");
    for p in parts {
        m.update(p);
    }
    m.finalize().into_bytes().into()
}

/// libsecp256k1's `secp256k1_rfc6979_hmac_sha256` generator.
struct Rfc6979 {
    k: [u8; 32],
    v: [u8; 32],
    retry: bool,
}

impl Rfc6979 {
    fn new(seed: &[u8]) -> Self {
        let mut k = [0u8; 32];
        let mut v = [1u8; 32];
        k = hmac(&k, &[&v, &[0x00], seed]);
        v = hmac(&k, &[&v]);
        k = hmac(&k, &[&v, &[0x01], seed]);
        v = hmac(&k, &[&v]);
        Self { k, v, retry: false }
    }

    fn generate(&mut self) -> [u8; 32] {
        if self.retry {
            self.k = hmac(&self.k, &[&self.v, &[0x00]]);
            self.v = hmac(&self.k, &[&self.v]);
        }
        self.v = hmac(&self.k, &[&self.v]);
        self.retry = true;
        self.v
    }
}

fn is_quadratic_residue_y(p: &AffinePoint) -> bool {
    let enc = p.to_encoded_point(false);
    let y = FieldElement::from_bytes(FieldBytes::from_slice(enc.y().expect("uncompressed point has y")));
    let y = Option::<FieldElement>::from(y).expect("valid field element");
    y.sqrt().is_some().into()
}

fn challenge(r_x: &[u8], pubkey33: &[u8; 33], m: &[u8; 32]) -> Scalar {
    let e = Sha256::new().chain_update(r_x).chain_update(pubkey33).chain_update(m).finalize();
    <Scalar as Reduce<U256>>::reduce_bytes(&e)
}

/// Signs a 32-byte message hash.
pub fn sign_hash(key: &PrivateKey, m: &[u8; 32]) -> [u8; 64] {
    let d: Scalar = *key.secret().to_nonzero_scalar();
    let pubkey = key.pubkey();

    let mut seed = Vec::with_capacity(32 + 32 + 16);
    seed.extend_from_slice(&key.to_bytes());
    seed.extend_from_slice(m);
    seed.extend_from_slice(ALGO16);
    let mut rng = Rfc6979::new(&seed);

    loop {
        let candidate = rng.generate();
        let k = Option::<Scalar>::from(Scalar::from_repr(FieldBytes::from(candidate)));
        let Some(mut k) = k.filter(|k| !bool::from(k.is_zero())) else { continue };
        let r = (ProjectivePoint::GENERATOR * k).to_affine();
        if !is_quadratic_residue_y(&r) {
            k = -k;
        }
        let r_x = r.x();
        let e = challenge(&r_x, &pubkey, m);
        let s = k + e * d;
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&r_x);
        sig[32..].copy_from_slice(&s.to_bytes());
        return sig;
    }
}

/// Verifies a BCH Schnorr signature over a 32-byte message hash.
pub fn verify_hash(pubkey33: &[u8; 33], m: &[u8; 32], sig: &[u8; 64]) -> bool {
    let Ok(pk) = PublicKey::from_sec1_bytes(pubkey33) else { return false };
    let r_bytes: [u8; 32] = sig[..32].try_into().unwrap();
    // r must be a field element < p, s a scalar < n.
    if Option::<FieldElement>::from(FieldElement::from_bytes(&FieldBytes::from(r_bytes))).is_none() {
        return false;
    }
    let Some(s) = Option::<Scalar>::from(Scalar::from_repr(FieldBytes::from(<[u8; 32]>::try_from(&sig[32..]).unwrap()))) else {
        return false;
    };
    let e = challenge(&r_bytes, pubkey33, m);
    let r = ProjectivePoint::GENERATOR * s - pk.to_projective() * e;
    if r == ProjectivePoint::IDENTITY {
        return false;
    }
    let r = r.to_affine();
    is_quadratic_residue_y(&r) && r.x().as_slice() == r_bytes
}

/// OP_CHECKDATASIG signature: Schnorr over sha256(message).
pub fn sign_data(key: &PrivateKey, message: &[u8]) -> [u8; 64] {
    sign_hash(key, &sha256(message))
}

pub fn verify_data(pubkey33: &[u8; 33], message: &[u8], sig: &[u8; 64]) -> bool {
    verify_hash(pubkey33, &sha256(message), sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_roundtrip_and_tamper() {
        let key = PrivateKey::from_bytes(&sha256(b"k")).unwrap();
        let msg = b"hello nova";
        let sig = sign_data(&key, msg);
        assert!(verify_data(&key.pubkey(), msg, &sig));
        assert_eq!(sig, sign_data(&key, msg), "deterministic");
        let mut bad = sig;
        bad[40] ^= 1;
        assert!(!verify_data(&key.pubkey(), msg, &bad));
        assert!(!verify_data(&key.pubkey(), b"other", &sig));
        let other = PrivateKey::from_bytes(&sha256(b"other")).unwrap();
        assert!(!verify_data(&other.pubkey(), msg, &sig));
    }
}
