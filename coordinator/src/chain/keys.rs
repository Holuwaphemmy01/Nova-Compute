//! Private keys (WIF), compressed public keys and pubkey hashes.

use k256::{PublicKey, SecretKey, elliptic_curve::sec1::ToEncodedPoint};

use super::{ChainError, Network, cashaddr, hash::hash160, script};

#[derive(Clone)]
pub struct PrivateKey {
    secret: SecretKey,
}

impl std::fmt::Debug for PrivateKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PrivateKey(pkh={})", hex::encode(self.pkh()))
    }
}

impl PrivateKey {
    pub fn from_bytes(b: &[u8; 32]) -> Result<Self, ChainError> {
        SecretKey::from_slice(b).map(|secret| Self { secret }).map_err(|_| ChainError::InvalidKey("not a valid secp256k1 scalar"))
    }

    /// Decodes a WIF and checks it belongs to `network`.
    pub fn from_wif(wif: &str, network: Network) -> Result<Self, ChainError> {
        let raw = bs58::decode(wif.trim()).with_check(None).into_vec().map_err(|_| ChainError::InvalidKey("bad base58check"))?;
        let (version, rest) = raw.split_first().ok_or(ChainError::InvalidKey("empty"))?;
        if *version != network.wif_version() {
            return Err(ChainError::InvalidKey("WIF is for a different network"));
        }
        let key = match rest.len() {
            33 if rest[32] == 0x01 => &rest[..32],
            32 => rest,
            _ => return Err(ChainError::InvalidKey("bad WIF length")),
        };
        Self::from_bytes(key.try_into().unwrap())
    }

    pub fn to_wif(&self, network: Network) -> String {
        let mut raw = vec![network.wif_version()];
        raw.extend_from_slice(&self.to_bytes());
        raw.push(0x01);
        bs58::encode(raw).with_check().into_string()
    }

    pub fn to_bytes(&self) -> [u8; 32] {
        self.secret.to_bytes().into()
    }

    pub fn secret(&self) -> &SecretKey {
        &self.secret
    }

    pub fn public_key(&self) -> PublicKey {
        self.secret.public_key()
    }

    /// 33-byte compressed public key.
    pub fn pubkey(&self) -> [u8; 33] {
        compressed(&self.public_key())
    }

    pub fn pkh(&self) -> [u8; 20] {
        hash160(&self.pubkey())
    }

    pub fn p2pkh_script(&self) -> Vec<u8> {
        script::p2pkh(&self.pkh())
    }

    pub fn address(&self, network: Network) -> String {
        cashaddr::encode(network.cashaddr_prefix(), cashaddr::AddrType::P2pkh, &self.pkh()).unwrap()
    }

    /// A fresh random key (uses the OS RNG).
    pub fn random() -> Self {
        Self { secret: SecretKey::random(&mut k256::elliptic_curve::rand_core::OsRng) }
    }
}

pub fn compressed(pk: &PublicKey) -> [u8; 33] {
    pk.to_encoded_point(true).as_bytes().try_into().unwrap()
}
