/** Writes vectors/payout.json (deterministic). Usage: pnpm vectors */
import { writeFileSync } from "node:fs";
import { makePayoutVector } from "../src/vectors.js";

const path = new URL("../vectors/payout.json", import.meta.url);
writeFileSync(path, JSON.stringify(makePayoutVector(), null, 2) + "\n");
console.log(`wrote ${path.pathname}`);
