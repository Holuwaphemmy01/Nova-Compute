# API

Coordinator REST API. Base path `/api/v1`. JSON in and out. Amounts in satoshis, hashes and ids
lower-case hex, times unix milliseconds unless noted.

**Auth (hackathon):** researchers identify with their cashaddr in `X-Researcher-Address`
(TODO: replace with a signed wallet challenge before mainnet). Workers use
`Authorization: Bearer <token>` from `POST /workers/session`.

## REST endpoints

### Health

`GET /health` (also `/api/v1/health`) → `{ status, network, fulcrum: "ok"|"unreachable", oracle_pubkey, fee_address, version }`

### Jobs (researcher)

`POST /jobs` (header `X-Researcher-Address`)

```json
{ "params": { "thickness_cm": 10, "mfp_cm": 3, "absorb_prob": 0.18 },
  "chunk_count": 4, "trials_per_chunk": 10000, "price_per_worker": 1200,
  "master_seed": "<hex, optional>", "refund_after": 1800000000 }
```

Validation: kernel params valid; `price_per_worker` ≥ 546 (dust); `chunk_count` 1..=1000;
`trials_per_chunk` 1..=5,000,000; `master_seed` 1..=64 bytes (random if omitted);
`refund_after` defaults to now + 7 days.
→ `201 { job_id, config_hash, chunk_count, escrow_address, locking_bytecode, per_chunk_value, total_sats, status: "awaiting_funding" }`
with `per_chunk_value = 2 × price + 600`.

`POST /jobs/{id}/funded` `{ "txid": "…" }`: fetches the tx from Fulcrum and requires at least
`chunk_count` outputs of exactly `per_chunk_value` to the escrow's locking bytecode. Chunk *i* is
assigned the *i*-th such output. Sets the job `running`. 0-conf funding is accepted (hackathon).

`GET /jobs` (optional `X-Researcher-Address` filter), `GET /jobs/{id}`: job, params, escrow,
txids, `progress { pending, paying, paid, unpaid }`.

`GET /jobs/{id}/chunks` → `[{ index, status, attempt, outpoint, verified_hash, resolved_by, payout_txid }]`

`GET /jobs/{id}/result`: totals over verified chunks:
`{ trials, transmitted, reflected, absorbed, transmitted_fraction, transmitted_std_error, histogram[64] }`.

`GET /jobs/{id}/proof` → `{ merkle_root, op_return_txid, funding_txid, leaves: [{ index, hash, resolved_by, payout_txid }] }`.
Merkle rule: SHA-256 over pairs of verified chunk hashes in index order, duplicating the last when
odd; OP_RETURN payload `"NOVA" ‖ job_id ‖ root`.

`POST /jobs/{id}/close` → `{ message, oracle_close_signature, oracle_pubkey, remaining: [{ index, txid, vout, value }] }`:
the oracle's `close` datasig over `job_id ‖ "close"`, for the researcher to sweep unused chunk UTXOs
with `NovaEscrow.close`. Refused (409) while a verified chunk is still being paid. Stops scheduling.

### Workers

`POST /workers/session` `{ payout_addr, kernel_hash }` → `201 { worker_id, token }` (`payout_addr` must be a P2PKH cashaddr on the coordinator's network)

`GET /workers/me` → `{ worker_id, payout_addr, kernel_hash, verified, mismatched, earned_sats, active_lease }`

`POST /work/next` → `200 { assignment_id, job_id, index, master_seed, params, trials, deadline }` or `204` (no work)

`POST /work/{assignment_id}/result` `{ hash, summary: { transmitted, reflected, absorbed, histogram[64] } }`
→ `{ status: "accepted" | "verified" | "mismatch" }`. The summary must reproduce the hash
(`sha256(job_id ‖ index u32 BE ‖ u32 LE t, r, a, 64 bins)`), and the counts must sum to `trials`.

### Scheduling and verification rules

- Each chunk attempt goes to **2 different workers** with **different payout addresses**; a worker
  never gets a chunk it already worked on. One active lease per worker; leases expire after 60 s.
- Equal hashes → chunk verified → oracle attestation → payout queued (outputs 0/1 → the two workers).
- Different hashes → both discarded, `mismatched += 1` for both, reassigned to 2 new workers.
- After 3 failed attempts the coordinator runs the chunk with the kernel crate and pays the
  distinct-address workers whose submissions match it: two → both; one → that worker and the
  coordinator's fee wallet (the contract requires two different payees); none → the chunk stays
  `unpaid` and its UTXO is returned at close.
- Every payout tx is checked against the contract rules in Rust, stored once per chunk, and only
  that exact tx is ever (re)broadcast, so a chunk UTXO can't be double-spent. Retries back off 1 s → 60 s.
- When all chunks are `paid`/`unpaid`, the coordinator broadcasts the Merkle-root OP_RETURN from its
  fee wallet (`FEE_WIF`) and marks the job `complete`.

## WebSocket events

Not implemented yet; clients poll `GET /jobs/{id}` and `GET /jobs/{id}/chunks`.

## Error codes

Errors are `{ "error": { "code", "message" } }`.

| HTTP | code | when |
|---|---|---|
| 400 | `bad_request` | invalid params, address, hash/summary mismatch, funding tx doesn't match |
| 401 | `unauthorized` | missing/invalid worker token or researcher header |
| 403 | `forbidden` | not your job / assignment |
| 404 | `not_found` | unknown job or assignment |
| 409 | `conflict` | wrong job state, result already submitted, close while paying |
| 410 | `lease_expired` | result for an expired lease |
| 502 | `chain_error` | Fulcrum unreachable or rejected a request |
| 500 | `internal` | unexpected |

## Database

SQLite (`coordinator/migrations/0001_init.sql`): `jobs`, `chunks`, `workers`, `assignments`,
`results`, `attestations`, `payouts`.
