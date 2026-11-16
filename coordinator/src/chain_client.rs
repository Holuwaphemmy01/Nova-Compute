//! The coordinator's view of the blockchain. Production uses [`crate::fulcrum::FulcrumClient`];
//! tests use [`MockChain`], which records broadcasts and rejects double spends.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use async_trait::async_trait;
use serde::Deserialize;
use thiserror::Error;

use crate::chain::{contract::electrum_scripthash, tx::Transaction};

#[derive(Debug, Error)]
pub enum ChainClientError {
    #[error("connection error: {0}")]
    Connection(String),
    #[error("server error: {0}")]
    Server(String),
    #[error("request timed out")]
    Timeout,
    #[error("unexpected response: {0}")]
    BadResponse(String),
}

impl ChainClientError {
    /// True when retrying may help (network trouble), false when the server rejected the request.
    pub fn is_transient(&self) -> bool {
        !matches!(self, ChainClientError::Server(_))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Unspent {
    pub tx_hash: String,
    pub tx_pos: u32,
    pub value: u64,
    #[serde(default)]
    pub height: i64,
}

#[async_trait]
pub trait ChainClient: Send + Sync {
    /// blockchain.transaction.broadcast → txid
    async fn broadcast(&self, tx_hex: &str) -> Result<String, ChainClientError>;
    /// blockchain.transaction.get → raw tx hex
    async fn get_transaction(&self, txid: &str) -> Result<String, ChainClientError>;
    /// blockchain.scripthash.listunspent
    async fn list_unspent(&self, scripthash: &str) -> Result<Vec<Unspent>, ChainClientError>;
    /// server.ping
    async fn ping(&self) -> Result<(), ChainClientError>;
}

/// In-memory chain for tests: tracks a UTXO set, records every broadcast, rejects double spends.
#[derive(Default)]
pub struct MockChain {
    inner: Mutex<MockInner>,
}

#[derive(Default)]
struct MockInner {
    txs: HashMap<String, String>,
    broadcasts: Vec<String>,
    /// (txid, vout) → (value, locking bytecode)
    utxos: HashMap<(String, u32), (u64, Vec<u8>)>,
    spent: HashSet<(String, u32)>,
    fail_next: usize,
}

impl MockChain {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a transaction as if it were already on chain (e.g. a funding tx made elsewhere).
    pub fn add_confirmed(&self, tx: &Transaction) {
        let mut g = self.inner.lock().unwrap();
        Self::apply(&mut g, tx);
    }

    /// Hex of every transaction broadcast so far, in order.
    pub fn broadcasts(&self) -> Vec<String> {
        self.inner.lock().unwrap().broadcasts.clone()
    }

    /// Makes the next `n` broadcasts fail with a transient error (to exercise retries).
    pub fn fail_next_broadcasts(&self, n: usize) {
        self.inner.lock().unwrap().fail_next = n;
    }

    fn apply(g: &mut MockInner, tx: &Transaction) {
        let txid = tx.txid_hex();
        for i in &tx.inputs {
            let key = (i.outpoint.txid_hex(), i.outpoint.vout);
            g.utxos.remove(&key);
            g.spent.insert(key);
        }
        for (vout, o) in tx.outputs.iter().enumerate() {
            g.utxos.insert((txid.clone(), vout as u32), (o.value, o.locking_bytecode.clone()));
        }
        g.txs.insert(txid, tx.to_hex());
    }
}

#[async_trait]
impl ChainClient for MockChain {
    async fn broadcast(&self, tx_hex: &str) -> Result<String, ChainClientError> {
        let tx = Transaction::parse_hex(tx_hex).map_err(|e| ChainClientError::Server(e.to_string()))?;
        let mut g = self.inner.lock().unwrap();
        if g.fail_next > 0 {
            g.fail_next -= 1;
            return Err(ChainClientError::Connection("mock: simulated network failure".into()));
        }
        let txid = tx.txid_hex();
        if g.txs.contains_key(&txid) {
            return Ok(txid); // idempotent re-broadcast, like a node's "already known"
        }
        for i in &tx.inputs {
            let key = (i.outpoint.txid_hex(), i.outpoint.vout);
            if g.spent.contains(&key) {
                return Err(ChainClientError::Server(format!("mock: input {}:{} already spent (double spend)", key.0, key.1)));
            }
            if !g.utxos.contains_key(&key) {
                return Err(ChainClientError::Server(format!("mock: input {}:{} unknown (missing inputs)", key.0, key.1)));
            }
        }
        g.broadcasts.push(tx_hex.to_string());
        Self::apply(&mut g, &tx);
        Ok(txid)
    }

    async fn get_transaction(&self, txid: &str) -> Result<String, ChainClientError> {
        self.inner.lock().unwrap().txs.get(txid).cloned().ok_or_else(|| ChainClientError::Server(format!("mock: unknown tx {txid}")))
    }

    async fn list_unspent(&self, scripthash: &str) -> Result<Vec<Unspent>, ChainClientError> {
        let g = self.inner.lock().unwrap();
        let mut out: Vec<Unspent> = g
            .utxos
            .iter()
            .filter(|(_, (_, script))| electrum_scripthash(script) == scripthash)
            .map(|((txid, vout), (value, _))| Unspent { tx_hash: txid.clone(), tx_pos: *vout, value: *value, height: 0 })
            .collect();
        out.sort_by(|a, b| (a.tx_hash.as_str(), a.tx_pos).cmp(&(b.tx_hash.as_str(), b.tx_pos)));
        Ok(out)
    }

    async fn ping(&self) -> Result<(), ChainClientError> {
        Ok(())
    }
}
