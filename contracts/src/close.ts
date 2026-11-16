import { TransactionBuilder, type NetworkProvider, type SpendableUtxo } from "cashscript";
import type { EscrowContract } from "./escrow.js";
import { signatureTemplate, type Keypair } from "./keys.js";

export interface SweepInput {
  provider: NetworkProvider;
  contract: EscrowContract;
  /** Remaining chunk UTXOs to sweep. */
  utxos: SpendableUtxo[];
  researcher: Keypair;
  /** Where the swept funds go (usually the researcher's address). */
  to: string;
  feeRate?: number;
}

export interface SweepTx {
  builder: TransactionBuilder;
  hex: string;
}

function sweep(builder: TransactionBuilder, s: SweepInput): SweepTx {
  builder.addBchChangeOutputIfNeeded({ to: s.to, feeRate: s.feeRate ?? 1 });
  return { builder, hex: builder.build() };
}

/** Closes a job: researcher signature + oracle "close" attestation sweep the remaining chunks. */
export function buildCloseTx(s: SweepInput & { oracleClose: Uint8Array }): SweepTx {
  if (s.utxos.length === 0) throw new Error("nothing to close");
  const unlocker = s.contract.unlock.close(s.researcher.publicKey, signatureTemplate(s.researcher), s.oracleClose);
  return sweep(new TransactionBuilder({ provider: s.provider }).addInputs(s.utxos, unlocker), s);
}
