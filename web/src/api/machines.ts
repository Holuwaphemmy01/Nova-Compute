/**
 * Machines API: the contract between the web app and the Rust coordinator.
 *
 *   POST   /api/v1/machines/pair-code   -> PairCode
 *   GET    /api/v1/machines             -> Machine[]
 *   PATCH  /api/v1/machines/{id}        body MachinePatch -> Machine
 *   DELETE /api/v1/machines/{id}        -> 204
 *
 * Used by the native worker (not by this app), documented here so both sides agree:
 *   POST   /api/v1/machines/claim
 *          body { code, hardware: { name, gpu, vram_gb, backend }, kernel_hash }
 *          -> { machine_id, machine_token }
 *
 * The page talks only to `machinesApi` below. VITE_USE_FAKE_API=true selects the
 * in-memory fake (the default in `pnpm dev`); otherwise requests go to the coordinator
 * at VITE_API_BASE_URL (default: same origin).
 */
import { ApiError } from "./errors";
import { createFakeMachinesApi } from "./fake/machines";

export { ApiError };

export type Backend = "vulkan" | "dx12" | "metal";
export type MachineStatus = "online" | "paused" | "offline";
export type SelfTest = "passed" | "failed" | "pending";
export type GpuLimit = 50 | 80 | 100;

export type Machine = {
  id: string;
  name: string;
  gpu: string;
  vram_gb: number;
  backend: Backend;
  status: MachineStatus;
  self_test: SelfTest;
  particles_per_sec: number;
  pieces_finished: number;
  earned_sats: number;
  gpu_limit: GpuLimit;
  last_seen: string; // ISO 8601
};

export type PairCode = { code: string; expires_at: string /* ISO 8601 */ };

export type MachinePatch = { paused?: boolean; gpu_limit?: GpuLimit };

/** Worker → coordinator claim request (implemented by the native worker later). */
export type ClaimRequest = {
  code: string;
  hardware: { name: string; gpu: string; vram_gb: number; backend: Backend };
  kernel_hash: string;
};
export type ClaimResponse = { machine_id: string; machine_token: string };

export interface MachinesApi {
  createPairCode(): Promise<PairCode>;
  listMachines(): Promise<Machine[]>;
  updateMachine(id: string, patch: MachinePatch): Promise<Machine>;
  removeMachine(id: string): Promise<void>;
  /** Demo only: present on the fake API, never on the real one. */
  simulatePairing?(): Promise<Machine>;
}

const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1`;

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  // TODO(auth): attach the wallet session once the coordinator defines it.
  const res = await fetch(BASE + path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const httpMachinesApi: MachinesApi = {
  createPairCode: () => http<PairCode>("/machines/pair-code", { method: "POST" }),
  listMachines: () => http<Machine[]>("/machines"),
  updateMachine: (id, patch) =>
    http<Machine>(`/machines/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeMachine: (id) => http<void>(`/machines/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** Fake when VITE_USE_FAKE_API is "true"; when the flag is unset, fake in dev only. */
const flag = import.meta.env.VITE_USE_FAKE_API;
export const usingFakeApi = flag === undefined || flag === "" ? import.meta.env.DEV : flag === "true";

export const machinesApi: MachinesApi = usingFakeApi ? createFakeMachinesApi() : httpMachinesApi;
