//! Nova Compute coordinator.
//!
//! * [`chain`]: BCH primitives (scripts, cashaddr, transactions, BCH Schnorr, sighash),
//!   the NovaEscrow contract, attestations, payout and Merkle helpers. Proven byte-for-byte
//!   against `contracts/vectors/payout.json`.

pub mod chain;
pub mod chain_client;
pub mod fulcrum;
