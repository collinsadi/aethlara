/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL including the version prefix, e.g. https://api.example.com/api/v1 */
  readonly VITE_API_BASE_URL?: string
  /** Dashboard origin, e.g. https://app.example.com */
  readonly VITE_DASHBOARD_URL?: string
  /** Query parameter the dashboard handshake page carries the one-time token in. */
  readonly VITE_EXTENSION_TOKEN_PARAM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
