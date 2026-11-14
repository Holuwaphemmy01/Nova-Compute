# BLAZE 2026 baseline (Nov 14, 2026)

Everything in the `blaze-start` tag existed before the BLAZE kick-off; all work after it is the judged build.

- **Baseline code:** https://github.com/Holuwaphemmy01/nova-compute/tree/blaze-start
- **Baseline designs:** https://github.com/Holuwaphemmy01/nova-compute/tree/blaze-start/design
- **All hackathon work (compare view):** https://github.com/Holuwaphemmy01/nova-compute/compare/blaze-start...blaze-build

## What the baseline contains

Repository structure and documentation only. No product code, contracts, API handlers or UI components.

| Path | Contents |
|---|---|
| `README.md` | Project pitch, how it works, architecture overview, tech stack, repo layout |
| `LICENSE` | MIT license |
| `.gitignore` | Ignore rules for Rust, Node, WASM build output, `.env` and SQLite files |
| `.env.example` | Empty environment variable names (`CHIPNET_WIF`, `ORACLE_WIF`, `FEE_WIF`, `FULCRUM_URL`, `NETWORK`, `DATABASE_URL`) |
| `kernel/README.md` | Placeholder: what the Rust → WASM kernel will contain |
| `coordinator/README.md` | Placeholder: what the Rust coordinator will contain |
| `contracts/README.md` | Placeholder: what the CashScript escrow and tests will contain |
| `web/README.md` | Placeholder: what the React frontend will contain |
| `design/README.md` | List of the 8 planned screens (Landing, Connect wallet, My jobs, New job, Live job, Results, Provider setup, Earnings); no image exports |
| `docs/README.md` | Index of the docs folder |
| `docs/architecture.md` | Section headings only, plus a placeholder link to the spec |
| `docs/api.md` | Section headings only (REST endpoints, WebSocket events, error codes) |
| `docs/decisions.md` | Decision log with 4 entries dated 2026-11-11 |
| `.github/workflows/.gitkeep` | Empty folder for CI later |
