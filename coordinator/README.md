# coordinator/ (`nova-coordinator`)

Rust backend (axum + tokio + SQLite). It schedules each chunk of a job on 2 different browser
workers, compares their kernel hashes and signs an oracle attestation when they match. It then
broadcasts the payout from that chunk's own escrow UTXO, and finally writes the job's Merkle root
in an OP_RETURN. API: [`docs/api.md`](../docs/api.md).

| Module | What it does |
|---|---|
| `chain/` | BCH primitives: CashScript redeem script / P2SH32 / cashaddr, attestations, BCH Schnorr, BIP143/FORKID signing, payout tx, Merkle root. Byte-identical to `contracts/vectors/payout.json`. |
| `fulcrum.rs` | Electrum JSON-RPC over TLS/TCP, with reconnect and server fallback. |
| `service.rs` | Jobs, scheduler, verification, payouts, finalization. |
| `api.rs` | REST under `/api/v1`. |
| `bin/e2e.rs` | Real chipnet end-to-end run. |

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `NETWORK` | no | `chipnet` | `chipnet` or `mainnet`. Mainnet only when set explicitly. |
| `ORACLE_WIF` | **yes** | | Oracle key; signs attestations and close signatures. Needs no funds. |
| `FEE_WIF` | **yes** | | Small fee wallet; pays the OP_RETURN (≈ 300 sats per job). Must differ from the oracle key. |
| `FULCRUM_URL` | no | network defaults | Comma-separated `ssl://host:port` / `tcp://host:port`. The defaults are appended as fallbacks (chipnet: `chipnet.bch.ninja`, `chipnet.imaginary.cash` on 50002). |
| `DATABASE_URL` | no | `sqlite://nova.db` | SQLite file, created if missing. |
| `PORT` | no | `8080` | HTTP port. |
| `CORS_ORIGIN` | no | none | Web app origin(s), comma-separated, or `*`. |
| `LEASE_MS` | no | `60000` | Chunk lease length. |

The keys are read from the environment or a `.env` file (gitignored). Never commit them.

## Run locally

```bash
# repo root .env with NETWORK, ORACLE_WIF, FEE_WIF, CORS_ORIGIN=http://localhost:5173
cargo run -p nova-coordinator
curl http://localhost:8080/health     # { status: ok, fulcrum: ok, oracle_pubkey, fee_address, … }
```

## Tests

```bash
cargo test -p nova-coordinator                                # vectors, Fulcrum (fake server), full flows on MockChain
cargo test -p nova-coordinator --test fulcrum -- --ignored    # live chipnet Fulcrum ping
```

## Chipnet end-to-end

```bash
cargo run -p nova-coordinator --bin e2e -- --chunks 4 --price 1200 [--trials 10000]
```

This funds a job from `FEE_WIF` (about `chunks × 3,000 + 3,000` sats; it tells you if the wallet
is short), then runs 2 in-process workers. It waits for every payout and the OP_RETURN, and prints
all txids with chipnet explorer links. For the full browser + wallet run, see
[`docs/e2e-manual.md`](../docs/e2e-manual.md).

## Deploy (Docker / Fly.io)

The image is a static musl binary `FROM scratch` (TLS roots compiled in). SQLite lives on the
`/data` volume, and `HEALTHCHECK` runs `/nova-coordinator --healthcheck`, which does a GET on
`/health`. Build from the **repo root**, because the binary embeds `contracts/artifacts/` and
uses `kernel/`:

```bash
docker build -f coordinator/Dockerfile -t nova-coordinator .
docker run -p 8080:8080 -v nova_data:/data --env-file .env nova-coordinator
```

Fly.io: see the commands at the top of [`fly.toml`](fly.toml). It runs one always-on machine
(the payout loop runs in the background) with a 1 GB volume. Set `ORACLE_WIF`, `FEE_WIF` and
`CORS_ORIGIN` as `fly secrets`. SQLite means exactly one machine, so don't scale out.
