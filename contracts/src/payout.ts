import { encodeLockingBytecodeP2pkh } from "@bitauth/libauth";
import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from "cashscript";
import type { EscrowContract } from "./escrow.js";

export interface PayoutInput {
  provider: NetworkProvider;
  contract: EscrowContract;
  /** The chunk's escrow UTXO. */
  utxo: SpendableUtxo;
  /** Oracle data signature over the payout message for this exact UTXO. */
  attestation: Uint8Array;
  workerA: Uint8Array; // pkh
  workerB: Uint8Array; // pkh
  resultHash: Uint8Array; // 32
  pricePerWorker: bigint;
  /** Override output amounts (tests only). */
  amounts?: [bigint, bigint];
}

export interface PayoutTx {
  builder: TransactionBuilder;
  hex: string;
}

/**
 * Builds the signed payout for one chunk: output 0 → workerA, output 1 → workerB, no change.
 * The rest of the chunk UTXO (the fee margin) is the miner fee, so no wallet is needed.
 */
export function buildPayoutTx(p: PayoutInput): PayoutTx {
  const [a, b] = p.amounts ?? [p.pricePerWorker, p.pricePerWorker];
  const builder = new TransactionBuilder({ provider: p.provider })
    .addInput(p.utxo, p.contract.unlock.payout(p.attestation, p.workerA, p.workerB, p.resultHash))
    .addOutputs([
      { to: encodeLockingBytecodeP2pkh(p.workerA), amount: a },
      { to: encodeLockingBytecodeP2pkh(p.workerB), amount: b },
    ]);
  return { builder, hex: builder.build() };
}
