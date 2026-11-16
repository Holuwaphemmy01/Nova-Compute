import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { merkleRoot } from "../lib/jobs";
import { ApiError, api } from "./client";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body === null ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("sends the researcher header and JSON body, returns the parsed response", async () => {
    const fetch = mockFetch(201, { job_id: "ab", per_chunk_value: 3000 });
    const r = await api.createJob("bchtest:qq", { params: { thickness_cm: 10, mfp_cm: 3, absorb_prob: 0.18 }, chunk_count: 4, trials_per_chunk: 10, price_per_worker: 1200 });
    expect(r.per_chunk_value).toBe(3000);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/jobs$/);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-Researcher-Address"]).toBe("bchtest:qq");
    expect(JSON.parse(init?.body as string).chunk_count).toBe(4);
  });

  it("uses the bearer token and maps 204 to null", async () => {
    const fetch = mockFetch(204, null);
    expect(await api.nextWork("tok")).toBeNull();
    expect((fetch.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("maps { error: { code, message } } to ApiError", async () => {
    mockFetch(410, { error: { code: "lease_expired", message: "lease expired" } });
    const e = await api.submitResult("t", "a1", "00", { transmitted: 0, reflected: 0, absorbed: 0, histogram: [] }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 410, code: "lease_expired", message: "lease expired" });
  });

  it("turns network failures into a human message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const e = await api.health().catch((x) => x);
    expect(e).toMatchObject({ code: "network" });
    expect(e.message).toMatch(/Can't reach the Nova coordinator/);
  });
});

describe("merkleRoot", () => {
  it("equals the Rust coordinator's root (odd leaf count → last duplicated)", async () => {
    const v = JSON.parse(readFileSync(new URL("../../../contracts/vectors/rust-p2pkh.json", import.meta.url), "utf8"));
    const leaves = ["chunk-0", "chunk-1", "chunk-2"].map((s) => createHash("sha256").update(s).digest("hex"));
    expect(await merkleRoot(leaves)).toBe(v.merkleRootHex);
    expect(await merkleRoot([leaves[0]])).toBe(leaves[0]);
    expect(await merkleRoot([])).toBeNull();
  });
});
