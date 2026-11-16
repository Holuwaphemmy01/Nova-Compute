/** Time remaining until `expiresAt`, formatted m:ss (e.g. "9:58"). */
export function countdown(expiresAt: string | number | Date, now: number): { expired: boolean; remainingMs: number; label: string } {
  const end = new Date(expiresAt).getTime();
  const remainingMs = Math.max(0, end - now);
  if (!Number.isFinite(end) || remainingMs <= 0) return { expired: true, remainingMs: 0, label: "0:00" };
  const total = Math.ceil(remainingMs / 1000);
  const label = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  return { expired: false, remainingMs, label };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s) || s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
