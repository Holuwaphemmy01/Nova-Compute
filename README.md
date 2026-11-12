# Nova Compute

**Run Monte Carlo simulations on idle GPUs. Pay per verified result, in BCH.**

> ### 🔥 BCH BLAZE 2026
>
> | | |
> |---|---|
> | Slides | [Widget Factory slides] |
> | Live demo | [Live demo] |
> | Nov 14 baseline demo | [Nov 14 baseline demo] |
> | Nov 14 baseline code | [Nov 14 baseline code: tag blaze-start] |
> | CashTokens address | [EMBER2026 CashTokens address] |

## The problem

Researchers who need large Monte Carlo runs overpay for centralized cloud compute. At the same time, millions of consumer GPUs sit idle most of the day. Nothing connects the two cheaply while keeping trust in the results.

## How it works

1. **Fund:** a researcher funds a CashScript escrow for the job.
2. **Split:** the coordinator splits the job into deterministically seeded chunks.
3. **Compute:** each chunk is computed independently by 2 browser workers running the WASM kernel.
4. **Verify and pay:** when the two SHA-256 result hashes match, the coordinator signs an attestation and the escrow pays both workers in BCH instantly. When the job finishes, a Merkle root of all chunk results is published in an `OP_RETURN`.

## Architecture

| Component | Role |
|---|---|
| **WASM kernel** | Rust Monte Carlo neutron transport kernel compiled to WebAssembly; fixed-point math, ChaCha PRNG, SHA-256 |
| **Rust coordinator** | axum + tokio service: jobs, chunk scheduling, hash verification, oracle signing, payouts |
| **CashScript escrow** | On-chain escrow with one UTXO per chunk, released by a signed attestation |
| **React app** | Researcher and provider UI with WizardConnect wallet |
| **Fulcrum** | Electrum-protocol BCH server used for chain queries and broadcasting |

Details: [docs/architecture.md](docs/architecture.md)

## Tech stack

| Area | Technology |
|---|---|
| Kernel | Rust, wasm-pack |
| Backend | Rust, axum, tokio, SQLite |
| Contracts | CashScript |
| Frontend | React, TypeScript, Vite |
| Wallet | WizardConnect |
| Chain access | Fulcrum |

## Repo layout

```
nova-compute/
├── kernel/          # Rust crate → compiled to WebAssembly (Monte Carlo neutron transport, fixed-point, ChaCha PRNG, SHA-256)
├── coordinator/     # Rust backend (axum + tokio): jobs, chunk scheduler, hash verification, oracle signing, payouts via Fulcrum
├── contracts/       # CashScript escrow contract + TypeScript tests (MockNetworkProvider)
├── web/             # React + TypeScript frontend (Vite), WizardConnect wallet
├── design/          # UI design exports (PNG/PDF) of all 8 screens
├── docs/            # architecture.md, api.md, decisions.md
├── .github/         # empty workflows folder for CI later
├── .gitignore
├── .env.example
├── LICENSE
└── README.md
```

## Status

Pre-hackathon prep. Building starts Nov 14, 2026.

> **Hackathon rules note:** Work before Nov 14 is tagged `blaze-start`; everything after is the judged build.

## Getting started

Coming Nov 14.

## License

[MIT](LICENSE)
