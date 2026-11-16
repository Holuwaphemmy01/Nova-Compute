/**
 * Chipnet end-to-end: fund a job with 3 chunk UTXOs, pay chunk 0 to two fresh workers with an
 * oracle attestation, then close the job (sweep chunks 1 and 2 back to the funder).
 *
 * Needs contracts/.env (gitignored) with chipnet TEST keys:
 *   CHIPNET_WIF=...   funder / researcher (needs ~10,000 chipnet sats)
 *   ORACLE_WIF=...    coordinator oracle key
 *   NETWORK=chipnet
 * Usage: pnpm chipnet:demo
 */
import { sha256 } from "@bitauth/libauth";
import { ElectrumNetworkProvider, Network, type SpendableUtxo } from "cashscript";
import {
  buildCloseTx,
  buildFundingTx,
  buildPayoutTx,
  escrowContract,
  keypairFromWif,
  p2pkhAddress,
  randomKeypair,
  signCloseAttestation,
  signPayoutAttestation,
} from "../src/index.js";

const EXPLORER = "https://chipnet.imaginary.cash/tx/";
const PRICE = 1200n;
const CHUNKS = 3;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Put chipnet test keys in contracts/.env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  if ((process.env.NETWORK ?? "chipnet") !== "chipnet") {
    console.error("This demo only runs on chipnet (NETWORK=chipnet).");
    process.exit(1);
  }
  const funder = keypairFromWif(required("CHIPNET_WIF"));
  const oracle = keypairFromWif(required("ORACLE_WIF"));
  const funderAddress = p2pkhAddress(funder.pkh, "bchtest");
  const provider = new ElectrumNetworkProvider(Network.CHIPNET);

  const jobId = sha256.hash(new TextEncoder().encode(`nova-chipnet-demo/${Date.now()}`));
  const refundAfter = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
  const contract = escrowContract({ researcherPkh: funder.pkh, oraclePk: oracle.publicKey, jobId, pricePerWorker: PRICE, refundAfter }, provider);
  console.log(`funder:   ${funderAddress}`);
  console.log(`escrow:   ${contract.address} (${contract.bytesize}-byte redeem script)`);

  // 1. Fund 3 chunk UTXOs.
  const funding = await buildFundingTx({ provider, contract, funder, funderAddress, chunks: CHUNKS, pricePerWorker: PRICE });
  const fundingTxid = await provider.sendRawTransaction(funding.hex);
  console.log(`\nfunding  ${fundingTxid}\n         ${EXPLORER}${fundingTxid}`);
  const chunk = (vout: number): SpendableUtxo => ({ txid: fundingTxid, vout, satoshis: funding.chunkValue, lockingBytecode: contract.lockingBytecode });

  // 2. Pay chunk 0 to two fresh workers with the oracle's attestation.
  const workerA = randomKeypair();
  const workerB = randomKeypair();
  const resultHash = sha256.hash(new TextEncoder().encode("nova-chipnet-demo/chunk-0-result"));
  const attestation = signPayoutAttestation(oracle.privateKey, {
    jobId,
    outpoint: { txid: fundingTxid, vout: 0 },
    workerA: workerA.pkh,
    workerB: workerB.pkh,
    resultHash,
  });
  const payout = buildPayoutTx({ provider, contract, utxo: chunk(0), attestation, workerA: workerA.pkh, workerB: workerB.pkh, resultHash, pricePerWorker: PRICE });
  const payoutTxid = await provider.sendRawTransaction(payout.hex);
  console.log(`\npayout   ${payoutTxid}\n         ${EXPLORER}${payoutTxid}`);
  console.log(`         workerA ${p2pkhAddress(workerA.pkh, "bchtest")} +${PRICE} sats`);
  console.log(`         workerB ${p2pkhAddress(workerB.pkh, "bchtest")} +${PRICE} sats`);

  // 3. Close the job: sweep chunks 1 and 2 back to the funder.
  const oracleClose = signCloseAttestation(oracle.privateKey, jobId);
  const close = buildCloseTx({ provider, contract, utxos: [chunk(1), chunk(2)], researcher: funder, to: funderAddress, oracleClose });
  const closeTxid = await provider.sendRawTransaction(close.hex);
  console.log(`\nclose    ${closeTxid}\n         ${EXPLORER}${closeTxid}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
