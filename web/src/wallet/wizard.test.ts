import { readFileSync } from "node:fs";
import { hexToBin, secp256k1 } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { addressOfPubkey, networkHint } from "./wizard";

describe("wallet address derivation", () => {
  it("matches the Rust coordinator's key → P2PKH derivation", () => {
    const v = JSON.parse(readFileSync(new URL("../../../contracts/vectors/rust-p2pkh.json", import.meta.url), "utf8"));
    const pub = secp256k1.derivePublicKeyCompressed(hexToBin(v.privateKeyHex));
    if (typeof pub === "string") throw new Error(pub);
    const { address, pkh } = addressOfPubkey(pub);
    // P2PKH locking bytecode = 76 a9 14 <pkh> 88 ac
    expect(`76a914${pkh}88ac`).toBe(v.utxo.lockingBytecodeHex);
    expect(address).toMatch(/^bchtest:q[0-9a-z]{41}$/);
  });

  it("reads a network hint from the xpub prefix", () => {
    expect(networkHint("tpubD6NzVbkrYhZ4X...")).toBe("chipnet");
    expect(networkHint("xpub661MyMwAqRbc...")).toBe("mainnet");
    expect(networkHint(undefined)).toBeNull();
    expect(networkHint("zpub...")).toBeNull();
  });
});
