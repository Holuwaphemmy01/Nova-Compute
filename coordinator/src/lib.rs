//! Nova Compute coordinator.
//!
//! * [`chain`]: BCH primitives (scripts, cashaddr, transactions, BCH Schnorr, sighash),
//!   the NovaEscrow contract, attestations, payout and Merkle helpers. Proven byte-for-byte
//!   against `contracts/vectors/payout.json`.
//! * [`chain_client`] / [`fulcrum`]: blockchain access (Fulcrum over Electrum JSON-RPC, or a mock).
//! * [`service`]: jobs, scheduler, verification, payouts, finalization.
//! * [`api`]: the REST API (base `/api/v1`).

pub mod api;
pub mod chain;
pub mod chain_client;
pub mod config;
pub mod contract_rules;
pub mod fulcrum;
pub mod service;
