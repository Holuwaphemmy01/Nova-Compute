/**
 * The browser worker's coordinator session (bearer token), kept in localStorage so a refresh
 * doesn't create a new worker. The token only authorizes leasing/submitting work for this
 * payout address; it is not a key and can't move funds.
 */
import { useSyncExternalStore } from "react";
import { storage } from "./browser";

const KEY = "nova.worker.session";

export interface WorkerSessionInfo {
  workerId: string;
  token: string;
  payoutAddr: string;
}

function read(): WorkerSessionInfo | null {
  try {
    const v = JSON.parse(storage.get(KEY) ?? "null");
    return v && typeof v.token === "string" && typeof v.payoutAddr === "string" ? v : null;
  } catch {
    return null;
  }
}

let current = read();
const listeners = new Set<() => void>();

export const workerSession = {
  get: () => current,
  set(s: WorkerSessionInfo | null) {
    current = s;
    if (s) storage.set(KEY, JSON.stringify(s));
    else storage.remove(KEY);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useWorkerSession() {
  return useSyncExternalStore(workerSession.subscribe, workerSession.get, workerSession.get);
}
