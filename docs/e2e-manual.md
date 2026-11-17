# Manual chipnet end-to-end

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
