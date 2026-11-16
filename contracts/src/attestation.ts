/**
 * Oracle attestations for NovaEscrow.payout and NovaEscrow.close.
 *
 * Payout message (140 bytes):
 *   jobId(32) ‖ outpointTxHash(32) ‖ outpointIndex(4, LE) ‖ workerA_pkh(20) ‖ workerB_pkh(20) ‖ resultHash(32)
 *
 * outpointTxHash is in the transaction's *internal* byte order, i.e. the txid as shown by
 * explorers, reversed: that is what the contract's `tx.inputs[i].outpointTransactionHash`
 * (OP_OUTPOINTTXHASH) returns. The contract builds outpointIndex with toPaddedBytes(index, 4),
 * which is little-endian for non-negative values. Both are proven by tests.
 *
 * Signatures are BCH data signatures: Schnorr over sha256(message), exactly what
 * OP_CHECKDATASIG verifies. libauth's Schnorr signing is deterministic (RFC 6979-style nonce),
 * so the same key and message always give the same signature.
 */
import { flattenBinArray as concatBins, hexToBin, secp256k1, sha256 } from "@bitauth/libauth";

export interface Outpoint {
  txid: string; // as displayed by explorers / returned by the SDK
  vout: number;
}

export interface PayoutAttestationInput {
  jobId: Uint8Array; // 32
  outpoint: Outpoint;
  workerA: Uint8Array; // pkh, 20
  workerB: Uint8Array; // pkh, 20
  resultHash: Uint8Array; // 32
}

export const CLOSE_TAG = new TextEncoder().encode("close"); // 0x636c6f7365

/** txid (display order) → the 32 bytes OP_OUTPOINTTXHASH pushes (internal order). */
export function outpointTxHash(txid: string): Uint8Array {
  const bin = hexToBin(txid);
  if (bin.length !== 32) throw new Error("txid must be 32 bytes");
  return bin.reverse();
}

export function u32le(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("index must be a u32");
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

function expectLength(name: string, b: Uint8Array, n: number) {
  if (b.length !== n) throw new Error(`${name} must be ${n} bytes, got ${b.length}`);
}

export function payoutMessage(a: PayoutAttestationInput): Uint8Array {
  expectLength("jobId", a.jobId, 32);
  expectLength("workerA", a.workerA, 20);
  expectLength("workerB", a.workerB, 20);
  expectLength("resultHash", a.resultHash, 32);
  const msg = concatBins([a.jobId, outpointTxHash(a.outpoint.txid), u32le(a.outpoint.vout), a.workerA, a.workerB, a.resultHash]);
  if (msg.length !== 140) throw new Error("attestation message must be 140 bytes");
  return msg;
}

export function closeMessage(jobId: Uint8Array): Uint8Array {
  expectLength("jobId", jobId, 32);
  return concatBins([jobId, CLOSE_TAG]);
}

/** BCH data signature (as checked by OP_CHECKDATASIG): Schnorr over sha256(message), 64 bytes. */
export function signData(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  const sig = secp256k1.signMessageHashSchnorr(privateKey, sha256.hash(message));
  if (typeof sig === "string") throw new Error(sig);
  return sig;
}

export function verifyData(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return secp256k1.verifySignatureSchnorr(signature, publicKey, sha256.hash(message));
}

export const signPayoutAttestation = (oraclePrivateKey: Uint8Array, a: PayoutAttestationInput) =>
  signData(oraclePrivateKey, payoutMessage(a));

export const signCloseAttestation = (oraclePrivateKey: Uint8Array, jobId: Uint8Array) =>
  signData(oraclePrivateKey, closeMessage(jobId));
