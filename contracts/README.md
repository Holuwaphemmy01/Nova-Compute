# contracts/

`NovaEscrow.cash` (CashScript 0.14.0): one escrow UTXO per chunk of a Nova job.

| Function | Who | Checks |
|---|---|---|
| `payout(attestation, workerA, workerB, resultHash)` | anyone with the oracle attestation | workers differ; oracle datasig over `jobId ‖ outpoint ‖ workerA ‖ workerB ‖ resultHash`; outputs `2i`/`2i+1` pay workerA/workerB ≥ price |
| `close(pk, sig, oracleClose)` | researcher + oracle | researcher key & sig; oracle datasig over `jobId ‖ "close"` |
| `refund(pk, sig)` | researcher | researcher key & sig; `tx.time >= refundAfter` |

Each chunk UTXO holds `2 × price + 600` sats; the 600-sat margin pays the 509-byte payout tx's fee.

```bash
pnpm install
pnpm build          # cashc → artifacts/NovaEscrow.json
pnpm test           # MockNetworkProvider suite + golden vector check
pnpm vectors        # regenerate vectors/payout.json (deterministic)
pnpm chipnet:demo   # needs contracts/.env with CHIPNET_WIF + ORACLE_WIF (chipnet test keys)
```

`vectors/payout.json` is a fixed payout built with public test keys, for the Rust coordinator.
