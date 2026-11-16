//! Electrum-protocol (Fulcrum) client: newline-delimited JSON-RPC over TLS TCP (`ssl://host:port`)
//! or plain TCP (`tcp://host:port`). One multiplexed connection; reconnects on drop and falls
//! back through the configured server list.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, oneshot};
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::{ClientConfig, RootCertStore, pki_types::ServerName};

use crate::chain_client::{ChainClient, ChainClientError, Unspent};

/// Default chipnet servers (the hosts CashScript's SDK uses, on the TLS-TCP Electrum port).
pub const CHIPNET_DEFAULT_SERVERS: &[&str] = &["ssl://chipnet.bch.ninja:50002", "ssl://chipnet.imaginary.cash:50002"];
pub const MAINNET_DEFAULT_SERVERS: &[&str] = &["ssl://bch.imaginary.cash:50002", "ssl://electrum.imaginary.cash:50002"];

const CLIENT_NAME: &str = "nova-coordinator";
const PROTOCOL_VERSION: &str = "1.5";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerUrl {
    pub tls: bool,
    pub host: String,
    pub port: u16,
}

impl ServerUrl {
    pub fn parse(s: &str) -> Result<Self, String> {
        let (tls, rest) = if let Some(r) = s.strip_prefix("ssl://").or_else(|| s.strip_prefix("tls://")) {
            (true, r)
        } else if let Some(r) = s.strip_prefix("tcp://") {
            (false, r)
        } else {
            (true, s)
        };
        let (host, port) = rest.rsplit_once(':').ok_or_else(|| format!("server {s:?} needs host:port"))?;
        let port = port.trim_end_matches('/').parse().map_err(|_| format!("bad port in {s:?}"))?;
        Ok(Self { tls, host: host.to_string(), port })
    }
}

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Result<Value, ChainClientError>>>>>;

struct Conn {
    writer: Box<dyn AsyncWrite + Send + Unpin>,
    pending: Pending,
    alive: Arc<std::sync::atomic::AtomicBool>,
    server: String,
}

pub struct FulcrumClient {
    servers: Vec<ServerUrl>,
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
    tls: TlsConnector,
}

impl FulcrumClient {
    /// `servers`: primary first, then fallbacks.
    pub fn new(servers: &[String]) -> Result<Self, String> {
        if servers.is_empty() {
            return Err("no Fulcrum servers configured".into());
        }
        let servers = servers.iter().map(|s| ServerUrl::parse(s)).collect::<Result<Vec<_>, _>>()?;
        let roots = RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        let config = ClientConfig::builder_with_provider(Arc::new(tokio_rustls::rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots)
            .with_no_client_auth();
        Ok(Self { servers, conn: Mutex::new(None), next_id: AtomicU64::new(1), tls: TlsConnector::from(Arc::new(config)) })
    }

    async fn connect_one(&self, s: &ServerUrl) -> Result<Conn, ChainClientError> {
        let addr = format!("{}:{}", s.host, s.port);
        let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
            .await
            .map_err(|_| ChainClientError::Connection(format!("{addr}: connect timeout")))?
            .map_err(|e| ChainClientError::Connection(format!("{addr}: {e}")))?;
        let _ = tcp.set_nodelay(true);
        let pending: Pending = Arc::default();
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let server = if s.tls { format!("ssl://{addr}") } else { format!("tcp://{addr}") };

        let writer: Box<dyn AsyncWrite + Send + Unpin> = if s.tls {
            let name = ServerName::try_from(s.host.clone()).map_err(|_| ChainClientError::Connection(format!("bad hostname {}", s.host)))?;
            let stream = tokio::time::timeout(CONNECT_TIMEOUT, self.tls.connect(name, tcp))
                .await
                .map_err(|_| ChainClientError::Connection(format!("{addr}: TLS timeout")))?
                .map_err(|e| ChainClientError::Connection(format!("{addr}: TLS {e}")))?;
            let (r, w) = tokio::io::split(stream);
            spawn_reader(r, pending.clone(), alive.clone(), server.clone());
            Box::new(w)
        } else {
            let (r, w) = tcp.into_split();
            spawn_reader(r, pending.clone(), alive.clone(), server.clone());
            Box::new(w)
        };
        Ok(Conn { writer, pending, alive, server })
    }

    async fn ensure_connected<'a>(&self, slot: &'a mut Option<Conn>) -> Result<&'a mut Conn, ChainClientError> {
        if slot.as_ref().is_some_and(|c| c.alive.load(Ordering::SeqCst)) {
            return Ok(slot.as_mut().unwrap());
        }
        *slot = None;
        let mut last = ChainClientError::Connection("no servers".into());
        for s in &self.servers {
            match self.connect_one(s).await {
                Ok(mut c) => {
                    // Negotiate the protocol version (required before other calls by some servers).
                    let id = self.next_id.fetch_add(1, Ordering::SeqCst);
                    let rx = send(&mut c, id, "server.version", json!([CLIENT_NAME, PROTOCOL_VERSION])).await;
                    match rx {
                        Ok(rx) => match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
                            Ok(Ok(Ok(_))) => {
                                tracing::info!(server = %c.server, "connected to Fulcrum");
                                *slot = Some(c);
                                return Ok(slot.as_mut().unwrap());
                            }
                            Ok(Ok(Err(e))) => last = e,
                            _ => last = ChainClientError::Connection(format!("{}: no server.version reply", c.server)),
                        },
                        Err(e) => last = e,
                    }
                }
                Err(e) => {
                    tracing::warn!(server = %format!("{}:{}", s.host, s.port), error = %e, "Fulcrum connect failed");
                    last = e;
                }
            }
        }
        Err(last)
    }

    /// Sends a request, reconnecting (and moving to fallback servers) once on connection trouble.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, ChainClientError> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let rx = {
                let mut slot = self.conn.lock().await;
                let conn = match self.ensure_connected(&mut slot).await {
                    Ok(c) => c,
                    Err(e) if attempt < 2 => {
                        tracing::warn!(error = %e, "retrying Fulcrum connection");
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                let id = self.next_id.fetch_add(1, Ordering::SeqCst);
                match send(conn, id, method, params.clone()).await {
                    Ok(rx) => rx,
                    Err(e) => {
                        *slot = None;
                        if attempt < 2 {
                            continue;
                        }
                        return Err(e);
                    }
                }
            };
            // Retrying after a dropped connection is safe: every method we use is idempotent
            // (re-broadcasting a known tx is harmless).
            match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
                Ok(Ok(Ok(v))) => return Ok(v),
                Ok(Ok(Err(e @ ChainClientError::Server(_)))) => return Err(e),
                Ok(Ok(Err(e))) => {
                    *self.conn.lock().await = None;
                    if attempt >= 2 {
                        return Err(e);
                    }
                    tracing::warn!(error = %e, "Fulcrum request failed; reconnecting");
                }
                Ok(Err(_)) => {
                    *self.conn.lock().await = None;
                    if attempt >= 2 {
                        return Err(e_dropped());
                    }
                }
                Err(_) => {
                    *self.conn.lock().await = None;
                    return Err(ChainClientError::Timeout);
                }
            }
        }
    }
}

fn e_dropped() -> ChainClientError {
    ChainClientError::Connection("connection dropped".into())
}

async fn send(conn: &mut Conn, id: u64, method: &str, params: Value) -> Result<oneshot::Receiver<Result<Value, ChainClientError>>, ChainClientError> {
    let (tx, rx) = oneshot::channel();
    conn.pending.lock().unwrap().insert(id, tx);
    let mut line = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).unwrap();
    line.push(b'\n');
    if let Err(e) = async {
        conn.writer.write_all(&line).await?;
        conn.writer.flush().await
    }
    .await
    {
        conn.pending.lock().unwrap().remove(&id);
        conn.alive.store(false, Ordering::SeqCst);
        return Err(ChainClientError::Connection(format!("{}: write failed: {e}", conn.server)));
    }
    Ok(rx)
}

fn spawn_reader<R: tokio::io::AsyncRead + Send + Unpin + 'static>(r: R, pending: Pending, alive: Arc<std::sync::atomic::AtomicBool>, server: String) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(r).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                    let Some(id) = v.get("id").and_then(Value::as_u64) else { continue }; // notification
                    let Some(tx) = pending.lock().unwrap().remove(&id) else { continue };
                    let res = match v.get("error").filter(|e| !e.is_null()) {
                        Some(err) => Err(ChainClientError::Server(err.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| err.to_string()))),
                        None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    let _ = tx.send(res);
                }
                Ok(None) | Err(_) => break,
            }
        }
        alive.store(false, Ordering::SeqCst);
        tracing::warn!(%server, "Fulcrum connection closed");
        for (_, tx) in pending.lock().unwrap().drain() {
            let _ = tx.send(Err(e_dropped()));
        }
    });
}

#[async_trait]
impl ChainClient for FulcrumClient {
    async fn broadcast(&self, tx_hex: &str) -> Result<String, ChainClientError> {
        let v = self.request("blockchain.transaction.broadcast", json!([tx_hex])).await?;
        v.as_str().map(str::to_string).ok_or_else(|| ChainClientError::BadResponse(v.to_string()))
    }

    async fn get_transaction(&self, txid: &str) -> Result<String, ChainClientError> {
        let v = self.request("blockchain.transaction.get", json!([txid, false])).await?;
        v.as_str().map(str::to_string).ok_or_else(|| ChainClientError::BadResponse(v.to_string()))
    }

    async fn list_unspent(&self, scripthash: &str) -> Result<Vec<Unspent>, ChainClientError> {
        let v = self.request("blockchain.scripthash.listunspent", json!([scripthash])).await?;
        serde_json::from_value(v).map_err(|e| ChainClientError::BadResponse(e.to_string()))
    }

    async fn ping(&self) -> Result<(), ChainClientError> {
        self.request("server.ping", json!([])).await.map(|_| ())
    }
}
