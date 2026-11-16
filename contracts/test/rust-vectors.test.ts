/**
 * Cross-checks transactions produced by the Rust coordinator against CashScript's VM.
 * (vectors/rust-p2pkh.json is written by coordinator/tests/p2pkh_vector.rs.)
 */
import { readFileSync } from "node:fs";
import { MockNetworkProvider } from "cashscript";
import { describe, expect, it } from "vitest";

const v = JSON.parse(readFileSync(new URL("../vectors/rust-p2pkh.json", import.meta.url), "utf8"));

describe("Rust coordinator transactions", () => {
  it("a Rust-signed P2PKH (ECDSA, SIGHASH_ALL|FORKID) OP_RETURN tx is valid in the BCH VM", async () => {
    const provider = new MockNetworkProvider();
    provider.addUtxo(v.utxo.lockingBytecodeHex, { txid: v.utxo.txid, vout: v.utxo.vout, satoshis: BigInt(v.utxo.satoshis) });
    await expect(provider.sendRawTransaction(v.txHex)).resolves.toBe(v.txid);
  });

  it("a tampered Rust tx is rejected (the check is real)", async () => {
    const provider = new MockNetworkProvider();
    provider.addUtxo(v.utxo.lockingBytecodeHex, { txid: v.utxo.txid, vout: v.utxo.vout, satoshis: BigInt(v.utxo.satoshis) + 1n });
    await expect(provider.sendRawTransaction(v.txHex)).rejects.toThrow();
  });
});
