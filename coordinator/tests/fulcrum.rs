//! Stage B: the Fulcrum client against a local fake Electrum server (plain TCP), including
//! error replies, notifications, reconnect after the server drops the connection and fallback.
//! A live chipnet check is #[ignore]d: `cargo test -p nova-coordinator --test fulcrum -- --ignored`.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use nova_coordinator::chain_client::{ChainClient, ChainClientError, MockChain};
use nova_coordinator::fulcrum::{CHIPNET_DEFAULT_SERVERS, FulcrumClient, ServerUrl};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

/// Fake Electrum server. Closes each connection after `drop_after` requests (0 = never).
async fn fake_server(drop_after: usize) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let connections = Arc::new(AtomicUsize::new(0));
    let conns = connections.clone();
    tokio::spawn(async move {
        loop {
            let (sock, _) = listener.accept().await.unwrap();
            conns.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                let (r, mut w) = sock.into_split();
                let mut lines = BufReader::new(r).lines();
                let mut served = 0;
                while let Ok(Some(line)) = lines.next_line().await {
                    let req: Value = serde_json::from_str(&line).unwrap();
                    let id = req["id"].clone();
                    let method = req["method"].as_str().unwrap().to_string();
                    let reply = match method.as_str() {
                        "server.version" => json!({"id": id, "result": ["FakeFulcrum 1.0", "1.5"]}),
                        "server.ping" => json!({"id": id, "result": null}),
                        "blockchain.transaction.broadcast" if req["params"][0] == "bad" => {
                            json!({"id": id, "error": {"code": 1, "message": "the transaction was rejected by network rules"}})
                        }
                        "blockchain.transaction.broadcast" => json!({"id": id, "result": "ab".repeat(32)}),
                        "blockchain.transaction.get" => json!({"id": id, "result": "0200"}),
                        "blockchain.scripthash.listunspent" => json!({"id": id, "result": [{"tx_hash": "cd".repeat(32), "tx_pos": 3, "value": 3000, "height": 0}]}),
                        _ => json!({"id": id, "error": {"message": "unknown method"}}),
                    };
                    // A notification first, to check the client ignores id-less messages.
                    let _ = w.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"blockchain.headers.subscribe\",\"params\":[]}\n").await;
                    let _ = w.write_all(format!("{reply}\n").as_bytes()).await;
                    if method != "server.version" {
                        served += 1;
                        if drop_after > 0 && served >= drop_after {
                            return; // drop the connection
                        }
                    }
                }
            });
        }
    });
    (format!("tcp://{addr}"), connections)
}

#[tokio::test]
async fn methods_and_error_replies() {
    let (url, _) = fake_server(0).await;
    let c = FulcrumClient::new(&[url]).unwrap();
    c.ping().await.unwrap();
    assert_eq!(c.broadcast("00").await.unwrap(), "ab".repeat(32));
    assert_eq!(c.get_transaction("x").await.unwrap(), "0200");
    let u = c.list_unspent("y").await.unwrap();
    assert_eq!((u[0].tx_pos, u[0].value), (3, 3000));
    match c.broadcast("bad").await {
        Err(ChainClientError::Server(m)) => assert!(m.contains("rejected")),
        other => panic!("expected server error, got {other:?}"),
    }
}

#[tokio::test]
async fn reconnects_after_the_server_drops_the_connection() {
    let (url, connections) = fake_server(1).await; // every connection serves 1 request
    let c = FulcrumClient::new(&[url]).unwrap();
    for _ in 0..4 {
        c.ping().await.unwrap();
    }
    assert!(connections.load(Ordering::SeqCst) >= 4, "a new connection per dropped one");
}

#[tokio::test]
async fn falls_back_to_the_next_server() {
    let dead = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let a = l.local_addr().unwrap();
        drop(l); // nothing listening any more
        format!("tcp://{a}")
    };
    let (good, _) = fake_server(0).await;
    let c = FulcrumClient::new(&[dead, good]).unwrap();
    c.ping().await.unwrap();
}

#[test]
fn parses_server_urls() {
    assert_eq!(ServerUrl::parse("ssl://chipnet.bch.ninja:50002").unwrap(), ServerUrl { tls: true, host: "chipnet.bch.ninja".into(), port: 50002 });
    assert!(!ServerUrl::parse("tcp://localhost:50001").unwrap().tls);
    assert!(ServerUrl::parse("ssl://nohost").is_err());
}

#[tokio::test]
async fn mock_chain_rejects_double_spends() {
    use nova_coordinator::chain::tx::{OutPoint, Transaction, TxIn, TxOut};
    let chain = MockChain::new();
    let funding = Transaction { version: 2, inputs: vec![], outputs: vec![TxOut { value: 5000, locking_bytecode: vec![0x51] }], locktime: 0 };
    chain.add_confirmed(&funding);
    let spend = |v: u64| Transaction {
        version: 2,
        inputs: vec![TxIn { outpoint: OutPoint { txid: funding.txid(), vout: 0 }, unlocking_bytecode: vec![], sequence: 0 }],
        outputs: vec![TxOut { value: v, locking_bytecode: vec![0x51] }],
        locktime: 0,
    };
    chain.broadcast(&spend(4000).to_hex()).await.unwrap();
    chain.broadcast(&spend(4000).to_hex()).await.unwrap(); // same tx again: idempotent
    assert!(matches!(chain.broadcast(&spend(3000).to_hex()).await, Err(ChainClientError::Server(_))));
    assert_eq!(chain.broadcasts().len(), 1);
}

#[tokio::test]
#[ignore = "needs internet: live chipnet Fulcrum"]
async fn live_chipnet_ping() {
    let servers: Vec<String> = CHIPNET_DEFAULT_SERVERS.iter().map(|s| s.to_string()).collect();
    let c = FulcrumClient::new(&servers).unwrap();
    c.ping().await.unwrap();
    // Genesis-adjacent query: listunspent on an empty scripthash returns [].
    let u = c.list_unspent(&"00".repeat(32)).await.unwrap();
    assert!(u.is_empty());
}
