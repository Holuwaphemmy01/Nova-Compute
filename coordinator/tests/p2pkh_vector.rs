//! Deterministic P2PKH-signed OP_RETURN tx from the Rust fee wallet. The committed
//! contracts/vectors/rust-p2pkh.json is validated independently by a TS test that runs it
//! through CashScript's MockNetworkProvider VM (contracts/test/rust-vectors.test.ts).
//! Regenerate with: NOVA_WRITE_VECTORS=1 cargo test -p nova-coordinator --test p2pkh_vector

use nova_coordinator::chain::{
    hash::sha256,
    keys::PrivateKey,
    merkle::{merkle_root, op_return_script},
    tx::{OutPoint, TxOut},
    wallet::{Utxo, build_signed},
};
use serde_json::json;

#[test]
fn p2pkh_op_return_vector() {
    let key = PrivateKey::from_bytes(&sha256(b"nova-vector/fee-wallet")).unwrap();
    let utxo = Utxo { outpoint: OutPoint { txid: sha256(b"nova-vector/fee-utxo"), vout: 1 }, value: 10_000 };
    let job_id = sha256(b"nova-vector/job");
    let root = merkle_root(&[sha256(b"chunk-0"), sha256(b"chunk-1"), sha256(b"chunk-2")]).unwrap();
    let tx = build_signed(&key, &[utxo.clone()], vec![TxOut { value: 0, locking_bytecode: op_return_script(&job_id, &root) }], 1).unwrap();

    let fee = utxo.value - tx.outputs.iter().map(|o| o.value).sum::<u64>();
    assert!(fee >= tx.serialize().len() as u64, "at least 1 sat/byte");

    let v = json!({
        "description": "P2PKH spend signed by the Rust coordinator (ECDSA low-S DER, SIGHASH_ALL|FORKID). FIXED TEST KEY.",
        "privateKeyHex": hex::encode(key.to_bytes()),
        "utxo": { "txid": utxo.outpoint.txid_hex(), "vout": utxo.outpoint.vout, "satoshis": utxo.value, "lockingBytecodeHex": hex::encode(key.p2pkh_script()) },
        "merkleRootHex": hex::encode(root),
        "txHex": tx.to_hex(),
        "txid": tx.txid_hex(),
    });
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/vectors/rust-p2pkh.json");
    let text = serde_json::to_string_pretty(&v).unwrap() + "\n";
    if std::env::var("NOVA_WRITE_VECTORS").is_ok() {
        std::fs::write(path, &text).unwrap();
    }
    let committed = std::fs::read_to_string(path).expect("missing rust-p2pkh.json; run with NOVA_WRITE_VECTORS=1").replace("\r\n", "\n");
    assert_eq!(committed, text, "Rust signing must be deterministic and match the committed vector");
}
