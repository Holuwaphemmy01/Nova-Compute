import {
  binToHex,
  decodePrivateKeyWif,
  encodeCashAddress,
  encodeLockingBytecodeP2pkh,
  encodePrivateKeyWif,
  generatePrivateKey,
  hash160,
  secp256k1,
  sha256,
} from "@bitauth/libauth";
import { SignatureTemplate } from "cashscript";

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 33-byte compressed
  pkh: Uint8Array; // hash160(publicKey)
  /** P2PKH locking bytecode (what LockingBytecodeP2PKH(pkh) produces in the contract). */
  lockingBytecode: Uint8Array;
}

export function keypairFromPrivateKey(privateKey: Uint8Array): Keypair {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === "string") throw new Error(publicKey);
  const pkh = hash160(publicKey);
  return { privateKey, publicKey, pkh, lockingBytecode: encodeLockingBytecodeP2pkh(pkh) };
}

export function keypairFromWif(wif: string): Keypair {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === "string") throw new Error(`Invalid WIF: ${decoded}`);
  return keypairFromPrivateKey(decoded.privateKey);
}

/** Deterministic test key from a label: sha256(label). For tests and vectors only. */
export function testKeypair(label: string): Keypair {
  return keypairFromPrivateKey(sha256.hash(new TextEncoder().encode(label)));
}

export function randomKeypair(): Keypair {
  return keypairFromPrivateKey(generatePrivateKey());
}

export function toWif(k: Keypair, network: "mainnet" | "testnet" = "testnet"): string {
  return encodePrivateKeyWif(k.privateKey, network);
}

export type Prefix = "bitcoincash" | "bchtest" | "bchreg";

export function p2pkhAddress(pkh: Uint8Array, prefix: Prefix = "bchtest"): string {
  return encodeCashAddress({ prefix, type: "p2pkh", payload: pkh }).address;
}

export function signatureTemplate(k: Keypair): SignatureTemplate {
  return new SignatureTemplate(k.privateKey);
}

export const hex = binToHex;
