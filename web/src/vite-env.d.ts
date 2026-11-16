/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" → use the in-memory fake API. Unset → fake in dev, real API in production. */
  readonly VITE_USE_FAKE_API?: string;
  /** Coordinator origin, e.g. https://api.nova.example. Unset → same origin. */
  readonly VITE_API_BASE_URL?: string;
}
