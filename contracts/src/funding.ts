import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from "cashscript";
import { chunkValue, type EscrowContract } from "./escrow.js";
import { signatureTemplate, type Keypair } from "./keys.js";

export interface FundingInput {
  provider: NetworkProvider;
  contract: EscrowContract;
  funder: Keypair;
  /** Funder's P2PKH address on the provider's network (change goes back here). */
  funderAddress: string;
  chunks: number;
  pricePerWorker: bigint;
  /** Funder UTXOs to spend; defaults to all UTXOs at funderAddress. */
  utxos?: SpendableUtxo[];
  feeRate?: number; // sats/byte, default 1
}

export interface FundingTx {
  builder: TransactionBuilder;
  hex: string;
  /** Output indexes 0..chunks-1 are the chunk UTXOs; index `chunks` is change (if any). */
  chunkValue: bigint;
  chunks: number;
}

/** Builds a funding tx that creates N identical chunk UTXOs at the escrow address. */
export async function buildFundingTx(f: FundingInput): Promise<FundingTx> {
  if (!Number.isInteger(f.chunks) || f.chunks < 1) throw new Error("chunks must be >= 1");
  const value = chunkValue(f.pricePerWorker);
  const needed = value * BigInt(f.chunks);
  const feeRate = f.feeRate ?? 1;

  const all = (f.utxos ?? (await f.provider.getUtxos(f.funderAddress))).filter((u) => !u.token);
  all.sort((a, b) => (a.satoshis > b.satoshis ? -1 : a.satoshis < b.satoshis ? 1 : 0));

  // Largest-first selection; reserve a generous fee estimate (P2PKH input ~150 B, P2SH32 output ~44 B).
  const selected: SpendableUtxo[] = [];
  let total = 0n;
  for (const u of all) {
    selected.push(u);
    total += u.satoshis;
    const fee = BigInt(Math.ceil((60 + 150 * selected.length + 44 * (f.chunks + 1)) * feeRate));
    if (total >= needed + fee) break;
  }
  const estFee = BigInt(Math.ceil((60 + 150 * selected.length + 44 * (f.chunks + 1)) * feeRate));
  if (total < needed + estFee) {
    throw new Error(`Insufficient funds: have ${total} sats, need ${needed + estFee} (${f.chunks} × ${value} + fee)`);
  }

  const builder = new TransactionBuilder({ provider: f.provider })
    .addInputs(selected, signatureTemplate(f.funder).unlockP2PKH())
    .addOutputs(Array.from({ length: f.chunks }, () => ({ to: f.contract.address, amount: value })))
    .addBchChangeOutputIfNeeded({ to: f.funderAddress, feeRate });

  return { builder, hex: builder.build(), chunkValue: value, chunks: f.chunks };
}
