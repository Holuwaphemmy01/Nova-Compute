/**
 * Typed client for the Nova coordinator REST API (docs/api.md). Base URL: VITE_API_URL.
 * Every non-2xx response becomes an ApiError with the server's { error: { code, message } }.
 */
import { API_URL } from "../config/env";
import { ApiError } from "./errors";

export { ApiError };

// ---------------------------------------------------------------- types (from docs/api.md)

export interface JobParams {
  thickness_cm: number;
  mfp_cm: number;
  absorb_prob: number;
}

export interface CreateJobRequest {
  params: JobParams;
  chunk_count: number;
  trials_per_chunk: number;
  price_per_worker: number;
  master_seed?: string;
  refund_after?: number;
}

export interface JobCreated {
  job_id: string;
  config_hash: string;
  chunk_count: number;
  escrow_address: string;
  locking_bytecode: string;
  per_chunk_value: number;
  total_sats: number;
  status: JobStatus;
}

export type JobStatus = "awaiting_funding" | "running" | "finalizing" | "complete" | "closed";

export interface Job {
  job_id: string;
  researcher_addr: string;
  status: JobStatus;
  params: JobParams;
  master_seed: string;
  chunk_count: number;
  trials_per_chunk: number;
  price_per_worker: number;
  per_chunk_value: number;
  total_sats: number;
  refund_after: number;
  config_hash: string;
  escrow_address: string;
  funding_txid: string | null;
  merkle_root: string | null;
  op_return_txid: string | null;
  last_error: string | null;
  progress: { pending: number; paying: number; paid: number; unpaid: number };
  created_at: number;
}

export type ChunkStatus = "pending" | "paying" | "paid" | "unpaid";

export interface Chunk {
  index: number;
  status: ChunkStatus;
  attempt: number;
  /** Number of workers currently computing this chunk. */
  active_leases?: number;
  outpoint: string | null;
  verified_hash: string | null;
  resolved_by: "workers" | "coordinator" | null;
  payout_txid: string | null;
}

export interface JobResult {
  job_id: string;
  status: JobStatus;
  chunks_verified: number;
  chunk_count: number;
  trials: number;
  transmitted: number;
  reflected: number;
  absorbed: number;
  transmitted_fraction: number;
  transmitted_std_error: number;
  histogram: number[];
}

export interface JobProof {
  job_id: string;
  config_hash: string;
  escrow_address: string;
  funding_txid: string | null;
  merkle_root: string | null;
  op_return_txid: string | null;
  merkle_rule: string;
  leaves: { index: number; hash: string; resolved_by: string | null; payout_txid: string | null }[];
}

export interface CloseInfo {
  job_id: string;
  message: string;
  oracle_close_signature: string;
  oracle_pubkey: string;
  remaining: { index: number; txid: string; vout: number; value: number }[];
}

export interface Health {
  status: string;
  network: "chipnet" | "mainnet";
  fulcrum: "ok" | "unreachable";
  oracle_pubkey: string;
  fee_address: string;
  version: string;
}

export interface WorkerSession {
  worker_id: string;
  token: string;
}

export interface WorkerMe {
  worker_id: string;
  payout_addr: string;
  kernel_hash: string;
  verified: number;
  mismatched: number;
  earned_sats: number;
  active_lease: string | null;
  /** Recent payouts to this worker (newest first). */
  recent_payouts?: { job_id: string; index: number; txid: string; sats: number; at: number | null }[];
}

export interface Lease {
  assignment_id: string;
  job_id: string;
  index: number;
  master_seed: string;
  params: JobParams;
  trials: number;
  deadline: number;
}

export interface Summary {
  transmitted: number;
  reflected: number;
  absorbed: number;
  histogram: number[];
}

export type SubmitOutcome = "accepted" | "verified" | "mismatch";

// ---------------------------------------------------------------- transport

const RESEARCHER_HEADER = "X-Researcher-Address";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Worker bearer token. */
  token?: string;
  /** Researcher cashaddr (hackathon auth, see docs/api.md). */
  researcher?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, o: RequestOptions = {}): Promise<{ status: number; data: T | null }> {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.researcher) headers[RESEARCHER_HEADER] = o.researcher;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the Nova coordinator. Check your connection and try again.", "network");
  }
  if (res.status === 204) return { status: 204, data: null };
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status})`, err?.code ?? "http_error");
  }
  return { status: res.status, data: json as T };
}

const data = async <T>(p: Promise<{ data: T | null }>) => (await p).data as T;
const enc = encodeURIComponent;

// ---------------------------------------------------------------- endpoints

export const api = {
  health: (signal?: AbortSignal) => data(request<Health>("/health", { signal })),

  // jobs (researcher)
  createJob: (researcher: string, body: CreateJobRequest) => data(request<JobCreated>("/jobs", { method: "POST", body, researcher })),
  markFunded: (researcher: string, jobId: string, txid: string) => data(request<Job>(`/jobs/${enc(jobId)}/funded`, { method: "POST", body: { txid }, researcher })),
  /** Broadcasts a signed funding tx via the coordinator, then verifies it like /funded. */
  fundJob: (researcher: string, jobId: string, rawTx: string) => data(request<Job>(`/jobs/${enc(jobId)}/fund`, { method: "POST", body: { raw_tx: rawTx }, researcher })),
  listJobs: (researcher?: string, signal?: AbortSignal) => data(request<Job[]>("/jobs", { researcher, signal })),
  getJob: (jobId: string, signal?: AbortSignal) => data(request<Job>(`/jobs/${enc(jobId)}`, { signal })),
  getChunks: (jobId: string, signal?: AbortSignal) => data(request<Chunk[]>(`/jobs/${enc(jobId)}/chunks`, { signal })),
  getResult: (jobId: string, signal?: AbortSignal) => data(request<JobResult>(`/jobs/${enc(jobId)}/result`, { signal })),
  getProof: (jobId: string, signal?: AbortSignal) => data(request<JobProof>(`/jobs/${enc(jobId)}/proof`, { signal })),
  closeJob: (researcher: string, jobId: string) => data(request<CloseInfo>(`/jobs/${enc(jobId)}/close`, { method: "POST", researcher })),
  /** Raw tx hex fetched through the coordinator's Fulcrum connection. */
  getTx: (txid: string, signal?: AbortSignal) => data(request<{ txid: string; hex: string }>(`/tx/${enc(txid)}`, { signal })),

  // workers
  createSession: (payout_addr: string, kernel_hash: string) => data(request<WorkerSession>("/workers/session", { method: "POST", body: { payout_addr, kernel_hash } })),
  me: (token: string, signal?: AbortSignal) => data(request<WorkerMe>("/workers/me", { token, signal })),
  /** Next lease, or null when there's no work (204). */
  nextWork: async (token: string, signal?: AbortSignal) => (await request<Lease>("/work/next", { method: "POST", token, signal })).data,
  submitResult: (token: string, assignmentId: string, hash: string, summary: Summary) =>
    data(request<{ status: SubmitOutcome }>(`/work/${enc(assignmentId)}/result`, { method: "POST", token, body: { hash, summary } })),
};

/** Human-readable message for any error thrown by the client or wallet code. */
export function humanError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
