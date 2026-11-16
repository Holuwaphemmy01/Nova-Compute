//! Bitcoin Cash primitives used by the coordinator.

pub mod attestation;
pub mod cashaddr;
pub mod contract;
pub mod hash;
pub mod keys;
pub mod merkle;
pub mod payout;
pub mod schnorr;
pub mod script;
pub mod sighash;
pub mod tx;
pub mod wallet;

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ChainError {
    #[error("invalid key: {0}")]
    InvalidKey(&'static str),
    #[error("invalid address: {0}")]
    InvalidAddress(String),
    #[error("invalid script: {0}")]
    InvalidScript(String),
    #[error("invalid transaction: {0}")]
    InvalidTx(&'static str),
    #[error("invalid artifact: {0}")]
    InvalidArtifact(String),
    #[error("invalid argument: {0}")]
    InvalidArgument(&'static str),
}

/// The BCH network a key, address or contract belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Mainnet,
    Chipnet,
}

impl Network {
    pub fn cashaddr_prefix(self) -> &'static str {
        match self {
            Network::Mainnet => "bitcoincash",
            Network::Chipnet => "bchtest",
        }
    }
    pub fn wif_version(self) -> u8 {
        match self {
            Network::Mainnet => 0x80,
            Network::Chipnet => 0xef,
        }
    }
    pub fn explorer_tx_url(self, txid: &str) -> String {
        match self {
            Network::Mainnet => format!("https://explorer.bitcoinunlimited.info/tx/{txid}"),
            Network::Chipnet => format!("https://chipnet.imaginary.cash/tx/{txid}"),
        }
    }
}

impl std::str::FromStr for Network {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "mainnet" => Ok(Network::Mainnet),
            "chipnet" => Ok(Network::Chipnet),
            other => Err(format!("unknown network {other:?} (expected chipnet or mainnet)")),
        }
    }
}
