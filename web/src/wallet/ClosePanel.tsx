import type { Job } from "../api/client";

/** Lets the researcher sweep unused chunk UTXOs back (wired to the wallet in a later stage). */
export function ClosePanel(_: { job: Job; onClosed: () => void }) {
  return null;
}
