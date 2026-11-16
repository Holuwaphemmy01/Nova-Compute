//! Stage A: every primitive must EQUAL contracts/vectors/payout.json (produced by the CashScript SDK).

use nova_coordinator::chain::{
    Network,
    attestation::{payout_message, sign_payout},
    contract::{Artifact, Escrow, EscrowParams},
    keys::PrivateKey,
    payout::{PayoutItem, build_payout_tx, payout_unlocking_bytecode},
    schnorr,
    tx::{OutPoint, Transaction},
};
use serde_json::Value;

fn vector() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/vectors/payout.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("read payout.json")).unwrap()
}

fn h<const N: usize>(v: &Value) -> [u8; N] {
    hex::decode(v.as_str().unwrap()).unwrap().try_into().unwrap()
}

fn escrow(v: &Value) -> Escrow {
    let p = &v["contract"]["params"];
    Escrow::new(
        &Artifact::embedded(),
        EscrowParams {
            researcher_pkh: h(&p["researcherPkh"]),
            oracle_pk: h(&p["oraclePk"]),
            job_id: h(&p["jobId"]),
            price_per_worker: p["pricePerWorker"].as_u64().unwrap(),
            refund_after: p["refundAfter"].as_u64().unwrap() as u32,
        },
    )
    .unwrap()
}

fn item(v: &Value, attestation: [u8; 64]) -> PayoutItem {
    PayoutItem {
        outpoint: OutPoint::from_txid_hex(v["input"]["txid"].as_str().unwrap(), v["input"]["vout"].as_u64().unwrap() as u32).unwrap(),
        value: v["input"]["satoshis"].as_u64().unwrap(),
        attestation,
        worker_a: h(&v["testKeys"]["workerAPkh"]),
        worker_b: h(&v["testKeys"]["workerBPkh"]),
        result_hash: h(&v["attestation"]["resultHashHex"]),
    }
}

#[test]
fn constructor_args_match() {
    let v = vector();
    let e = escrow(&v);
    let expected: Vec<String> = v["contract"]["encodedConstructorArgsHex"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
    let got: Vec<String> = e.params.encoded_args().iter().map(hex::encode).collect();
    assert_eq!(got, expected);
}

#[test]
fn redeem_script_locking_bytecode_and_addresses_match() {
    let v = vector();
    let e = escrow(&v);
    assert_eq!(hex::encode(&e.redeem_script), v["contract"]["redeemScriptHex"].as_str().unwrap());
    assert_eq!(e.redeem_script.len() as u64, v["contract"]["redeemScriptBytes"].as_u64().unwrap());
    assert_eq!(hex::encode(&e.locking_bytecode), v["contract"]["lockingBytecodeHex"].as_str().unwrap());
    assert_eq!(e.address(Network::Chipnet), v["contract"]["addressChipnet"].as_str().unwrap());
    assert_eq!(e.address(Network::Mainnet), v["contract"]["addressMainnet"].as_str().unwrap());
}

#[test]
fn test_keys_derive_the_vector_pubkey() {
    let v = vector();
    let oracle = PrivateKey::from_bytes(&h(&v["testKeys"]["oraclePrivateKey"])).unwrap();
    assert_eq!(hex::encode(oracle.pubkey()), v["testKeys"]["oraclePublicKey"].as_str().unwrap());
    assert_eq!(hex::encode(oracle.pubkey()), v["contract"]["params"]["oraclePk"].as_str().unwrap());
}

#[test]
fn attestation_message_matches() {
    let v = vector();
    let e = escrow(&v);
    let it = item(&v, [0; 64]);
    let m = payout_message(&e.params.job_id, &it.outpoint, &it.worker_a, &it.worker_b, &it.result_hash);
    assert_eq!(hex::encode(m), v["attestation"]["messageHex"].as_str().unwrap());
    assert_eq!(hex::encode(it.outpoint.internal_hash()), v["input"]["outpointTxHashInternalHex"].as_str().unwrap());
}

#[test]
fn vector_signature_verifies_with_rust_verifier() {
    let v = vector();
    let ok = schnorr::verify_data(&h(&v["testKeys"]["oraclePublicKey"]), &hex::decode(v["attestation"]["messageHex"].as_str().unwrap()).unwrap(), &h(&v["attestation"]["signatureHex"]));
    assert!(ok, "libauth's signature must verify with the Rust BCH Schnorr verifier");
}

#[test]
fn rust_signature_equals_libauth_byte_for_byte() {
    let v = vector();
    let e = escrow(&v);
    let oracle = PrivateKey::from_bytes(&h(&v["testKeys"]["oraclePrivateKey"])).unwrap();
    let it = item(&v, [0; 64]);
    let sig = sign_payout(&oracle, &e.params.job_id, &it.outpoint, &it.worker_a, &it.worker_b, &it.result_hash);
    assert_eq!(hex::encode(sig), v["attestation"]["signatureHex"].as_str().unwrap());
}

#[test]
fn unlocking_bytecode_and_full_payout_tx_match() {
    let v = vector();
    let e = escrow(&v);
    let it = item(&v, h(&v["attestation"]["signatureHex"]));
    assert_eq!(hex::encode(payout_unlocking_bytecode(&e, &it)), v["unlockingBytecodeHex"].as_str().unwrap());

    let tx = build_payout_tx(&e, &[it]).unwrap();
    assert_eq!(tx.to_hex(), v["tx"]["hex"].as_str().unwrap());
    assert_eq!(tx.txid_hex(), v["tx"]["txid"].as_str().unwrap());
    assert_eq!(tx.serialize().len() as u64, v["tx"]["bytes"].as_u64().unwrap());
    // Parse round-trip.
    assert_eq!(Transaction::parse_hex(v["tx"]["hex"].as_str().unwrap()).unwrap(), tx);
}

#[test]
fn rust_built_payout_with_rust_signature_equals_vector() {
    // End to end in Rust: sign with the test oracle key, build the tx, compare to the SDK's tx.
    let v = vector();
    let e = escrow(&v);
    let oracle = PrivateKey::from_bytes(&h(&v["testKeys"]["oraclePrivateKey"])).unwrap();
    let base = item(&v, [0; 64]);
    let sig = sign_payout(&oracle, &e.params.job_id, &base.outpoint, &base.worker_a, &base.worker_b, &base.result_hash);
    let tx = build_payout_tx(&e, &[item(&v, sig)]).unwrap();
    assert_eq!(tx.to_hex(), v["tx"]["hex"].as_str().unwrap());
}
