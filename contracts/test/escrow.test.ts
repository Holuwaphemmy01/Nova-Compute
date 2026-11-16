import { binToHex, decodeTransaction, encodeLockingBytecodeP2pkh, hexToBin, sha256 } from "@bitauth/libauth";
import { MockNetworkProvider, randomUtxo, type SpendableUtxo } from "cashscript";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCloseTx,
  buildFundingTx,
  buildPayoutTx,
  buildRefundTx,
  chunkValue,
  FEE_MARGIN,
  closeMessage,
  escrowContract,
  outpointTxHash,
  p2pkhAddress,
  payoutMessage,
  signCloseAttestation,
  signData,
  signPayoutAttestation,
  testKeypair,
  verifyData,
  type EscrowContract,
  type EscrowParams,
} from "../src/index.js";

const researcher = testKeypair("researcher");
const oracle = testKeypair("oracle");
const mallory = testKeypair("mallory");
const workerA = testKeypair("workerA").pkh;
const workerB = testKeypair("workerB").pkh;
const PRICE = 1200n;
const REFUND_AFTER = 1_800_000_000n; // unix time (Jan 2027)
const jobId = sha256.hash(new TextEncoder().encode("job-1"));
const resultHash = sha256.hash(new TextEncoder().encode("result-1"));

const params: EscrowParams = { researcherPkh: researcher.pkh, oraclePk: oracle.publicKey, jobId, pricePerWorker: PRICE, refundAfter: REFUND_AFTER };

let provider: MockNetworkProvider;
let contract: EscrowContract;

beforeEach(() => {
  provider = new MockNetworkProvider();
  contract = escrowContract(params, provider);
});

const addChunk = (extra: Partial<SpendableUtxo> = {}) =>
  provider.addUtxo(contract.address, randomUtxo({ satoshis: chunkValue(PRICE), ...extra }));

const attest = (utxo: SpendableUtxo, a = workerA, b = workerB, key = oracle.privateKey) =>
  signPayoutAttestation(key, { jobId, outpoint: { txid: utxo.txid, vout: utxo.vout }, workerA: a, workerB: b, resultHash });

const payout = (utxo: SpendableUtxo, attestation: Uint8Array, a = workerA, b = workerB, amounts?: [bigint, bigint]) =>
  buildPayoutTx({ provider, contract, utxo, attestation, workerA: a, workerB: b, resultHash, pricePerWorker: PRICE, amounts });

/** The mock provider evaluates every broadcast against the real locking bytecode, like a node. */
const broadcast = (hex: string) => provider.sendRawTransaction(hex);

describe("payout", () => {
  it("succeeds with a valid attestation; both workers get >= price", async () => {
    const utxo = addChunk();
    const tx = payout(utxo, attest(utxo));
    await expect(broadcast(tx.hex)).resolves.toMatch(/^[0-9a-f]{64}$/);

    const decoded = decodeTransaction(hexToBin(tx.hex));
    if (typeof decoded === "string") throw new Error(decoded);
    expect(decoded.outputs).toHaveLength(2);
    expect(binToHex(decoded.outputs[0].lockingBytecode)).toBe(binToHex(encodeLockingBytecodeP2pkh(workerA)));
    expect(binToHex(decoded.outputs[1].lockingBytecode)).toBe(binToHex(encodeLockingBytecodeP2pkh(workerB)));
    for (const o of decoded.outputs) expect(o.valueSatoshis).toBeGreaterThanOrEqual(PRICE);
    // No change: the fee margin is the miner fee.
    expect(chunkValue(PRICE) - decoded.outputs[0].valueSatoshis - decoded.outputs[1].valueSatoshis).toBe(FEE_MARGIN);
    expect(await contract.getUtxos()).toHaveLength(0);
  });

  it("fails with an attestation from the wrong oracle key", async () => {
    const utxo = addChunk();
    const tx = payout(utxo, attest(utxo, workerA, workerB, mallory.privateKey));
    expect(() => tx.builder.debug()).toThrow(/bad attestation/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
  });

  it("fails when workerA == workerB, even with a valid oracle signature", async () => {
    const utxo = addChunk();
    const tx = payout(utxo, attest(utxo, workerA, workerA), workerA, workerA);
    expect(() => tx.builder.debug()).toThrow(/workers must differ/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
  });

  it("fails when an attestation is replayed on a different chunk UTXO", async () => {
    const chunk0 = addChunk();
    const chunk1 = addChunk();
    await broadcast(payout(chunk0, attest(chunk0)).hex);
    const replay = payout(chunk1, attest(chunk0)); // chunk0's attestation on chunk1
    expect(() => replay.builder.debug()).toThrow(/bad attestation/);
    await expect(broadcast(replay.hex)).rejects.toThrow();
  });

  it("fails when the worker order is swapped", async () => {
    const utxo = addChunk();
    const tx = payout(utxo, attest(utxo, workerA, workerB), workerB, workerA);
    expect(() => tx.builder.debug()).toThrow(/bad attestation/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
  });

  it("fails when an output pays below price", async () => {
    const utxo = addChunk();
    const lowA = payout(utxo, attest(utxo), workerA, workerB, [PRICE - 1n, PRICE]);
    expect(() => lowA.builder.debug()).toThrow(/output A below price/);
    await expect(broadcast(lowA.hex)).rejects.toThrow();
    const lowB = payout(utxo, attest(utxo), workerA, workerB, [PRICE, PRICE - 1n]);
    expect(() => lowB.builder.debug()).toThrow(/output B below price/);
  });

  it("allows paying more than price (fee margin permitting)", async () => {
    const utxo = addChunk();
    await expect(broadcast(payout(utxo, attest(utxo), workerA, workerB, [PRICE + 40n, PRICE + 40n]).hex)).resolves.toBeTruthy();
  });

  it("cannot pay two chunks with one shared output pair (each input binds outputs 2i, 2i+1)", async () => {
    const c0 = addChunk();
    const c1 = addChunk();
    const { TransactionBuilder } = await import("cashscript");
    const both = (outputs: number) => {
      const b = new TransactionBuilder({ provider })
        .addInput(c0, contract.unlock.payout(attest(c0), workerA, workerB, resultHash))
        .addInput(c1, contract.unlock.payout(attest(c1), workerA, workerB, resultHash));
      for (let i = 0; i < outputs / 2; i++) {
        b.addOutput({ to: encodeLockingBytecodeP2pkh(workerA), amount: PRICE });
        b.addOutput({ to: encodeLockingBytecodeP2pkh(workerB), amount: PRICE });
      }
      return b;
    };
    // Only outputs 0,1: input 1 has no outputs 2,3 → rejected (no value can be skimmed).
    expect(() => both(2).debug()).toThrow();
    await expect(broadcast(both(2).build())).rejects.toThrow();
    // Batched correctly: outputs 0,1 for chunk 0 and 2,3 for chunk 1.
    await expect(broadcast(both(4).build())).resolves.toBeTruthy();
  });
});

describe("attestation encoding (proves byte order against the contract)", () => {
  it("is 140 bytes: jobId ‖ txHash ‖ index LE ‖ workerA ‖ workerB ‖ resultHash", () => {
    const txid = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const m = payoutMessage({ jobId, outpoint: { txid, vout: 258 }, workerA, workerB, resultHash });
    expect(m).toHaveLength(140);
    expect(binToHex(m.slice(0, 32))).toBe(binToHex(jobId));
    expect(binToHex(m.slice(32, 64))).toBe(binToHex(hexToBin(txid).reverse()));
    expect(binToHex(m.slice(64, 68))).toBe("02010000"); // 258 little-endian
    expect(binToHex(m.slice(68, 88))).toBe(binToHex(workerA));
    expect(binToHex(m.slice(88, 108))).toBe(binToHex(workerB));
    expect(binToHex(m.slice(108))).toBe(binToHex(resultHash));
  });

  it("matches OP_OUTPOINTTXHASH: the reversed (internal) txid verifies, the display order does not", async () => {
    const utxo = addChunk();
    expect(() => payout(utxo, attest(utxo)).builder.debug()).not.toThrow();

    const msgDisplayOrder = new Uint8Array(payoutMessage({ jobId, outpoint: utxo, workerA, workerB, resultHash }));
    msgDisplayOrder.set(outpointTxHash(utxo.txid).reverse(), 32); // un-reverse → display order
    const wrong = signData(oracle.privateKey, msgDisplayOrder);
    expect(() => payout(utxo, wrong).builder.debug()).toThrow(/bad attestation/);
  });

  it("matches toPaddedBytes(index, 4): a multi-byte output index (258) verifies", async () => {
    const utxo = addChunk({ vout: 258 });
    await expect(broadcast(payout(utxo, attest(utxo)).hex)).resolves.toBeTruthy();
  });

  it("matches OP_CHECKDATASIG hashing: Schnorr over sha256(msg), not sha256d(msg)", () => {
    const utxo = addChunk();
    const msg = payoutMessage({ jobId, outpoint: utxo, workerA, workerB, resultHash });
    const good = signData(oracle.privateKey, msg);
    expect(good).toHaveLength(64);
    expect(verifyData(oracle.publicKey, msg, good)).toBe(true);
    const doubleHashed = signData(oracle.privateKey, sha256.hash(msg)); // = sig over sha256(sha256(msg))
    expect(() => payout(utxo, doubleHashed).builder.debug()).toThrow(/bad attestation/);
  });

  it("signs deterministically (same key + message → same signature)", () => {
    const msg = closeMessage(jobId);
    expect(binToHex(signData(oracle.privateKey, msg))).toBe(binToHex(signData(oracle.privateKey, msg)));
  });
});

describe("close", () => {
  const to = p2pkhAddress(researcher.pkh);

  it("sweeps chunks with researcher sig + oracle close sig", async () => {
    const utxos = [addChunk(), addChunk(), addChunk()];
    const tx = buildCloseTx({ provider, contract, utxos, researcher, to, oracleClose: signCloseAttestation(oracle.privateKey, jobId) });
    await expect(broadcast(tx.hex)).resolves.toBeTruthy();
    expect(await contract.getUtxos()).toHaveLength(0);
  });

  it("fails without a valid oracle close signature", async () => {
    const utxos = [addChunk()];
    const forged = signCloseAttestation(mallory.privateKey, jobId);
    const tx = buildCloseTx({ provider, contract, utxos, researcher, to, oracleClose: forged });
    expect(() => tx.builder.debug()).toThrow(/bad oracle close signature/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
    // A close signature for another job doesn't work either.
    const otherJob = signCloseAttestation(oracle.privateKey, sha256.hash(new TextEncoder().encode("job-2")));
    expect(() => buildCloseTx({ provider, contract, utxos, researcher, to, oracleClose: otherJob }).builder.debug()).toThrow(/bad oracle close signature/);
  });

  it("fails without the researcher's signature", async () => {
    const utxos = [addChunk()];
    const oracleClose = signCloseAttestation(oracle.privateKey, jobId);
    const tx = buildCloseTx({ provider, contract, utxos, researcher: mallory, to, oracleClose });
    expect(() => tx.builder.debug()).toThrow(/not the researcher/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
  });
});

describe("refund", () => {
  const to = p2pkhAddress(researcher.pkh);

  it("fails before refundAfter", async () => {
    const tx = buildRefundTx({ provider, contract, utxos: [addChunk()], researcher, to, locktime: Number(REFUND_AFTER) - 1 });
    expect(() => tx.builder.debug()).toThrow(/refund not yet available/);
    await expect(broadcast(tx.hex)).rejects.toThrow();
  });

  it("succeeds at/after refundAfter", async () => {
    const tx = buildRefundTx({ provider, contract, utxos: [addChunk(), addChunk()], researcher, to, locktime: Number(REFUND_AFTER) });
    await expect(broadcast(tx.hex)).resolves.toBeTruthy();
  });

  it("fails for anyone but the researcher", async () => {
    const tx = buildRefundTx({ provider, contract, utxos: [addChunk()], researcher: mallory, to, locktime: Number(REFUND_AFTER) });
    expect(() => tx.builder.debug()).toThrow(/not the researcher/);
  });
});

describe("funding", () => {
  it("creates N = 200 identical chunk UTXOs within standard size limits", async () => {
    const funderAddress = p2pkhAddress(researcher.pkh);
    provider.addUtxo(funderAddress, randomUtxo({ satoshis: 1_000_000n }));
    const f = await buildFundingTx({ provider, contract, funder: researcher, funderAddress, chunks: 200, pricePerWorker: PRICE });

    const bytes = f.hex.length / 2;
    expect(bytes).toBeLessThan(100_000); // standard tx size limit
    const decoded = decodeTransaction(hexToBin(f.hex));
    if (typeof decoded === "string") throw new Error(decoded);
    const chunkOutputs = decoded.outputs.filter((o) => binToHex(o.lockingBytecode) === contract.lockingBytecode);
    expect(chunkOutputs).toHaveLength(200);
    for (const o of chunkOutputs) expect(o.valueSatoshis).toBe(2n * PRICE + FEE_MARGIN);

    await broadcast(f.hex);
    expect(await contract.getUtxos()).toHaveLength(200);
    console.info(`funding tx with 200 chunk outputs: ${bytes} bytes`);
  });

  it("refuses to build without enough funds", async () => {
    const funderAddress = p2pkhAddress(researcher.pkh);
    provider.addUtxo(funderAddress, randomUtxo({ satoshis: 5_000n }));
    await expect(buildFundingTx({ provider, contract, funder: researcher, funderAddress, chunks: 3, pricePerWorker: PRICE })).rejects.toThrow(/Insufficient funds/);
  });
});

describe("contract", () => {
  it("reports its compiled size", () => {
    console.info(`NovaEscrow: redeem script ${contract.bytesize} bytes, ${contract.opcount} opcodes, ${contract.contractType}`);
    expect(contract.bytesize).toBeGreaterThan(0);
  });
});
