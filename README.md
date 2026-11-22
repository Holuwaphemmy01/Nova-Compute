# Nova Compute

**Verifiable, pay-per-result science compute on Bitcoin Cash.**

| | |
|---|---|
| **Live demo** | https://nova-compute-web.onrender.com |
| **API** | https://nova-coordinator.onrender.com/health |
| Nov 14 baseline code | [tree/blaze-start](https://github.com/Holuwaphemmy01/nova-compute/tree/blaze-start) · [baseline details](docs/baseline.md) |
| Slides | [Widget Factory slides] |
| CashTokens address | [EMBER2026 CashTokens address] |

> The demo runs on Render's free plan: the first request after a quiet spell can take ~1 min while it wakes.

## Proof on-chain (chipnet)

Three real jobs, one per simulation template, run end to end by the coordinator on chipnet
(Nov 20, 2026). Every payout spends its own escrow UTXO through the NovaEscrow contract; the
OP_RETURN carries the Merkle root of all piece results. Full logs: [docs/e2e-manual.md](docs/e2e-manual.md).

| Job | Step | Transaction |
|---|---|---|
| **Neutron slab** (4 pieces) | Funding | [b74aed33…c8c1](https://chipnet.imaginary.cash/tx/b74aed33b3e144fa73a450b8214aac0e4fee5d64d6118c37c94462691d66c8c1) |
| | Payout 0 | [150f83a5…cad7](https://chipnet.imaginary.cash/tx/150f83a597ad1371ceb31a1a91db59aa72c4928391dbb4c37056ff9bf845cad7) |
| | Payout 1 | [55dc97fc…f4c3](https://chipnet.imaginary.cash/tx/55dc97fcb7a6f4ccee3f9c1f7729c98c12f9ef157c3cdf91bdce72f3b4e1f4c3) |
| | Payout 2 | [0d4c199d…3b23](https://chipnet.imaginary.cash/tx/0d4c199dd1a984736770e486b2816130f9697a42387c6fe0a9c77e9e051c3b23) |
| | Payout 3 | [19b7872c…e6b1](https://chipnet.imaginary.cash/tx/19b7872cf9f357e96ce09281b1ff2942119243aab087f3dfb3b07cc10852e6b1) |
| | OP_RETURN root | [82456f8d…7c9a](https://chipnet.imaginary.cash/tx/82456f8d45c1d2269db6e2c37184872ef676f77c5f0bf0f9bfd1d7c0b3b37c9a) |
| **Ising 2D** (8 temperatures) | Funding | [aecab252…de2e](https://chipnet.imaginary.cash/tx/aecab2520f1718fd7b883a421c9fddcf740a9e2ea35a59a166f0e5893045de2e) |
| | Payout T=1.500 | [c8602100…7b31](https://chipnet.imaginary.cash/tx/c8602100ab57e6783f0d3ffb859a907298209308408968dfe03c2a99fd347b31) |
| | Payout T=1.786 | [229eeac1…72a0](https://chipnet.imaginary.cash/tx/229eeac1331ef358bc8004b11bd200b8d0d33d8fbf00e427ebd9afc0207972a0) |
| | Payout T=2.071 | [4cdd6a76…3d47](https://chipnet.imaginary.cash/tx/4cdd6a765e4d2dda28029bfdc2bd72bad44f9d7c4a7704d9326b0faa513c3d47) |
| | Payout T=2.357 | [3c298916…3646](https://chipnet.imaginary.cash/tx/3c298916624d62547f32d7a644eaedea801fe9e2515014de5a895329f8823646) |
| | Payout T=2.643 | [8fb760c9…aa33](https://chipnet.imaginary.cash/tx/8fb760c974b1bb56777a4fa127e435fc85632a353ea21d1faab9e709dc02aa33) |
| | Payout T=2.929 | [5ffadb5e…ec8c](https://chipnet.imaginary.cash/tx/5ffadb5ec298baeecb9a4ac7c2a345b237966ddbcb895f6f70efd100ada9ec8c) |
| | Payout T=3.214 | [cff54e73…f2b9](https://chipnet.imaginary.cash/tx/cff54e73bb9623b32025e79de1f668ed36df9246277ccc536c3c47ff8d14f2b9) |
| | Payout T=3.500 | [804deee9…e39d](https://chipnet.imaginary.cash/tx/804deee95609d124a6fb73e48c6e72ff2d1a138a09f6ccc3580c8300cef1e39d) |
| | OP_RETURN root | [96b92595…18cb](https://chipnet.imaginary.cash/tx/96b9259581a7c3dffc81d788217ba882578bfa4dcc6904a78d6cd4003d6818cb) |
| **SIR epidemic** (4 pieces) | Funding | [6e39a87c…74c2](https://chipnet.imaginary.cash/tx/6e39a87c761031bfa39b1d765852f7be39d99bbe8413053580cc4fb0f21c74c2) |
| | Payout 0 | [6cba4e99…30d4](https://chipnet.imaginary.cash/tx/6cba4e99b0a3d661a07ac125dad1ce224befa4da5a13dc43becdf387bfed30d4) |
| | Payout 1 | [3b6ffd0b…5c70](https://chipnet.imaginary.cash/tx/3b6ffd0b5648c640d4f3103657bfeaa06b53550baf6f7fff82ec0298fed35c70) |
| | Payout 2 | [526e6be6…a3de](https://chipnet.imaginary.cash/tx/526e6be6e0ba554d54e443641218bb6c329ea5f2c8124cd5a57f532f1109a3de) |
| | Payout 3 | [7a54113a…dea5](https://chipnet.imaginary.cash/tx/7a54113aa54835f3ec9412fb8f5387a78b8fb0865f45d4079d2b3fb549c5dea5) |
| | OP_RETURN root | [a75e1044…9bed](https://chipnet.imaginary.cash/tx/a75e1044578c54c4ea3eee831067dbc2e747c081cc4a338453a3413983869bed) |

Results: neutron 11.11 % ± 0.16 % transmitted (40,000 particles) · Ising Tc ≈ 2.36 from the
susceptibility peak (exact 2.269; grid spacing 0.29) · SIR R0 = 2.5: mean major-outbreak size
0.893, matching theory.

## How it works

1. **Fund.** A researcher picks a template, sets parameters and funds a CashScript escrow from
   their wallet: one UTXO per piece of work.
2. **Split.** The coordinator splits the job into pieces, each with a seed derived from the job,
   so every piece is exactly reproducible.
3. **Compute.** Two independent providers (browser tabs running the WASM kernel) compute each
   piece and submit `sha256(job_id ‖ index ‖ output)`.
4. **Verify and pay.** When the two hashes match, the coordinator checks the output, signs an
   attestation, and the escrow pays both providers in BCH. A mismatch is re-assigned.
5. **Prove.** When all pieces are done, the Merkle root of the results goes on chain in an
   `OP_RETURN`; anyone can recompute it from the results and check it in the app.

## Architecture

| Component | Role |
|---|---|
| **Kernel** (`kernel/`) | Rust, compiled to WebAssembly. Three templates: neutron slab transport, 2D Ising (Metropolis), SIR epidemic (Gillespie). Bit-for-bit deterministic: ChaCha8, libm, sequential loops, IEEE-754 outputs. Native and WASM builds produce the same golden hashes. |
| **Escrow** (`contracts/`) | CashScript `NovaEscrow`: `payout` (oracle-attested, pays both providers), `close` (researcher + oracle reclaim unfinished pieces), `refund` (timeout). |
| **Coordinator** (`coordinator/`) | Rust, axum + tokio + SQLite. Jobs, leases, double-compute verification, oracle signing (BCH Schnorr), payout and OP_RETURN broadcast via Fulcrum. |
| **Web** (`web/`) | React + TypeScript + Vite. Researcher flow, browser provider that earns, simulation lab, live job view, on-chain result check. WizardConnect wallet; keys never leave the wallet. |

More: [docs/architecture.md](docs/architecture.md) · [docs/api.md](docs/api.md) · [docs/decisions.md](docs/decisions.md)

## Built during BLAZE (Nov 14–22) vs. baseline

The [`blaze-start`](https://github.com/Holuwaphemmy01/nova-compute/tree/blaze-start) tag (Nov 12)
is repo structure and docs only: no kernel, contract, coordinator or app code.

Built Nov 14–22:

- **Web:** all UI screens, simulation lab, machines page, typed API client, WizardConnect, researcher flow and browser worker on the real API.
- **Kernel:** deterministic neutron transport in Rust/WASM with golden-hash tests (native + WASM), then the Ising 2D and SIR epidemic templates.
- **Contracts:** NovaEscrow with payout / close / refund, replay tests, chipnet demo and golden vectors shared with the coordinator.
- **Coordinator:** BCH primitives matching the contract vectors, Fulcrum client, jobs, scheduler, verification, payouts, template-aware results, chipnet e2e binary, Docker image.
- **Proof:** three chipnet end-to-end runs (above); deploy config for Render.

## Run locally

Needs Rust (stable), Node 24 and pnpm 11.

```bash
# 1. Coordinator (http://localhost:8080)
cp .env.example .env     # set NETWORK=chipnet, ORACLE_WIF, FEE_WIF (two different chipnet keys)
                         # and CORS_ORIGIN=http://localhost:5173
cargo run -p nova-coordinator

# 2. Web app (http://localhost:5173)
cd web
pnpm install
VITE_API_URL=http://localhost:8080 pnpm dev
```

The simulation lab works without the coordinator. Tests: `cargo test` (kernel + coordinator),
`pnpm test` in `web/` and `contracts/`. Chipnet e2e without a browser:
`cargo run -p nova-coordinator --bin e2e -- --template ising --chunks 8 --price 1200`
(the fee wallet must be funded; it prints how much it needs).

## Roadmap

- **GPU workers:** a native/WebGPU provider so idle GPUs take the large pieces.
- **Researcher-set parallelism and verification:** choose piece count, and 2-of-2, 2-of-3 or spot-check verification per job, traded off against price.
- **Custom WASM jobs:** researchers upload their own deterministic WASM kernel against a fixed ABI.

## License

[MIT](LICENSE)
