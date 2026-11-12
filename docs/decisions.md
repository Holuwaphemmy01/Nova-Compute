# Decision log

| Date       | Decision                         | Why                                                  |
|------------|----------------------------------|------------------------------------------------------|
| 2026-11-11 | Backend in Rust                  | Single static binary, easy cheap deployment          |
| 2026-11-11 | One escrow UTXO per chunk        | Attestations can't be replayed; no on-chain state needed |
| 2026-11-11 | 2× redundancy + hash compare     | Cheap verification without trusted hardware          |
| 2026-11-11 | Develop on chipnet, demo on mainnet | Free test coins, real payouts for judges          |
