# web/

React + TypeScript frontend (Vite) for Nova Compute.

## Run

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build into dist/
```

## Screens

Implemented from the design canvas (see [../design/](../design/)). All screens currently run on
demo data; the `TODO(api)`, `TODO(wallet)`, `TODO(kernel)` and `TODO(chain)` comments mark where the
coordinator API, WizardConnect, the WASM kernel and Fulcrum plug in.

| Route | Screen | Design |
|---|---|---|
| `/` | Landing | 1 · Landing |
| `/lab` | Simulation lab (free test, no wallet) | 1b · Simulation lab |
| `/connect` | Connect wallet (`?role=researcher\|provider`) | 2 · Connect wallet |
| `/jobs` | My jobs | 3 · Researcher · Jobs |
| `/jobs/new` | New job | 4 · Researcher · New job |
| `/jobs/live` | Live job | 5 · Researcher · Live job |
| `/results` | Results | 6 · Researcher · Results |
| `/provider` | Provider setup (browser GPU) | 7 · Provider · Set up |
| `/provider/earnings` | Earnings | 8 · Provider · Earnings |
| `/provider/machines` | Connect a GPU machine | 9 · Provider · Connect a GPU machine |

## Layout

```
src/
├── main.tsx, App.tsx      # entry + routes (page titles, scroll reset)
├── styles.css             # tokens, keyframes, hover/focus states
├── components/
│   ├── Headers.tsx        # SiteHeader, BareHeader, AppHeader (researcher/provider)
│   ├── Tracks.tsx         # particle-track SVG renderer
│   └── ui.tsx             # Logo, Spinner, Segmented, Chips, ProgressBar, …
├── lib/
│   ├── demo.ts            # placeholder addresses and pricing
│   ├── random.ts          # seeded PRNG for visuals, formatting helpers
│   ├── walk.ts            # illustrative particle walk (visuals only)
│   └── useInterval.ts
└── pages/                 # one file per screen
```

The WASM kernel build output goes in `public/pkg/` (git-ignored).
