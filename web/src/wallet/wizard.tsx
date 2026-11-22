/**
 * WizardConnect wallet integration (Riften Labs' hdwalletv1 protocol, via @wizardconnect/react).
 * One connection for the whole app, mounted in <WalletProvider>. Pages use useWallet().
 *
 * The protocol has no network field: the wallet only sends HD path xpubs. Addresses are derived
 * here (receive path, index 0) with the app's network prefix (VITE_NETWORK), and the xpub's
 * version prefix is used as a hint for the network guard (tpub → test network, xpub → mainnet).
 */
import { binToHex, encodeCashAddress, hash160 } from "@bitauth/libauth";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { useWizardConnect, type SessionStorage, type WizardConnectState } from "@wizardconnect/react";
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { CASHADDR_PREFIX } from "../config/env";
import { useWalletState, walletStore, type WalletState } from "./store";

/** Child indices used by the hdwalletv1 protocol (BCH convention). */
export const RECEIVE = 0;
export const CHANGE = 1;
export type PathName = "receive" | "change";

/** A transaction for the wallet to sign: the BCH WalletConnect object plus which HD path signs each input. */
export interface WizardTx {
  transaction: WcSignTransactionRequest;
  /** [inputIndex, pathName, addressIndex] for every input the wallet must sign. */
  inputPaths: [number, string, number][];
}

/** Errors with messages meant for people. */
export class WalletError extends Error {
  readonly kind: "rejected" | "not_connected" | "failed";
  constructor(kind: WalletError["kind"], message: string) {
    super(message);
    this.name = "WalletError";
    this.kind = kind;
  }
}

/** localStorage wrapper that never throws (private mode, blocked storage). */
const safeStorage: SessionStorage = {
  getItem(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* session just won't persist */
    }
  },
  removeItem(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export function addressOfPubkey(pubkey: Uint8Array): { address: string; pkh: string } {
  const pkh = hash160(pubkey);
  return { address: encodeCashAddress({ prefix: CASHADDR_PREFIX, type: "p2pkh", payload: pkh }).address, pkh: binToHex(pkh) };
}

/** Network hint from the xpub version prefix: tpub/upub/vpub → test networks, xpub → mainnet. */
export function networkHint(xpub: string | undefined): WalletState["network"] {
  if (!xpub) return null;
  if (/^[tuv]pub/.test(xpub)) return "chipnet";
  if (xpub.startsWith("xpub")) return "mainnet";
  return null;
}

interface WalletApi {
  wcState: WizardConnectState;
  uri: string | null;
  qrUri: string | null;
  error: string | null;
  manager: DappConnectionManager | null;
  connect: () => boolean;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wc = useWizardConnect({ dappName: "Nova Compute", dappIcon: `${location.origin}/nova-logo.png`, storage: safeStorage });
  const { manager, state, walletName } = wc;

  // Mirror the connection into the app-wide wallet store (public data only).
  useEffect(() => {
    const sync = () => {
      const pub = state === "connected" ? manager?.getPubkey(RECEIVE, 0n) : undefined;
      if (pub) {
        const { address, pkh } = addressOfPubkey(pub);
        walletStore.set({ status: "connected", address, pkh, walletName: manager?.walletName ?? walletName, network: networkHint(manager?.getSessionPaths()[0]?.xpub), error: null });
      } else if (state === "connecting" || state === "reconnecting" || state === "connected") {
        walletStore.set({ status: "connecting", address: null, pkh: null, error: null });
      } else {
        walletStore.set({ status: "disconnected", address: null, pkh: null, walletName: null, network: null });
      }
    };
    sync();
    manager?.on("walletready", sync);
    return () => {
      manager?.off("walletready", sync);
    };
  }, [manager, state, walletName]);

  useEffect(() => {
    if (wc.error) walletStore.set({ error: wc.error });
  }, [wc.error]);

  const api = useMemo<WalletApi>(() => ({ wcState: state, uri: wc.uri, qrUri: wc.qrUri, error: wc.error, manager, connect: wc.connect, disconnect: wc.disconnect }), [state, wc.uri, wc.qrUri, wc.error, manager, wc.connect, wc.disconnect]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Wallet connection + signing. `signTransaction` resolves with the signed tx hex. */
export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  const state = useWalletState();
  const { manager } = ctx;

  const signTransaction = useCallback(
    async (tx: WizardTx, opts: { signal?: AbortSignal } = {}): Promise<string> => {
      if (!manager || state.status !== "connected") throw new WalletError("not_connected", "Connect your wallet first.");
      let res;
      try {
        res = await manager.signTransaction({ transaction: tx.transaction, inputPaths: tx.inputPaths }, opts);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw new WalletError("rejected", "The signing request was cancelled.");
        throw new WalletError("failed", "We couldn't reach your wallet. Check it's open and connected, then try again.");
      }
      if (res.error || !res.signedTransaction) {
        const msg = (res.error ?? "").toLowerCase();
        if (!res.signedTransaction && (msg === "" || /reject|cancel|denied|declin|user/.test(msg))) {
          throw new WalletError("rejected", "Your wallet rejected the request.");
        }
        throw new WalletError("failed", `Your wallet couldn't sign it: ${res.error}`);
      }
      return res.signedTransaction;
    },
    [manager, state.status],
  );

  /** Compressed pubkey for (child, index), e.g. (RECEIVE, 3n). */
  const getPubkey = useCallback((child: number, index: bigint) => manager?.getPubkey(child, index), [manager]);

  return {
    ...state,
    connected: state.status === "connected",
    wcState: ctx.wcState,
    uri: ctx.uri,
    qrUri: ctx.qrUri,
    connectError: ctx.error,
    connect: ctx.connect,
    disconnect: ctx.disconnect,
    signTransaction,
    getPubkey,
  };
}
