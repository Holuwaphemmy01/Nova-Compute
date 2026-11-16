import { TransactionBuilder } from "cashscript";
import type { SweepInput, SweepTx } from "./close.js";
import { signatureTemplate } from "./keys.js";

export type { SweepInput, SweepTx };

/**
 * Researcher-only refund once `refundAfter` has passed (oracle unavailable).
 * `locktime` must be >= the contract's refundAfter; the network only accepts the tx once
 * that block height / time has actually been reached.
 */
export function buildRefundTx(s: SweepInput & { locktime: number }): SweepTx {
  if (s.utxos.length === 0) throw new Error("nothing to refund");
  const unlocker = s.contract.unlock.refund(s.researcher.publicKey, signatureTemplate(s.researcher));
  const builder = new TransactionBuilder({ provider: s.provider }).addInputs(s.utxos, unlocker).setLocktime(s.locktime);
  builder.addBchChangeOutputIfNeeded({ to: s.to, feeRate: s.feeRate ?? 1 });
  return { builder, hex: builder.build() };
}
