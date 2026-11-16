use std::sync::Arc;

use axum::http::{HeaderValue, Method, header};
use nova_coordinator::{api, config::Config, fulcrum::FulcrumClient, service};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sqlx=warn".into())).init();

    let cfg = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("configuration error: {e}");
            std::process::exit(2);
        }
    };
    tracing::info!(network = ?cfg.settings.network, oracle = %hex::encode(cfg.settings.oracle.pubkey()), fee_address = %cfg.settings.fee.address(cfg.settings.network), "starting Nova coordinator");

    let db = service::connect_db(&cfg.database_url).await.expect("database");
    let chain = Arc::new(FulcrumClient::new(&cfg.fulcrum_servers).expect("fulcrum config"));
    let coordinator = Arc::new(service::Coordinator::new(db, chain, cfg.settings));
    tokio::spawn(service::run_background(coordinator.clone()));

    let cors = match &cfg.cors_origin {
        Some(o) if o == "*" => CorsLayer::permissive(),
        Some(o) => CorsLayer::new()
            .allow_origin(o.split(',').filter_map(|s| HeaderValue::from_str(s.trim()).ok()).collect::<Vec<_>>())
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::HeaderName::from_static(api::RESEARCHER_HEADER)]),
        None => CorsLayer::new(),
    };
    let app = api::router(coordinator).layer(cors).layer(TraceLayer::new_for_http());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    tracing::info!(%addr, "listening");
    axum::serve(listener, app).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await.expect("server");
}
