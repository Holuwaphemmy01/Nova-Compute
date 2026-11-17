/**
 * Browser-side transaction building for the researcher's wallet: UTXO discovery over the
 * wallet's HD addresses, the escrow funding tx and the close sweep. Everything is built with the
 * CashScript SDK and handed to the wallet as a WizardConnect transaction (with inputPaths); the
 * wallet signs. No private keys ever exist in the browser.
 */
import { binToHex, hexToBin } from "@bitauth/libauth";
import {
  Contract,
  ElectrumNetworkProvider,
  Network,
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  placeholderPublicKey,
  placeholderSignature,
  type SpendableUtxo,
} from "cashscript";
import artifact from "../contracts/NovaEscrow.json" with { type: "json" };
import type { CloseInfo, Job } from "../api/client";
import { NETWORK } from "../config/env";
import { fmt } from "../lib/random";
import { CHANGE, RECEIVE, addressOfPubkey, type PathName, type WizardTx } from "./wizard";

let provider: ElectrumNetworkProvider | null = null;
export function chainProvider(): ElectrumNetworkProvider {
  provider ??= new ElectrumNetworkProvider(NETWORK === "mainnet" ? Network.MAINNET : Network.CHIPNET);
  return provider;
}

export class NotEnoughFunds extends Error {
  readonly need: number;
  readonly have: number;
  constructor(need: number, have: number) {
    super(`Not enough BCH: need ${fmt(need)} sats, your wallet has ${fmt(have)} sats.`);
    this.name = "NotEnoughFunds";
    this.need = need;
    this.have = have;
  }
}

export interface WalletUtxo extends SpendableUtxo {
  address: string;
  path: PathName;
  index: number;
}

type GetPubkey = (child: number, index: bigint) => Uint8Array | undefined;

/** Finds spendable BCH (non-token) UTXOs on the wallet's first receive and change addresses. */
export async function discoverUtxos(getPubkey: GetPubkey, receive = 20, change = 10): Promise<WalletUtxo[]> {
  const slots: { address: string; path: PathName; index: number }[] = [];
  for (const [child, path, n] of [[RECEIVE, "receive", receive], [CHANGE, "change", change]] as const) {
    for (let i = 0; i < n; i++) {
      const pub = getPubkey(child, BigInt(i));
      if (pub) slots.push({ address: addressOfPubkey(pub).address, path, index: i });
    }
  }
  if (slots.length === 0) throw new Error("Your wallet didn't share any addresses. Reconnect it and try again.");
  const p = chainProvider();
  const found = await Promise.all(slots.map(async (s) => (await p.getUtxos(s.address)).filter((u) => !u.token).map((u) => ({ ...u, ...s }))));
  return found.flat();
}

export interface FundingPlan {
  tx: WizardTx;
  /** Sats locked in escrow. */
  locked: number;
  fee: number;
  inputs: number;
}

/** Funding tx: chunk_count outputs of per_chunk_value to the escrow, change back to the wallet. */
export function buildFunding(job: Pick<Job, "escrow_address" | "chunk_count" | "per_chunk_value">, utxos: WalletUtxo[], changeAddress: string): FundingPlan {
  const locked = job.chunk_count * job.per_chunk_value;
  const have = utxos.reduce((s, u) => s + Number(u.satoshis), 0);
  const sorted = [...utxos].sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const estFee = (n: number) => 60 + 150 * n + 44 * (job.chunk_count + 1);
  const selected: WalletUtxo[] = [];
  let total = 0;
  for (const u of sorted) {
    if (total >= locked + estFee(selected.length)) break;
    selected.push(u);
    total += Number(u.satoshis);
  }
  if (total < locked + estFee(selected.length)) throw new NotEnoughFunds(locked + estFee(selected.length), have);

  const builder = new TransactionBuilder({ provider: chainProvider() });
  for (const u of selected) builder.addInput(u, placeholderP2PKHUnlocker(u.address));
  builder.addOutputs(Array.from({ length: job.chunk_count }, () => ({ to: job.escrow_address, amount: BigInt(job.per_chunk_value) })));
  builder.addBchChangeOutputIfNeeded({ to: changeAddress, feeRate: 1 });
  const fee = Number(builder.calculateTransactionFee().feeSats);
  const transaction = builder.generateWcTransactionObject({
    broadcast: false,
    userPrompt: `Lock ${fmt(locked)} sats in Nova escrow for ${job.chunk_count} pieces`,
  });
  return { tx: { transaction, inputPaths: selected.map((u, i) => [i, u.path, u.index]) }, locked, fee, inputs: selected.length };
}

/** The job's escrow contract, rebuilt in the browser. Throws if it doesn't match the job's address. */
export function escrowContract(job: Job, researcherPkh: string, oraclePubkey: string) {
  const contract = new Contract(
    artifact,
    [hexToBin(researcherPkh), hexToBin(oraclePubkey), hexToBin(job.job_id), BigInt(job.price_per_worker), BigInt(job.refund_after)],
    { provider: chainProvider() },
  );
  if (contract.address !== job.escrow_address) {
    throw new Error("The escrow details don't match this job's escrow address, so Nova won't build a transaction for it.");
  }
  return contract;
}

export interface SweepPlan {
  tx: WizardTx;
  returned: number;
  fee: number;
  pieces: number;
}

/** close(pk, sig, oracleClose) sweep of the remaining chunk UTXOs back to the researcher (receive/0). */
export function buildCloseSweep(job: Job, close: CloseInfo, researcherPkh: string, to: string): SweepPlan {
  if (close.remaining.length === 0) throw new Error("There's nothing left in this job's escrow.");
  const contract = escrowContract(job, researcherPkh, close.oracle_pubkey);
  const unlocker = contract.unlock.close(placeholderPublicKey(), placeholderSignature(), hexToBin(close.oracle_close_signature));
  const builder = new TransactionBuilder({ provider: chainProvider() });
  for (const r of close.remaining) {
    builder.addInput({ txid: r.txid, vout: r.vout, satoshis: BigInt(r.value), lockingBytecode: contract.lockingBytecode }, unlocker);
  }
  builder.addBchChangeOutputIfNeeded({ to, feeRate: 1 });
  const total = close.remaining.reduce((s, r) => s + r.value, 0);
  const fee = Number(builder.calculateTransactionFee().feeSats);
  const transaction = builder.generateWcTransactionObject({ broadcast: false, userPrompt: `Return ${fmt(total - fee)} sats of unused Nova escrow to your wallet` });
  // The researcher key is the wallet's receive/0 (it funded the job from that address).
  return { tx: { transaction, inputPaths: close.remaining.map((_, i) => [i, "receive", 0]) }, returned: total - fee, fee, pieces: close.remaining.length };
}

/** Broadcasts a signed tx directly to the network; returns the txid. */
export async function broadcast(signedHex: string): Promise<string> {
  return chainProvider().sendRawTransaction(signedHex);
}

export const toHex = binToHex;
