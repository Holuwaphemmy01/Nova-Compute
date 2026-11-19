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
