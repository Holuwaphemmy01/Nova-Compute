import { readFileSync } from "node:fs";
import { hexToBin } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { describe, expect, it } from "vitest";
import { makePayoutVector } from "../src/vectors.js";
import { escrowContract, verifyData } from "../src/index.js";

const committed = JSON.parse(readFileSync(new URL("../vectors/payout.json", import.meta.url), "utf8"));

describe("golden payout vector", () => {
  it("is reproducible: regenerating gives exactly the committed vectors/payout.json", () => {
    expect(JSON.parse(JSON.stringify(makePayoutVector()))).toEqual(committed);
    expect(JSON.parse(JSON.stringify(makePayoutVector()))).toEqual(committed); // twice: no hidden randomness
  });

  it("has a valid oracle signature and a tx the VM accepts", async () => {
    const v = committed;
    expect(verifyData(hexToBin(v.testKeys.oraclePublicKey), hexToBin(v.attestation.messageHex), hexToBin(v.attestation.signatureHex))).toBe(true);
    expect(v.attestation.messageBytes).toBe(140);

    const provider = new MockNetworkProvider();
    const contract = escrowContract(
      {
        researcherPkh: hexToBin(v.contract.params.researcherPkh),
        oraclePk: hexToBin(v.contract.params.oraclePk),
        jobId: hexToBin(v.contract.params.jobId),
        pricePerWorker: BigInt(v.contract.params.pricePerWorker),
        refundAfter: BigInt(v.contract.params.refundAfter),
      },
      provider,
    );
    expect(contract.lockingBytecode).toBe(v.contract.lockingBytecodeHex);
    provider.addUtxo(contract.address, { txid: v.input.txid, vout: v.input.vout, satoshis: BigInt(v.input.satoshis) });
    await expect(provider.sendRawTransaction(v.tx.hex)).resolves.toBe(v.tx.txid);
  });
});
