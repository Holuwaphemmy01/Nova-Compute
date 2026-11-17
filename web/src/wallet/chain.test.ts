import { readFileSync } from "node:fs";
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hexToBin } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import type { CloseInfo, Job } from "../api/client";
import { NotEnoughFunds, buildCloseSweep, buildFunding, escrowContract, type WalletUtxo } from "./chain";

const vector = JSON.parse(readFileSync(new URL("../../../contracts/vectors/payout.json", import.meta.url), "utf8"));
const researcherAddr = "bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdpn3jdgd"; // 20 zero bytes
const lockingOf = (addr: string) => {
  const r = cashAddressToLockingBytecode(addr);
  if (typeof r === "string") throw new Error(r);
  return binToHex(r.bytecode);
};

const job = {
  job_id: vector.contract.params.jobId,
  researcher_addr: researcherAddr,
  price_per_worker: vector.contract.params.pricePerWorker,
  refund_after: vector.contract.params.refundAfter,
  escrow_address: vector.contract.addressChipnet,
  chunk_count: 4,
  per_chunk_value: 3000,
  total_sats: 12000,
  status: "running",
  progress: { pending: 4, paying: 0, paid: 0, unpaid: 0 },
} as unknown as Job;

const utxo = (sats: number, path: "receive" | "change", index: number, n = 0): WalletUtxo => ({
  txid: (n + 1).toString(16).padStart(64, "0"),
  vout: 0,
  satoshis: BigInt(sats),
  lockingBytecode: lockingOf(researcherAddr),
  address: researcherAddr,
  path,
  index,
});

describe("funding tx", () => {
  it("creates chunk_count outputs of per_chunk_value to the escrow, change back, inputPaths per input", () => {
    const plan = buildFunding(job, [utxo(5_000, "receive", 0, 1), utxo(9_000, "change", 3, 2), utxo(800, "receive", 7, 3)], researcherAddr);
    const tx = plan.tx.transaction.transaction as ReturnType<typeof decodeTransaction> & { outputs: { lockingBytecode: Uint8Array; valueSatoshis: bigint }[] };
    const escrowLb = lockingOf(job.escrow_address);
    const escrowOuts = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === escrowLb);
    expect(escrowOuts).toHaveLength(4);
    for (const o of escrowOuts) expect(o.valueSatoshis).toBe(3000n);
    const change = tx.outputs.filter((o) => binToHex(o.lockingBytecode) === lockingOf(researcherAddr));
    expect(change).toHaveLength(1);
    expect(plan.locked).toBe(12_000);
    // Largest coins first: the 9,000 (change/3) then the 5,000 (receive/0).
    expect(plan.tx.inputPaths).toEqual([[0, "change", 3], [1, "receive", 0]]);
    expect(plan.tx.transaction.sourceOutputs).toHaveLength(2);
    expect(plan.tx.transaction.broadcast).toBe(false);
    expect(plan.tx.transaction.userPrompt).toMatch(/Lock 12,000 sats/);
    const inTotal = 14_000;
    const outTotal = tx.outputs.reduce((s, o) => s + Number(o.valueSatoshis), 0);
    expect(inTotal - outTotal).toBe(plan.fee);
    expect(plan.fee).toBeGreaterThan(0);
  });

  it("explains a shortfall in plain words", () => {
    const err = (() => {
      try {
        buildFunding(job, [utxo(5_000, "receive", 0)], researcherAddr);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NotEnoughFunds);
    expect((err as Error).message).toMatch(/^Not enough BCH: need [\d,]+ sats, your wallet has 5,000 sats\.$/);
  });
});

describe("escrow contract in the browser", () => {
  const p = vector.contract.params;
  it("rebuilds exactly the job's escrow address (same as the CashScript vector)", () => {
    const c = escrowContract(job, p.researcherPkh, p.oraclePk);
    expect(c.address).toBe(vector.contract.addressChipnet);
    expect(c.lockingBytecode).toBe(vector.contract.lockingBytecodeHex);
  });

  it("refuses to build when the escrow doesn't match", () => {
    expect(() => escrowContract({ ...job, price_per_worker: 1201 }, p.researcherPkh, p.oraclePk)).toThrow(/don't match/);
  });

  it("builds the close sweep: every remaining chunk in, one output back, signed by receive/0", () => {
    const close: CloseInfo = {
      job_id: job.job_id,
      message: "",
      oracle_close_signature: "11".repeat(64),
      oracle_pubkey: p.oraclePk,
      remaining: [
        { index: 1, txid: "aa".repeat(32), vout: 1, value: 3000 },
        { index: 2, txid: "aa".repeat(32), vout: 2, value: 3000 },
      ],
    };
    const plan = buildCloseSweep(job, close, p.researcherPkh, researcherAddr);
    const tx = plan.tx.transaction.transaction as unknown as { inputs: unknown[]; outputs: { lockingBytecode: Uint8Array; valueSatoshis: bigint }[] };
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(1);
    expect(binToHex(tx.outputs[0].lockingBytecode)).toBe(lockingOf(researcherAddr));
    expect(Number(tx.outputs[0].valueSatoshis)).toBe(plan.returned);
    expect(plan.tx.inputPaths).toEqual([[0, "receive", 0], [1, "receive", 0]]);
    expect(plan.tx.transaction.sourceOutputs.every((s) => s.contract?.abiFunction.name === "close")).toBe(true);
  });
});

describe("artifact", () => {
  it("web copy is identical to contracts/artifacts (rerun `cp` after `pnpm build` in contracts/)", () => {
    const a = readFileSync(new URL("../contracts/NovaEscrow.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(new URL("../../../contracts/artifacts/NovaEscrow.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(JSON.parse(a).bytecode).toBe(JSON.parse(b).bytecode);
    expect(a).toBe(b);
    void hexToBin;
  });
});
