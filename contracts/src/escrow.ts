import { Contract, type NetworkProvider } from "cashscript";
import artifact from "../artifacts/NovaEscrow.json" with { type: "json" };

export { artifact };

export interface EscrowParams {
  researcherPkh: Uint8Array; // bytes20
  oraclePk: Uint8Array; // pubkey (33 bytes)
  jobId: Uint8Array; // bytes32
  pricePerWorker: bigint; // sats per worker per chunk
  refundAfter: bigint; // nLockTime threshold (block height < 500M, else unix time)
}

/**
 * Fee margin left in each chunk UTXO; it pays the payout transaction's miner fee.
 * A payout tx is 509 bytes (it carries the 245-byte redeem script), so 500 sats would be
 * 0.98 sat/B, below the 1 sat/B relay minimum. 600 sats ≈ 1.18 sat/B.
 */
export const FEE_MARGIN = 600n;

/** Value of one chunk UTXO: two workers' pay plus the fee margin. */
export const chunkValue = (price: bigint) => 2n * price + FEE_MARGIN;

export type EscrowContract = Contract<typeof artifact>;

export function escrowContract(p: EscrowParams, provider: NetworkProvider): EscrowContract {
  if (p.researcherPkh.length !== 20) throw new Error("researcherPkh must be 20 bytes");
  if (p.jobId.length !== 32) throw new Error("jobId must be 32 bytes");
  return new Contract(artifact, [p.researcherPkh, p.oraclePk, p.jobId, p.pricePerWorker, p.refundAfter], { provider });
}
