import type { Job } from "../api/client";
import { fmt } from "../lib/random";

/** Shown on a job that is waiting for its escrow funding. */
export function FundPanel({ job }: { job: Job; onFunded: () => void }) {
  return (
    <section className="in" aria-label="Fund this job" style={{ padding: 24, borderRadius: 24, background: "#FFF6E3", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: "#6B4700" }}>This job is waiting for funding</span>
      <span style={{ fontSize: 15, color: "#6B4700", lineHeight: 1.55 }}>
        It needs {fmt(job.chunk_count)} outputs of {fmt(job.per_chunk_value)} sats ({fmt(job.total_sats)} sats in total) locked in its escrow:
      </span>
      <span className="mono" style={{ fontSize: 13, wordBreak: "break-all", color: "#6B4700" }}>{job.escrow_address}</span>
    </section>
  );
}
