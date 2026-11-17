//! REST API (base /api/v1). See docs/api.md.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRequestParts, Path, State},
    http::{HeaderMap, StatusCode, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;

use crate::service::{AppError, Coordinator, CreateJob, Summary, Worker};

type AppState = Arc<Coordinator>;

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::LeaseExpired => StatusCode::GONE,
            AppError::Chain(_) => StatusCode::BAD_GATEWAY,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status.is_server_error() {
            tracing::error!(error = %self, "request failed");
        }
        (status, Json(json!({ "error": { "code": self.code(), "message": self.to_string() } }))).into_response()
    }
}

/// Researcher identity. TODO(auth): hackathon-only — the researcher's cashaddr in a header.
/// Replace with a signed challenge (wallet signature over a nonce) before mainnet.
pub const RESEARCHER_HEADER: &str = "x-researcher-address";

struct Researcher(String);

impl<S: Send + Sync> FromRequestParts<S> for Researcher {
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts
            .headers
            .get(RESEARCHER_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| Researcher(s.trim().to_string()))
            .filter(|r| !r.0.is_empty())
            .ok_or(AppError::Unauthorized)
    }
}

struct AuthWorker(Worker);

impl FromRequestParts<AppState> for AuthWorker {
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = bearer(&parts.headers).ok_or(AppError::Unauthorized)?;
        state.auth_worker(&token).await.map(AuthWorker)
    }
}

fn bearer(h: &HeaderMap) -> Option<String> {
    h.get("authorization")?.to_str().ok()?.strip_prefix("Bearer ").map(|t| t.trim().to_string())
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/jobs", post(create_job).get(list_jobs))
        .route("/jobs/{id}", get(get_job))
        .route("/jobs/{id}/funded", post(mark_funded))
        .route("/jobs/{id}/fund", post(fund_job))
        .route("/tx/{txid}", get(get_tx))
        .route("/jobs/{id}/chunks", get(get_chunks))
        .route("/jobs/{id}/result", get(get_result))
        .route("/jobs/{id}/proof", get(get_proof))
        .route("/jobs/{id}/close", post(close_job))
        .route("/workers/session", post(worker_session))
        .route("/workers/me", get(worker_me))
        .route("/work/next", post(work_next))
        .route("/work/{assignment_id}/result", post(work_result))
        .route("/health", get(health));
    Router::new().route("/health", get(health)).nest("/api/v1", api).with_state(state)
}

async fn health(State(c): State<AppState>) -> impl IntoResponse {
    let fulcrum = c.chain.ping().await.is_ok();
    Json(json!({
        "status": "ok",
        "network": c.settings.network,
        "fulcrum": if fulcrum { "ok" } else { "unreachable" },
        "oracle_pubkey": hex::encode(c.settings.oracle.pubkey()),
        "fee_address": c.settings.fee.address(c.settings.network),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn create_job(State(c): State<AppState>, Researcher(r): Researcher, Json(req): Json<CreateJob>) -> Result<impl IntoResponse, AppError> {
    Ok((StatusCode::CREATED, Json(c.create_job(&r, req).await?)))
}

#[derive(Deserialize)]
struct Funded {
    txid: String,
}

async fn mark_funded(State(c): State<AppState>, Researcher(r): Researcher, Path(id): Path<String>, Json(b): Json<Funded>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.mark_funded(&id, &r, b.txid.trim()).await?))
}

#[derive(Deserialize)]
struct Fund {
    raw_tx: String,
}

async fn fund_job(State(c): State<AppState>, Researcher(r): Researcher, Path(id): Path<String>, Json(b): Json<Fund>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.fund_with_raw_tx(&id, &r, b.raw_tx.trim()).await?))
}

async fn get_tx(State(c): State<AppState>, Path(txid): Path<String>) -> Result<impl IntoResponse, AppError> {
    let hex = c.get_raw_tx(&txid).await?;
    Ok(Json(json!({ "txid": txid, "hex": hex })))
}

async fn list_jobs(State(c): State<AppState>, headers: HeaderMap) -> Result<impl IntoResponse, AppError> {
    let r = headers.get(RESEARCHER_HEADER).and_then(|v| v.to_str().ok());
    Ok(Json(c.list_jobs(r).await?))
}

async fn get_job(State(c): State<AppState>, Path(id): Path<String>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.get_job(&id).await?))
}

async fn get_chunks(State(c): State<AppState>, Path(id): Path<String>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.get_chunks(&id).await?))
}

async fn get_result(State(c): State<AppState>, Path(id): Path<String>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.get_result(&id).await?))
}

async fn get_proof(State(c): State<AppState>, Path(id): Path<String>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.get_proof(&id).await?))
}

async fn close_job(State(c): State<AppState>, Researcher(r): Researcher, Path(id): Path<String>) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.close_job(&id, &r).await?))
}

#[derive(Deserialize)]
struct SessionReq {
    payout_addr: String,
    kernel_hash: String,
}

async fn worker_session(State(c): State<AppState>, Json(b): Json<SessionReq>) -> Result<impl IntoResponse, AppError> {
    Ok((StatusCode::CREATED, Json(c.create_worker(b.payout_addr.trim(), b.kernel_hash.trim()).await?)))
}

async fn worker_me(State(c): State<AppState>, AuthWorker(w): AuthWorker) -> Result<impl IntoResponse, AppError> {
    Ok(Json(c.worker_view(&w).await?))
}

async fn work_next(State(c): State<AppState>, AuthWorker(w): AuthWorker) -> Result<Response, AppError> {
    Ok(match c.next_work(&w).await? {
        Some(lease) => Json(lease).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[derive(Deserialize)]
struct ResultReq {
    hash: String,
    summary: Summary,
}

async fn work_result(State(c): State<AppState>, AuthWorker(w): AuthWorker, Path(assignment_id): Path<String>, Json(b): Json<ResultReq>) -> Result<impl IntoResponse, AppError> {
    let outcome = c.submit_result(&w, &assignment_id, &b.hash, b.summary).await?;
    Ok(Json(json!({ "status": outcome })))
}
