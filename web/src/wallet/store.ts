/**
 * Connected-wallet state shared by the whole app (header chip, researcher and provider pages).
 * The WizardConnect integration (./wizard.ts) writes it; components read it via useWalletState().
 * Holds public data only (addresses, public key hashes); never private keys.
 */
import { useSyncExternalStore } from "react";

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface WalletState {
  status: WalletStatus;
  /** Receive address (cashaddr) of the connected wallet. */
  address: string | null;
  /** hash160 of the receive pubkey, hex. */
  pkh: string | null;
  walletName: string | null;
  /** Network detected from the wallet, if it tells us; null when unknown. */
  network: "chipnet" | "mainnet" | null;
  error: string | null;
}

const initial: WalletState = { status: "disconnected", address: null, pkh: null, walletName: null, network: null, error: null };

let state: WalletState = initial;
const listeners = new Set<() => void>();

export const walletStore = {
  get: () => state,
  set(patch: Partial<WalletState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  reset() {
    state = initial;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useWalletState(): WalletState {
  return useSyncExternalStore(walletStore.subscribe, walletStore.get, walletStore.get);
}
