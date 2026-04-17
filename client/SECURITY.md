# Security Notes — Frontend Auth & Session Management

## Token Storage Strategy

| Token | Storage | Rationale |
|---|---|---|
| Access token (JWT) | **In-memory only** (Zustand store) | Never persisted to disk. Lost on tab close, unreachable by XSS from `localStorage`/`sessionStorage`. |
| Refresh token | **`js-cookie`** (`__rt`) | The Go backend returns tokens in JSON responses — it does **not** set `HttpOnly` cookies. This is a known trade-off. |
| Session flag | **`js-cookie`** (`__sf`) | A boolean "session may exist" flag. Used on app load to decide whether to attempt silent refresh. Contains no secret data. |

## Known Trade-off: Refresh Token in JS-Accessible Cookie

Because the backend does not set `HttpOnly` cookies, the refresh token is stored in a regular cookie via `js-cookie`. An XSS attack **could** exfiltrate it.

### Mitigations in place:

1. **`sameSite: 'strict'`** — Cookie is never sent on cross-origin requests (CSRF protection).
2. **`secure: true` in production** — Cookie only travels over HTTPS.
3. **Non-descriptive key name** (`__rt`) — Doesn't advertise its purpose.
4. **Short-lived access tokens** (15 min) — Limits blast radius even if the refresh token is stolen.
5. **Server-side refresh token rotation** — Each refresh returns a new token and invalidates the old one.
6. **Server-side revocation** — Logout revokes the token server-side; stolen tokens become useless after logout.

### Recommended future improvement:

Modify the Go backend to set the refresh token as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie on `/auth/verify-otp` and `/auth/refresh` responses. Remove the `refresh_token` field from the JSON response body. This eliminates JS access entirely.

## What Is NOT Stored

- No PII in cookies (`__rt` is an opaque hex string, `__sf` is `"1"`)
- No tokens in `localStorage` or `sessionStorage`
- No user IDs, emails, or names in any persistent client-side storage
- Pre-signed URLs are **never** persisted — held only in React Query memory cache with a TTL shorter than the server-side URL expiry

## XSS Prevention

- All user-generated text (resume names, filenames) is rendered through React's auto-escaping JSX
- No `dangerouslySetInnerHTML` is used in auth or resume flows
- No `eval()` or dynamic `<script>` injection
- All API errors are normalised before reaching components (raw error objects never displayed)

## Cache Hygiene

- `queryClient.clear()` is called on **every** logout path, including forced logout from 401 responses
- On access token refresh, query cache is **not** invalidated (data identity hasn't changed)
- On user identity change (login), query cache **is** cleared to prevent data leakage between users
