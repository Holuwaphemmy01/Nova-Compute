/** Runtime configuration from Vite env vars. */

export type NetworkName = "chipnet" | "mainnet";

export const API_URL: string = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export const NETWORK: NetworkName = import.meta.env.VITE_NETWORK === "mainnet" ? "mainnet" : "chipnet";

export const CASHADDR_PREFIX = NETWORK === "mainnet" ? "bitcoincash" : "bchtest";

export function explorerTx(txid: string): string {
  return NETWORK === "mainnet" ? `https://explorer.bitcoinunlimited.info/tx/${txid}` : `https://chipnet.imaginary.cash/tx/${txid}`;
}

/** Matches the coordinator: each chunk UTXO = 2 × price + this fee margin. */
export const FEE_MARGIN = 600;
export const chunkValue = (price: number) => 2 * price + FEE_MARGIN;

export const shortAddress = (a: string) => {
  const body = a.includes(":") ? a.split(":")[1] : a;
  return body.length > 12 ? `${body.slice(0, 4)}…${body.slice(-4)}` : body;
};
