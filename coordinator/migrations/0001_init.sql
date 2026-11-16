-- Nova Compute coordinator schema. Times are unix milliseconds; hashes/ids are lower-case hex.

CREATE TABLE jobs (
    id                TEXT PRIMARY KEY,          -- job_id (32 bytes), also the escrow's jobId
    researcher_addr   TEXT NOT NULL,
    researcher_pkh    TEXT NOT NULL,
    thickness_cm      REAL NOT NULL,
    mfp_cm            REAL NOT NULL,
    absorb_prob       REAL NOT NULL,
    master_seed       TEXT NOT NULL,
    chunk_count       INTEGER NOT NULL,
    trials_per_chunk  INTEGER NOT NULL,
    price_per_worker  INTEGER NOT NULL,
    refund_after      INTEGER NOT NULL,
    config_hash       TEXT NOT NULL,
    escrow_address    TEXT NOT NULL,
    locking_bytecode  TEXT NOT NULL,
    per_chunk_value   INTEGER NOT NULL,
    status            TEXT NOT NULL,             -- awaiting_funding | running | finalizing | complete | closed
    funding_txid      TEXT,
    merkle_root       TEXT,
    op_return_txid    TEXT,
    last_error        TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE chunks (
    job_id            TEXT NOT NULL REFERENCES jobs(id),
    idx               INTEGER NOT NULL,
    outpoint_txid     TEXT,
    outpoint_vout     INTEGER,
    value             INTEGER,
    status            TEXT NOT NULL DEFAULT 'pending', -- pending | paying | paid | unpaid
    attempt           INTEGER NOT NULL DEFAULT 0,
    verified_hash     TEXT,
    verified_summary  TEXT,                            -- JSON {transmitted, reflected, absorbed, histogram}
    resolved_by       TEXT,                            -- workers | coordinator
    PRIMARY KEY (job_id, idx)
);

CREATE TABLE workers (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    payout_addr  TEXT NOT NULL,
    payout_pkh   TEXT NOT NULL,
    kernel_hash  TEXT NOT NULL,
    verified     INTEGER NOT NULL DEFAULT 0,
    mismatched   INTEGER NOT NULL DEFAULT 0,
    earned_sats  INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL
);

CREATE TABLE assignments (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL,
    idx         INTEGER NOT NULL,
    attempt     INTEGER NOT NULL,
    worker_id   TEXT NOT NULL REFERENCES workers(id),
    payout_pkh  TEXT NOT NULL,
    status      TEXT NOT NULL,                  -- active | submitted | expired | discarded
    deadline    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (job_id, idx) REFERENCES chunks(job_id, idx)
);
CREATE INDEX assignments_by_worker ON assignments(worker_id, status);
CREATE INDEX assignments_by_chunk ON assignments(job_id, idx, attempt);

CREATE TABLE results (
    assignment_id  TEXT PRIMARY KEY REFERENCES assignments(id),
    job_id         TEXT NOT NULL,
    idx            INTEGER NOT NULL,
    attempt        INTEGER NOT NULL,
    worker_id      TEXT NOT NULL,
    payout_pkh     TEXT NOT NULL,
    hash           TEXT NOT NULL,
    summary        TEXT NOT NULL,
    outcome        TEXT NOT NULL DEFAULT 'pending', -- pending | matched | mismatched | coordinator_matched
    submitted_at   INTEGER NOT NULL
);
CREATE INDEX results_by_chunk ON results(job_id, idx, attempt);

CREATE TABLE attestations (
    job_id        TEXT NOT NULL,
    idx           INTEGER NOT NULL,
    worker_a_pkh  TEXT NOT NULL,
    worker_b_pkh  TEXT NOT NULL,
    result_hash   TEXT NOT NULL,
    message       TEXT NOT NULL,
    signature     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (job_id, idx)
);

CREATE TABLE payouts (
    job_id           TEXT NOT NULL,
    idx              INTEGER NOT NULL,
    worker_a_id      TEXT,                     -- NULL when the payee is the coordinator's fee wallet
    worker_b_id      TEXT,
    tx_hex           TEXT NOT NULL,            -- built once; only this exact tx is ever broadcast
    txid             TEXT NOT NULL,
    status           TEXT NOT NULL,            -- queued | broadcast | failed
    attempts         INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    next_attempt_at  INTEGER NOT NULL,
    broadcast_at     INTEGER,
    PRIMARY KEY (job_id, idx)
);
