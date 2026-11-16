/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Coordinator base URL, e.g. http://localhost:8080 (default) or https://nova-coordinator.fly.dev */
  readonly VITE_API_URL?: string;
  /** "chipnet" (default) or "mainnet". Used for addresses, explorer links and the wallet network guard. */
  readonly VITE_NETWORK?: string;
  /** Machines page only: "true" → in-memory fake machines API. Unset → fake in dev, real in production. */
  readonly VITE_USE_FAKE_API?: string;
  /** Machines page only: coordinator origin for the machines API. Unset → same origin. */
  readonly VITE_API_BASE_URL?: string;
}
