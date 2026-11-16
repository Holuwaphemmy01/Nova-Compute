/**
 * Golden payout vector for the Rust coordinator: one fixed payout built with FIXED TEST KEYS.
 * Everything is deterministic: keys are sha256(label), the input outpoint is fixed, and
 * libauth's Schnorr signatures use a deterministic (RFC 6979-style) nonce. The payout has
 * no transaction signature (only the oracle's data signature), so the tx hex is stable.
 */
import { binToHex, decodeTransaction, encodeLockingBytecodeP2pkh, hashTransaction, hexToBin, lockingBytecodeToCashAddress, sha256 } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { payoutMessage, outpointTxHash, signPayoutAttestation, u32le } from "./attestation.js";
import { chunkValue, escrowContract, FEE_MARGIN, type EscrowParams } from "./escrow.js";
import { buildPayoutTx } from "./payout.js";
import { testKeypair } from "./keys.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

function address(lockingBytecode: string, prefix: "bitcoincash" | "bchtest") {
  const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingBytecode), prefix });
  if (typeof r === "string") throw new Error(r);
  return r.address;
}

export function makePayoutVector() {
  const researcher = testKeypair("nova-vector/researcher");
  const oracle = testKeypair("nova-vector/oracle");
  const workerA = testKeypair("nova-vector/workerA");
  const workerB = testKeypair("nova-vector/workerB");
  const jobId = sha256.hash(utf8("nova-vector/job"));
  const resultHash = sha256.hash(utf8("nova-vector/result"));
  const price = 1200n;
  const params: EscrowParams = { researcherPkh: researcher.pkh, oraclePk: oracle.publicKey, jobId, pricePerWorker: price, refundAfter: 1_800_000_000n };

  const provider = new MockNetworkProvider({ updateUtxoSet: false });
  const contract = escrowContract(params, provider);
  const fundingTxid = binToHex(sha256.hash(utf8("nova-vector/funding-tx")));
  const utxo = provider.addUtxo(contract.address, { txid: fundingTxid, vout: 3, satoshis: chunkValue(price) });

  const outpoint = { txid: utxo.txid, vout: utxo.vout };
  const message = payoutMessage({ jobId, outpoint, workerA: workerA.pkh, workerB: workerB.pkh, resultHash });
  const attestation = signPayoutAttestation(oracle.privateKey, { jobId, outpoint, workerA: workerA.pkh, workerB: workerB.pkh, resultHash });
  const tx = buildPayoutTx({ provider, contract, utxo, attestation, workerA: workerA.pkh, workerB: workerB.pkh, resultHash, pricePerWorker: price });

  const txBin = hexToBin(tx.hex);
  const decoded = decodeTransaction(txBin);
  if (typeof decoded === "string") throw new Error(decoded);
  const outputsTotal = decoded.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);

  return {
    description: "NovaEscrow.payout golden vector. FIXED TEST KEYS ONLY (private keys are sha256 of public labels); never use them for real funds.",
    deterministic:
      "Keys = sha256(label); input outpoint fixed; oracle datasig = BCH Schnorr over sha256(message) with libauth's deterministic RFC 6979-style nonce; payout has no tx signature, so the whole tx is reproducible. Regenerate with `pnpm vectors`; a test checks this file matches.",
    cashscript: { compiler: contract.artifact.compiler.version, contractType: contract.contractType },
    contract: {
      name: contract.name,
      params: {
        researcherPkh: binToHex(params.researcherPkh),
        oraclePk: binToHex(params.oraclePk),
        jobId: binToHex(params.jobId),
        pricePerWorker: Number(params.pricePerWorker),
        refundAfter: Number(params.refundAfter),
      },
      encodedConstructorArgsHex: contract.encodedConstructorArgs.map(binToHex),
      redeemScriptHex: contract.bytecode,
      redeemScriptBytes: contract.bytesize,
      lockingBytecodeHex: contract.lockingBytecode,
      lockingBytecodeNote: "P2SH32: OP_HASH256 <hash256(redeemScript)> OP_EQUAL",
      addressMainnet: address(contract.lockingBytecode, "bitcoincash"),
      addressChipnet: address(contract.lockingBytecode, "bchtest"),
    },
    testKeys: {
      researcherPrivateKey: binToHex(researcher.privateKey),
      oraclePrivateKey: binToHex(oracle.privateKey),
      oraclePublicKey: binToHex(oracle.publicKey),
      workerAPkh: binToHex(workerA.pkh),
      workerBPkh: binToHex(workerB.pkh),
    },
    input: {
      txid: utxo.txid,
      vout: utxo.vout,
      outpointTxHashInternalHex: binToHex(outpointTxHash(utxo.txid)),
      outpointIndexLeHex: binToHex(u32le(utxo.vout)),
      satoshis: Number(utxo.satoshis),
      sequence: decoded.inputs[0].sequenceNumber,
    },
    attestation: {
      layout: "jobId(32) ‖ outpointTxHash(32, internal byte order) ‖ outpointIndex(4, LE) ‖ workerA(20) ‖ workerB(20) ‖ resultHash(32)",
      resultHashHex: binToHex(resultHash),
      messageHex: binToHex(message),
      messageBytes: message.length,
      messageSha256Hex: binToHex(sha256.hash(message)),
      signatureHex: binToHex(attestation),
    },
    unlockingBytecodeHex: binToHex(decoded.inputs[0].unlockingBytecode),
    unlockingBytecodeNote:
      "Pushes, in order: resultHash, workerB, workerA, attestation (function args in reverse), OP_0 (function selector: payout = 0), then the redeem script.",
    tx: {
      hex: tx.hex,
      txid: hashTransaction(txBin),
      bytes: txBin.length,
      version: decoded.version,
      locktime: decoded.locktime,
      feeSatoshis: Number(utxo.satoshis - outputsTotal),
      feeMarginSatoshis: Number(FEE_MARGIN),
      outputs: decoded.outputs.map((o) => ({ lockingBytecodeHex: binToHex(o.lockingBytecode), satoshis: Number(o.valueSatoshis) })),
      expectedOutputLockingBytecodes: [binToHex(encodeLockingBytecodeP2pkh(workerA.pkh)), binToHex(encodeLockingBytecodeP2pkh(workerB.pkh))],
    },
  };
}
