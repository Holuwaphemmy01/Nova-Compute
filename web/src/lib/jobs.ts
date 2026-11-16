import type { Chunk, Job } from "../api/client";

export const jobTitle = (j: Pick<Job, "params">) => `Particles through a ${j.params.thickness_cm} cm wall`;

/** How a chunk is shown in the Live job grid. */
export type ChunkDisplay = "queued" | "running" | "verified" | "retrying" | "unpaid";

export function chunkDisplay(c: Chunk): ChunkDisplay {
  if (c.status === "paid" || c.status === "paying") return "verified";
  if (c.status === "unpaid") return "unpaid";
  if ((c.active_leases ?? 0) > 0) return c.attempt > 0 ? "retrying" : "running";
  return c.attempt > 0 ? "retrying" : "queued";
}

/** Same rule as the coordinator: SHA-256 over pairs in index order, duplicating the last when odd. */
export async function merkleRoot(leavesHex: string[]): Promise<string | null> {
  if (leavesHex.length === 0) return null;
  const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
  const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  let level: Uint8Array[] = leavesHex.map(fromHex);
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const pair = new Uint8Array(64);
      pair.set(level[i], 0);
      pair.set(level[i + 1], 32);
      next.push(new Uint8Array(await crypto.subtle.digest("SHA-256", pair)));
    }
    level = next;
  }
  return toHex(level[0]);
}
