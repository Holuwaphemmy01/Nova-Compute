# coordinator/

Rust backend service (axum + tokio).

Will contain:
- Job intake and lifecycle
- Chunk scheduler (assigns each chunk to 2 independent workers)
- Hash verification (compares the SHA-256 results from both workers)
- Oracle signing of attestations for the escrow contract
- BCH payouts via Fulcrum

_Empty placeholder. Building starts Nov 14, 2026._
