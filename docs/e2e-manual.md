# Chipnet end-to-end

## Coordinator run: done (Nov 20, 2026)

`cargo run -p nova-coordinator --bin e2e -- --chunks 4 --price 1200` on chipnet. The real
coordinator funded a 4-chunk job from its fee wallet, two in-process workers (native kernel, different
payout addresses) computed every chunk, all 4 hashes matched, and it broadcast 4 payouts and the
Merkle-root OP_RETURN. Each tx was then checked independently against a public chipnet Fulcrum
(`chipnet.bch.ninja`): each payout spends its own escrow output and pays 2 × 1,200 sats, and the
network accepted it, so the NovaEscrow contract script passed on chain.

- Job: `5c6b9b7a9dda033d10389cd013cd69e6b58f9b5fffa79b4137db591bef48cbf5`
- Escrow: `bchtest:p0ztzmyzwqxpvw92z54l5wf8xxzntxe4cg6jc73qjaqf3zjzzusqg93kmjvxa`
- Workers: `bchtest:qzkyp6k4kyz2vm09falmqqqkgux77zz3rshsa9xqq7`, `bchtest:qp5rws6w2zt6hf5wuntn038tz6jeu9tguq3xyvspkx`
- Merkle root: `c172fa784c380cf5ce74fa4f6dba810ec166b1fda230093c5b0491d1f5646660`
- Result: 11.11 % transmitted ± 0.16 % over 40,000 particles

| Step | Txid |
|---|---|
| Funding (4 × 3,000 sats → escrow) | [`b74aed33b3e144fa73a450b8214aac0e4fee5d64d6118c37c94462691d66c8c1`](https://chipnet.imaginary.cash/tx/b74aed33b3e144fa73a450b8214aac0e4fee5d64d6118c37c94462691d66c8c1) |
| Payout chunk 0 | [`150f83a597ad1371ceb31a1a91db59aa72c4928391dbb4c37056ff9bf845cad7`](https://chipnet.imaginary.cash/tx/150f83a597ad1371ceb31a1a91db59aa72c4928391dbb4c37056ff9bf845cad7) |
| Payout chunk 1 | [`55dc97fcb7a6f4ccee3f9c1f7729c98c12f9ef157c3cdf91bdce72f3b4e1f4c3`](https://chipnet.imaginary.cash/tx/55dc97fcb7a6f4ccee3f9c1f7729c98c12f9ef157c3cdf91bdce72f3b4e1f4c3) |
| Payout chunk 2 | [`0d4c199dd1a984736770e486b2816130f9697a42387c6fe0a9c77e9e051c3b23`](https://chipnet.imaginary.cash/tx/0d4c199dd1a984736770e486b2816130f9697a42387c6fe0a9c77e9e051c3b23) |
| Payout chunk 3 | [`19b7872cf9f357e96ce09281b1ff2942119243aab087f3dfb3b07cc10852e6b1`](https://chipnet.imaginary.cash/tx/19b7872cf9f357e96ce09281b1ff2942119243aab087f3dfb3b07cc10852e6b1) |
| OP_RETURN proof | [`82456f8d45c1d2269db6e2c37184872ef676f77c5f0bf0f9bfd1d7c0b3b37c9a`](https://chipnet.imaginary.cash/tx/82456f8d45c1d2269db6e2c37184872ef676f77c5f0bf0f9bfd1d7c0b3b37c9a) |

The browser + wallet run below is the remaining manual check.

---

# Manual chipnet end-to-end (browser + wallets)

A full run of Nova on chipnet with real wallets: a researcher funds a 4-piece job from a
WizardConnect wallet, two browser workers compute it, both get paid, and the result is verified
against the Merkle root written on chain.

> **Status:** these steps have **not been run yet**. Fill in the txid table at the bottom
> after the run.

## What you need

- Rust + pnpm (see the root README), Chrome or another modern browser.
- **Three wallets that support WizardConnect** on **chipnet**, each with its own address:
  - **A, researcher:** about 13,000 chipnet sats (12,000 locked plus fees).
  - **B and C, providers:** no funds needed; they receive payouts.
  Paytaca is the wallet named in the CashScript docs for WizardConnect; confirm your version
  offers WizardConnect and a chipnet mode.
- **Two coordinator keys** (chipnet WIFs, different from each other and from the wallets):
  - `ORACLE_WIF`: signs attestations. Needs no funds.
  - `FEE_WIF`: pays the final OP_RETURN. Needs about 5,000 chipnet sats.
- Chipnet coins from a faucet, e.g. <https://tbch.googol.cash>.
- Three separate browser sessions: e.g. Chrome, a second Chrome profile, and Firefox. Private
  windows of the same browser share nothing, so they also work.

## 1. Start the coordinator

Create `.env` in the repo root (it is gitignored):

```
NETWORK=chipnet
ORACLE_WIF=<chipnet WIF>
FEE_WIF=<chipnet WIF, funded>
DATABASE_URL=sqlite://nova-e2e.db
PORT=8080
CORS_ORIGIN=http://localhost:5173
```

```bash
cargo run -p nova-coordinator
curl http://localhost:8080/health    # expect "fulcrum": "ok" and your fee_address
```

## 2. Start the web app

Create `web/.env.local`:

```
VITE_API_URL=http://localhost:8080
VITE_NETWORK=chipnet
```

```bash
cd web
pnpm install
pnpm dev                                 # http://localhost:5173
```

## 3. Browser A: researcher creates and funds a job

1. Open <http://localhost:5173/connect?role=researcher>. Scan the QR with wallet A, or tap
   **Open in wallet app** on the phone. Check that the address shown is wallet A's receive
   address, and that no network warning appears.
2. Go to **New job**. Set the wall thickness to **10 cm** and choose **40k** particles. That's
   4 pieces × 2 providers × 1,200 sats, plus 600 sats per piece for fees: **12,000 sats**.
3. Click **Fund and start**, then **Review funding**. The panel shows the sats to lock, the
   network fee and the escrow address.
4. Click **Lock 12,000 sats with my wallet** and approve in wallet A. The coordinator
   broadcasts the funding tx and the job turns **running**.
5. Write down the **funding txid**: it's in the explorer link on the job, or from
   `GET /api/v1/jobs/{id}`.

## 4. Browsers B and C: two providers start earning

In each of browsers B and C:

1. Open <http://localhost:5173/connect?role=provider> and connect wallet B (or C). The two
   addresses must differ, because each piece needs 2 different payout addresses.
2. Go to **Set up**. Every check should pass:
   - the kernel loads,
   - the device gives the same answer (GOLDEN),
   - WebGPU shows as info only,
   - payouts go to the connected wallet.
3. Click **Start earning**. The Earnings page shows "Working on piece N" with live particle
   tracks.

## 5. Watch it finish

- Browser A's **Live job** page: pieces go grey (queued), then black (running), then green
  (checked and paid). Each payout appears under *Latest payments* with an explorer link.
- About 2 seconds after the last payout, the job writes its proof (OP_RETURN) and turns
  **complete**.
- Browsers B and C, **Earnings**: each provider earned 4 × 1,200 = **4,800 sats**, and recent
  payouts link to the same 4 payout txids. Wallets B and C should show the incoming payments.

## 6. Verify the result

On browser A, open **See the result →**, then click **Check it on chain**:

1. The browser recomputes the Merkle root from the 4 piece fingerprints.
2. It fetches the OP_RETURN tx through `GET /api/v1/tx/{txid}`.
3. It shows **✓ Verified** only if the root on chain matches.

## 7. Optional: get unused funds back

Create a second small job, fund it, and click **Stop and get funds back** on its Results page
before the providers finish. The coordinator returns the oracle close signature. Wallet A then
signs a `close()` sweep of the unfinished pieces' escrow. This needs a wallet that fills
CashScript contract placeholders (`placeholderSignature` / `placeholderPublicKey`); the CashScript
docs say Paytaca does.

## Results (fill in after the run)

| Step | Txid | Explorer |
|---|---|---|
| Funding (A → escrow, 4 × 3,000 sats) | | |
| Payout piece 0 (B + C) | | |
| Payout piece 1 (B + C) | | |
| Payout piece 2 (B + C) | | |
| Payout piece 3 (B + C) | | |
| OP_RETURN proof (Merkle root) | | |
| Close sweep (optional) | | |

Explorer: `https://chipnet.imaginary.cash/tx/<txid>`

## Chipnet runs: Ising and SIR templates (2026-11-20)

Run with the scripted coordinator e2e (two workers, price 1,200 sats per piece):

```
cargo run -p nova-coordinator --bin e2e -- --template ising --chunks 8 --price 1200
cargo run -p nova-coordinator --bin e2e -- --template sir --chunks 4 --price 1200
```

Explorer: `https://chipnet.imaginary.cash/tx/<txid>`

### Ising 2D, 8 temperatures

Params: `L=32, t_min=1.5, t_max=3.5, eq_sweeps=1000, meas_sweeps=2000`.
Job `3b50412120316f8fed82fe52774f7457e578a21c370d7ef05657b8c4c3b90cb7`, escrow
`bchtest:pdhvwh6rctx88ve85r538ujqhv5gqrpjz2jrmgzfez658zh646rewhxverd3e`, 8 × 3,000 sats.

| Step | Txid |
|---|---|
| Funding | [aecab2520f17…de2e](https://chipnet.imaginary.cash/tx/aecab2520f1718fd7b883a421c9fddcf740a9e2ea35a59a166f0e5893045de2e) |
| Payout T=1.500 | [c8602100ab57…7b31](https://chipnet.imaginary.cash/tx/c8602100ab57e6783f0d3ffb859a907298209308408968dfe03c2a99fd347b31) |
| Payout T=1.786 | [229eeac1331e…72a0](https://chipnet.imaginary.cash/tx/229eeac1331ef358bc8004b11bd200b8d0d33d8fbf00e427ebd9afc0207972a0) |
| Payout T=2.071 | [4cdd6a765e4d…3d47](https://chipnet.imaginary.cash/tx/4cdd6a765e4d2dda28029bfdc2bd72bad44f9d7c4a7704d9326b0faa513c3d47) |
| Payout T=2.357 | [3c2989166245…3646](https://chipnet.imaginary.cash/tx/3c298916624d62547f32d7a644eaedea801fe9e2515014de5a895329f8823646) |
| Payout T=2.643 | [8fb760c974b1…aa33](https://chipnet.imaginary.cash/tx/8fb760c974b1bb56777a4fa127e435fc85632a353ea21d1faab9e709dc02aa33) |
| Payout T=2.929 | [5ffadb5ec298…ec8c](https://chipnet.imaginary.cash/tx/5ffadb5ec298baeecb9a4ac7c2a345b237966ddbcb895f6f70efd100ada9ec8c) |
| Payout T=3.214 | [cff54e73bb96…f2b9](https://chipnet.imaginary.cash/tx/cff54e73bb9623b32025e79de1f668ed36df9246277ccc536c3c47ff8d14f2b9) |
| Payout T=3.500 | [804deee95609…e39d](https://chipnet.imaginary.cash/tx/804deee95609d124a6fb73e48c6e72ff2d1a138a09f6ccc3580c8300cef1e39d) |
| OP_RETURN (Merkle `4c4ed740…3e22`) | [96b9259581a7…18cb](https://chipnet.imaginary.cash/tx/96b9259581a7c3dffc81d788217ba882578bfa4dcc6904a78d6cd4003d6818cb) |

| T | ⟨\|m\|⟩ | χ | C |
|---|---|---|---|
| 1.500 | 0.9863 | 0.03 | 0.207 |
| 1.786 | 0.9584 | 0.11 | 0.433 |
| 2.071 | 0.8832 | 0.54 | 0.837 |
| 2.357 | 0.4631 | 20.20 | 1.897 |
| 2.643 | 0.1357 | 3.94 | 0.702 |
| 2.929 | 0.0894 | 1.55 | 0.400 |
| 3.214 | 0.0714 | 0.91 | 0.302 |
| 3.500 | 0.0610 | 0.66 | 0.236 |

Estimated Tc ≈ 2.357 (χ peak on the 8-point grid; Onsager's exact value is 2.269, and the grid
spacing is 0.286, so the nearest grid point to 2.269 is 2.357).

### SIR epidemic, 4 pieces

Params: `population=10000, initial_infected=10, r0=2.5, recovery_days=7, runs_per_chunk=200`.
Job `89eca0b8f67612a1092928cf731d4eae700577871abf3f873a5bac5fda073647`, escrow
`bchtest:pd06r6mncth5w07hv9vqqtkrgwytjkddng7ja2g2ueaw0n7anr49vkqv73nms`, 4 × 3,000 sats.

| Step | Txid |
|---|---|
| Funding | [6e39a87c7610…74c2](https://chipnet.imaginary.cash/tx/6e39a87c761031bfa39b1d765852f7be39d99bbe8413053580cc4fb0f21c74c2) |
| Payout piece 0 | [6cba4e99b0a3…30d4](https://chipnet.imaginary.cash/tx/6cba4e99b0a3d661a07ac125dad1ce224befa4da5a13dc43becdf387bfed30d4) |
| Payout piece 1 | [3b6ffd0b5648…5c70](https://chipnet.imaginary.cash/tx/3b6ffd0b5648c640d4f3103657bfeaa06b53550baf6f7fff82ec0298fed35c70) |
| Payout piece 2 | [526e6be6e0ba…a3de](https://chipnet.imaginary.cash/tx/526e6be6e0ba554d54e443641218bb6c329ea5f2c8124cd5a57f532f1109a3de) |
| Payout piece 3 | [7a54113aa548…dea5](https://chipnet.imaginary.cash/tx/7a54113aa54835f3ec9412fb8f5387a78b8fb0865f45d4079d2b3fb549c5dea5) |
| OP_RETURN (Merkle `5776215f…19a6`) | [a75e1044578c…9bed](https://chipnet.imaginary.cash/tx/a75e1044578c54c4ea3eee831067dbc2e747c081cc4a338453a3413983869bed) |

Result over 800 outbreaks: P(major outbreak) = 1.000, mean final size of major outbreaks 0.893
(theory for R0 = 2.5: 0.893), mean peak day 34.5.

### Timing per piece

| Template | Native worker (incl. lease + submit round trip) | WASM in Node, compute only |
|---|---|---|
| Ising, L=32, 3,000 sweeps | 1.1–2.9 s | 115–127 ms |
| SIR, 200 outbreaks, N=10,000 | 2.8–3.8 s | 349–399 ms |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Can't reach the Nova coordinator" | Coordinator not running, or `VITE_API_URL` is wrong. |
| Requests blocked by CORS | `CORS_ORIGIN` must be exactly the web origin (`http://localhost:5173`). |
| `/health` shows `"fulcrum": "unreachable"` | Set `FULCRUM_URL=ssl://<host>:50002`; the default chipnet servers are tried as fallbacks. |
| QR scans but nothing connects | The wallet must support WizardConnect (not plain WalletConnect); both devices need internet access to the relay. |
| Yellow network banner after connecting | The wallet's keys look like mainnet keys; switch the wallet to chipnet and reconnect. |
| "Not enough BCH: need X sats" | Fund wallet A. Nova looks for coins on the first 20 receive and 10 change addresses. |
| Pieces stay grey | Fewer than 2 providers with different payout addresses are earning. |
| Job stuck in "finalizing" | `FEE_WIF` is empty: fund the `fee_address` from `/health`. The coordinator retries every 2 s. |
