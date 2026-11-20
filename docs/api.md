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
{ "template": "neutron_slab",
  "params": { "thickness_cm": 10, "mfp_cm": 3, "absorb_prob": 0.18 },
  "chunk_count": 4, "trials_per_chunk": 10000, "price_per_worker": 1200,
  "master_seed": "<hex, optional>", "refund_after": 1800000000 }
```

`template` is optional and defaults to `neutron_slab`, so older clients keep working. The params
and the meaning of a chunk depend on the template (defaults shown):

| `template` | `params` | one chunk = | `chunk_count` | `trials_per_chunk` |
|---|---|---|---|---|
| `neutron_slab` | `thickness_cm`, `mfp_cm`, `absorb_prob` (all required) | `trials` particles | 1..=1000 | required, 1..=5,000,000 |
| `ising_2d` | `L` 32 (16..=64), `t_min` 1.5, `t_max` 3.5, `eq_sweeps` 1000, `meas_sweeps` 2000 | one temperature T_i = t_min + i·(t_max − t_min)/(n − 1) | 8..=64 (= `n_temps`) | = `meas_sweeps` |
| `sir_epidemic` | `population` 10000 (100..=100,000), `initial_infected` 10, `r0` 2.5 (0.5..=6), `recovery_days` 7 (1..=60), `runs_per_chunk` 200 | `runs_per_chunk` independent outbreaks | 4..=200 | = `runs_per_chunk` |

Other validation: `price_per_worker` ≥ 546 (dust); `master_seed` 1..=64 bytes (random if
omitted); `refund_after` defaults to now + 7 days. The stored `params` have defaults filled in
(Ising adds `n_temps`), and `config_hash` commits to the template and params.
→ `201 { job_id, config_hash, chunk_count, escrow_address, locking_bytecode, per_chunk_value, total_sats, status: "awaiting_funding" }`
with `per_chunk_value = 2 × price + 600`.

`POST /jobs/{id}/funded` `{ "txid": "…" }`: fetches the tx from Fulcrum and requires at least
`chunk_count` outputs of exactly `per_chunk_value` to the escrow's locking bytecode. Chunk *i* is
assigned the *i*-th such output. Sets the job `running`. 0-conf funding is accepted (hackathon).

`POST /jobs/{id}/fund` `{ "raw_tx": "<signed tx hex>" }`: for wallets that only sign. The
coordinator first checks the tx's outputs exactly as `/funded` does (400 and **not broadcast** if
they don't match), then broadcasts it via Fulcrum and records the chunk outpoints. Idempotent for
the same tx.

`GET /jobs` (optional `X-Researcher-Address` filter), `GET /jobs/{id}`: job, `template`, params,
escrow, txids, `progress { pending, paying, paid, unpaid }`.

`GET /jobs/{id}/chunks` → `[{ index, status, attempt, active_leases, outpoint, verified_hash, resolved_by, payout_txid }]`
(`active_leases` = workers computing the chunk right now)

`GET /jobs/{id}/result`: aggregate over the chunks verified so far (it fills in while the job
runs). Always `{ job_id, status, template, chunks_verified, chunk_count, … }`, plus:

- `neutron_slab`: `{ trials, transmitted, reflected, absorbed, transmitted_fraction, transmitted_std_error, histogram[64] }`
- `ising_2d`: `{ points: [{ T, m, e, chi, c }] (sorted by T; m = ⟨|m|⟩, e = ⟨e⟩ per spin, χ, C), tc (T where χ peaks), tc_theory (2.269…, Onsager), lattice: { T, L, bits } }`.
  `lattice` is the final spins of the chunk nearest Tc: hex of L·L bits, row-major, LSB-first per byte, 1 = +1.
- `sir_epidemic`: `{ runs, final_size_hist[64], peak_hist[64] (fractions of N over [0,1]), major_outbreaks, p_major (final size > 10%), major_final_size_mean, mean_peak_day, sample_curves: [[180 daily infected counts], …] (first run of up to 5 chunks) }`

`GET /jobs/{id}/proof` → `{ merkle_root, op_return_txid, funding_txid, leaves: [{ index, hash, resolved_by, payout_txid }] }`.
Merkle rule: SHA-256 over pairs of verified chunk hashes in index order, duplicating the last when
odd; OP_RETURN payload `"NOVA" ‖ job_id ‖ root`.

`POST /jobs/{id}/close` → `{ message, oracle_close_signature, oracle_pubkey, remaining: [{ index, txid, vout, value }] }`:
the oracle's `close` datasig over `job_id ‖ "close"`, for the researcher to sweep unused chunk UTXOs
with `NovaEscrow.close`. Refused (409) while a verified chunk is still being paid. Stops scheduling.

### Chain

`GET /tx/{txid}` → `{ txid, hex }`: raw transaction via the coordinator's Fulcrum connection
(browsers can't speak Electrum TCP). Used by Results to check the OP_RETURN proof.

### Workers

`POST /workers/session` `{ payout_addr, kernel_hash }` → `201 { worker_id, token }` (`payout_addr` must be a P2PKH cashaddr on the coordinator's network)

`GET /workers/me` → `{ worker_id, payout_addr, kernel_hash, verified, mismatched, earned_sats, active_lease, recent_payouts: [{ job_id, index, txid, sats, at }] }`
(`recent_payouts`: the latest 10 broadcast payouts that paid this worker, newest first)

`POST /work/next` → `200 { assignment_id, job_id, index, master_seed, template, params, trials, deadline }` or `204` (no work).
Compute with the kernel: `templates::run_chunk(template, params, job_id, master_seed, index, trials)`
(native) or `new TemplateSimulator(template, JSON.stringify(params), job_id, master_seed, index, trials)` (WASM).

`POST /work/{assignment_id}/result` `{ hash, output: "<hex>" }` (any template) or, for
`neutron_slab` only, `{ hash, summary: { transmitted, reflected, absorbed, histogram[64] } }`
→ `{ status: "accepted" | "verified" | "mismatch" }`.
The result must reproduce the hash, `sha256(job_id ‖ index u32 BE ‖ output_bytes)` with the
template's canonical output bytes (kernel/README.md), and must decode for the job:
- neutron: counts sum to `trials`;
- Ising: the output's temperature is this chunk's T_i, bit for bit;
- SIR: it holds exactly `trials` outbreaks.

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
