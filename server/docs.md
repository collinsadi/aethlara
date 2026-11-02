# API Documentation

Base URL: `/api/v1`

All responses use a consistent envelope:

**Success:**
```json
{ "data": { ... }, "message": "optional string" }
```

**Error:**
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message." } }
```

---

## Authentication

Most endpoints are public. Protected endpoints require:
```
Authorization: Bearer <access_token>
```

---

## Endpoints

### 1. POST /auth/signup

**Purpose:** Register a new user by email. Sends a 6-digit OTP. The user record is not created until OTP is verified.

**Authentication:** None

**Rate limit:** 5 requests per IP per 15 minutes

**Request headers:**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |

**Request body:**
```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `full_name` | string | Yes | 2–100 chars; letters, spaces, hyphens only |
| `email` | string | Yes | Valid RFC 5322 format; max 255 chars; normalised to lowercase |

**Success response `202`:**
```json
{
  "data": null,
  "message": "If this email is valid, a verification code has been sent."
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `400` | `INVALID_INPUT` | Validation failure on `full_name` or `email` |
| `429` | `RATE_LIMITED` | IP rate limit exceeded |
| `500` | `INTERNAL_ERROR` | Server error |

*Note: A `409` is intentionally suppressed — the same `202` is returned even if the email is already registered. This prevents user enumeration.*

**Security notes:**
- OTP generated with `crypto/rand` (never `math/rand`)
- OTP hashed with bcrypt before DB storage
- Previous unused OTPs for the same email+type are invalidated on each new request
- Response is identical regardless of whether the email exists

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"full_name": "Jane Doe", "email": "jane@example.com"}'
```

---

### 2. POST /auth/verify-otp

**Purpose:** Verify the OTP, complete signup or login, and issue JWT + refresh token.

**Authentication:** None

**Rate limit:** 10 requests per IP per 10 minutes

**Request headers:**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |

**Request body:**
```json
{
  "email": "jane@example.com",
  "otp": "482910",
  "type": "signup"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | Yes | Valid email format |
| `otp` | string | Yes | Exactly 6 digits |
| `type` | string | Yes | `"signup"` or `"login"` |

**Success response `200`:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiJ9...",
    "refresh_token": "a3f9b2c1...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "01234567-89ab-cdef-0123-456789abcdef",
      "full_name": "Jane Doe",
      "email": "jane@example.com",
      "billing_plan": "free",
      "created_at": "2026-04-16T10:00:00Z"
    }
  }
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `400` | `INVALID_INPUT` | Validation failure |
| `400` | `INVALID_OTP` | OTP is incorrect or no active OTP found |
| `400` | `OTP_EXPIRED` | OTP has expired |
| `429` | `OTP_MAX_ATTEMPTS` | Exceeded max verification attempts |
| `429` | `RATE_LIMITED` | IP rate limit exceeded |
| `500` | `INTERNAL_ERROR` | Server error |

**Security notes:**
- Brute-force lockout: after `OTP_MAX_ATTEMPTS` incorrect attempts, the OTP is invalidated and `429` is returned
- OTP comparison uses bcrypt (`CompareHashAndPassword`) — inherently timing-safe
- Refresh token is opaque, 32 bytes of `crypto/rand`, stored as SHA-256 hash only; the raw value is returned to the client exactly once
- Access token has 15-minute expiry; store refresh token in `HttpOnly; Secure; SameSite=Strict` cookie

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "jane@example.com", "otp": "482910", "type": "signup"}'
```

---

### 3. POST /auth/login

**Purpose:** Initiate passwordless login for an existing verified user. Sends OTP.

**Authentication:** None

**Rate limit:** 5 requests per IP per 15 minutes

**Request headers:**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |

**Request body:**
```json
{
  "email": "jane@example.com"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | Yes | Valid email format |

**Success response `202`:**
```json
{
  "data": null,
  "message": "If this email is associated with an account, a login code has been sent."
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `400` | `INVALID_INPUT` | Invalid email format |
| `429` | `RATE_LIMITED` | IP rate limit exceeded |
| `500` | `INTERNAL_ERROR` | Server error |

**Security notes:**
- Identical `202` response whether the user exists, does not exist, or is unverified
- A dummy bcrypt hash is computed when the user does not exist to equalise timing between code paths
- Client should call `POST /auth/verify-otp` with `type=login` to complete sign-in

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "jane@example.com"}'
```

---

### 4. POST /auth/refresh

**Purpose:** Issue a new access token (and rotated refresh token) using a valid refresh token.

**Authentication:** None — authenticates via the refresh token itself

**Rate limit:** Global (10 req/min per IP)

**Request headers:**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Refresh-Token` | *(alternative to body field)* |

**Request body:**
```json
{
  "refresh_token": "a3f9b2c1..."
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `refresh_token` | string | Yes | Opaque token from prior login/refresh. Also accepted as `Refresh-Token` header. |

**Success response `200`:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiJ9...",
    "refresh_token": "b7c2d3e4...",
    "expires_in": 900
  }
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `400` | `INVALID_INPUT` | Missing `refresh_token` |
| `401` | `TOKEN_INVALID` | Token not found or expired |
| `401` | `TOKEN_REVOKED` | Revoked token presented (breach signal — all sessions invalidated) |
| `500` | `INTERNAL_ERROR` | Server error |

**Security notes:**
- **Refresh token rotation:** the old token is revoked on every use; a new token is issued
- **Reuse detection:** presenting a revoked token triggers immediate revocation of *all* sessions for that user, indicating a possible token theft. The client receives `401 TOKEN_REVOKED`
- Tokens are bound to `user_agent` and `ip_address` at creation (logged; rejection policy configurable)

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "a3f9b2c1..."}'
```

---

### 5. POST /auth/logout

**Purpose:** Revoke the current session's refresh token.

**Authentication:** `Authorization: Bearer <access_token>` required

**Rate limit:** Global (10 req/min per IP)

**Request headers:**
| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <access_token>` |

**Request body:**
```json
{
  "refresh_token": "a3f9b2c1..."
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `refresh_token` | string | Yes | Must belong to the authenticated user |

**Success response `200`:**
```json
{
  "data": null,
  "message": "Logged out successfully."
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `400` | `INVALID_INPUT` | Missing `refresh_token` |
| `401` | `UNAUTHORIZED` | Missing or invalid access token |
| `403` | `FORBIDDEN` | Token does not belong to the authenticated user |
| `500` | `INTERNAL_ERROR` | Server error |

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/logout \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "a3f9b2c1..."}'
```

---

### 6. POST /auth/logout-all

**Purpose:** Revoke all sessions for the authenticated user (all devices).

**Authentication:** `Authorization: Bearer <access_token>` required

**Rate limit:** Global (10 req/min per IP)

**Request headers:**
| Header | Value |
|---|---|
| `Authorization` | `Bearer <access_token>` |

**Success response `200`:**
```json
{
  "data": null,
  "message": "All sessions logged out successfully."
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid access token |
| `500` | `INTERNAL_ERROR` | Server error |

**curl example:**
```bash
curl -X POST https://api.example.com/api/v1/auth/logout-all \
  -H "Authorization: Bearer eyJ..."
```

---

### 7. GET /user/me

**Purpose:** Return the authenticated user's profile.

**Authentication:** `Authorization: Bearer <access_token>` required

**Rate limit:** Global (10 req/min per IP)

**Request headers:**
| Header | Value |
|---|---|
| `Authorization` | `Bearer <access_token>` |

**Success response `200`:**
```json
{
  "data": {
    "id": "01234567-89ab-cdef-0123-456789abcdef",
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "billing_plan": "free",
    "is_verified": true,
    "last_login_at": "2026-04-16T10:00:00Z",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Error responses:**

| Status | Code | Trigger |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid access token |
| `500` | `INTERNAL_ERROR` | Server error |

**Security notes:**
- User ID is read from the validated JWT claims — never from request parameters
- Sensitive internal fields (OTP hashes, token hashes) are never included

**curl example:**
```bash
curl -X GET https://api.example.com/api/v1/user/me \
  -H "Authorization: Bearer eyJ..."
```

---

### 8. GET /health

**Purpose:** Liveness and readiness check. Returns DB connectivity status and app version.

**Authentication:** None

**Rate limit:** Global

**Success response `200`:**
```json
{
  "status": "ok",
  "db": "ok",
  "version": "1.0.0",
  "env": "production"
}
```

**Degraded response `503`:**
```json
{
  "status": "error",
  "db": "error",
  "version": "1.0.0",
  "env": "production"
}
```

**curl example:**
```bash
curl https://api.example.com/health
```

---

## Global Middleware

| Middleware | Behaviour |
|---|---|
| `RequestID` | Attaches `X-Request-ID` to every request and response (passthrough or generated) |
| `Logger` | Structured JSON log per request: method, path, status, latency, request ID, IP. `Authorization` header is never logged. |
| `RecoverPanic` | Catches panics, logs stack trace, returns `500` |
| `CORS` | Whitelists origins from `CORS_ALLOWED_ORIGINS`; rejects others with `403` |
| `SecurityHeaders` | Sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy`; adds `Strict-Transport-Security` in production |
| `RateLimit` | Per-IP token bucket (global + per-endpoint overrides) |
| `RequireAuth` | Validates JWT on protected routes; injects user ID into request context |

---

## Error Code Reference

| Code | Meaning |
|---|---|
| `INVALID_INPUT` | Request validation failed |
| `INVALID_OTP` | OTP is incorrect or no active OTP exists |
| `OTP_EXPIRED` | OTP has passed its expiry time |
| `OTP_MAX_ATTEMPTS` | Too many incorrect OTP attempts |
| `UNAUTHORIZED` | Missing or invalid access token |
| `FORBIDDEN` | Authenticated but not permitted |
| `NOT_FOUND` | Resource not found |
| `INTERNAL_ERROR` | Unexpected server error |
| `RATE_LIMITED` | Per-IP rate limit exceeded |
| `TOKEN_INVALID` | Refresh token is invalid or expired |
| `TOKEN_REVOKED` | Refresh token was revoked (possible breach) |

---

## Security Notes

### Token storage (client guidance)
- Store the `access_token` in memory only (never `localStorage`)
- Store the `refresh_token` in an `HttpOnly; Secure; SameSite=Strict` cookie
- Never log tokens

### OTP security
- OTPs are generated using `crypto/rand` — cryptographically secure
- Stored as bcrypt hashes — never plaintext
- Single-use: marked consumed immediately on successful verification
- Locked after `OTP_MAX_ATTEMPTS` incorrect attempts (default 5)

### Transport
- HTTPS must be enforced in production via reverse proxy
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` is set in production

### Database
- All queries use parameterised statements — zero string interpolation
- DB connection uses `sslmode=require` in production (set in `DATABASE_URL`)
- Sensitive columns (`code_hash`, `token_hash`) are never returned in API responses

---

## AI Provider Architecture (Non-Negotiable)

This platform holds **no platform-level AI key** for any provider. Every AI
call — resume extraction, job extraction, resume alignment, autofill, chat,
lead scoring, cover letters, inbox triage — resolves the authenticated user's
own encrypted key per request. Two providers are supported:

| Provider | Key prefix | Transport | Web search |
|---|---|---|---|
| `anthropic` | `sk-ant-` | Official Anthropic Go SDK (`anthropic-sdk-go/v2`), streaming Messages API | Yes (server-side `web_search` tool) |
| `openrouter` | `sk-or-` | OpenAI-compatible `/chat/completions` over HTTPS | No |

Each user has one **active provider** (default `openrouter` for accounts that
predate multi-provider support) and two model slots:

- **smart** — tailoring, cover letters, application form filling, chat.
  Defaults: `ANTHROPIC_MODEL` (`claude-opus-5-5`) / `OPENROUTER_MODEL`
  (`anthropic/claude-opus-5.5`).
- **fast** — bulk lead scoring and inbox triage. Defaults:
  `ANTHROPIC_FAST_MODEL` (`claude-haiku-5-5`) / `OPENROUTER_FAST_MODEL`
  (`anthropic/claude-haiku-5.5`).

**Guarantees:**
- `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` are NOT valid server environment
  variables. The Anthropic SDK client is built with
  `option.WithoutEnvironmentDefaults()` so it can never pick up a key, auth
  token or CLI profile from the host; the user's key is attached per request.
- Decrypted keys live only inside a single call's stack frame.
- Every AI-dependent endpoint is gated by the `AIGate` middleware, which
  checks that the user has a valid key **for their active provider** before
  the handler runs.
- Service-level code also validates the key (defence-in-depth) and returns
  `ai.ErrNoAPIKey` if none is available, which handlers map to `403
  API_KEY_REQUIRED`.
- Anthropic requests on models that support it send the server-side refusal
  fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`),
  structured outputs (`output_config.format`) for JSON-shaped stages, and an
  `effort` hint (`low` for fast-tier work, `medium` otherwise).

**403 shape used for missing / invalid keys:**
```json
{
  "error": {
    "code": "API_KEY_REQUIRED",
    "message": "An AI provider API key (Anthropic or OpenRouter) is required to use this feature. Add your key in Settings.",
    "action": { "label": "Add API Key", "path": "/settings#ai" }
  }
}
```

Endpoints protected by the AI gate:
- `POST /resumes/upload`
- `POST /jobs`, `POST /jobs/extract-from-extension`, `POST /jobs/:id/autofill`
- `POST /chat/sessions`
- `POST /chat/sessions/:session_id/messages`
- `POST /agent/runs`, `POST /agent/leads`, `POST /agent/applications/:id/fill`

---

## AI Settings

All endpoints require `Authorization: Bearer <access_token>`.

### GET /settings/ai

**Purpose:** Return the active provider, model overrides, effective models,
stored keys (metadata only) and the provider catalogue for the settings UI.

**Success `200`:**
```json
{
  "data": {
    "provider": "anthropic",
    "smart_model": null,
    "fast_model": "claude-haiku-5-5",
    "effective_smart_model": "claude-opus-5-5",
    "effective_fast_model": "claude-haiku-5-5",
    "keys": [
      {
        "id": "uuid", "provider": "anthropic", "key_prefix": "sk-ant-api03-AbCd",
        "label": null, "validation_status": "valid",
        "last_used_at": "2026-11-02T10:00:00Z", "last_validated_at": "2026-11-02T09:00:00Z",
        "created_at": "2026-11-01T09:00:00Z"
      }
    ],
    "providers": [
      { "id": "anthropic", "label": "Anthropic", "key_prefix": "sk-ant-", "supports_web_search": true,
        "suggested_models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] },
      { "id": "openrouter", "label": "OpenRouter", "key_prefix": "sk-or-", "supports_web_search": false,
        "suggested_models": ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-haiku-5.5", "anthropic/claude-fable-5.1"] }
    ]
  }
}
```

### PUT /settings/ai

**Purpose:** Switch the active provider and/or set model overrides.

**Rate limit:** shared API-key limiter (200/min per user).

**Request body:**
```json
{ "provider": "anthropic", "smart_model": "claude-opus-5-5", "fast_model": "" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `provider` | string | Yes | `anthropic` or `openrouter`. Must have a valid stored key. |
| `smart_model` | string | No | Omit to keep the current override (cleared when the provider changes). `""` resets to the server default. 1-100 chars of `[A-Za-z0-9._:/-]`. |
| `fast_model` | string | No | Same rules as `smart_model`. |

**Errors:** `400 INVALID_INPUT`, `422 PROVIDER_KEY_REQUIRED` (no valid key for that provider).

### POST /settings/api-key

**Purpose:** Validate (live call) and store an encrypted provider key.

**Request body:**
```json
{ "api_key": "sk-ant-...", "provider": "anthropic", "label": "personal", "make_active": true }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `api_key` | string | Yes | Must match the provider prefix; 20-256 chars, no whitespace. |
| `provider` | string | No | `openrouter` (default, backwards compatible) or `anthropic`. |
| `label` | string | No | Max 50 chars. |
| `make_active` | bool | No | Default `true`: switch the active provider to this one. |

**Success `201`:** key metadata (same shape as `keys[]` above).
**Errors:** `422 INVALID_API_KEY` (bad format or rejected by the provider).

### GET /settings/api-key?provider=

Returns key metadata for `provider` (default: the active provider), or
`data: null` when none is stored.

### GET /settings/api-keys

Returns metadata for every stored key.

### DELETE /settings/api-key?provider=

Deletes the key for `provider` (default: the active provider). If that was the
active provider and another valid key exists, the active provider switches to
it automatically.

### POST /settings/api-key/validate?provider=

Re-runs the liveness check and updates `validation_status`. Anthropic keys
are checked with a free `GET /v1/models` call; OpenRouter keys with a 16-token
completion on the fast model.

---

## Job Chat

A per-job chat interface for discussing the user's application strategy,
alignment gaps, interview prep, and cover letter drafting — scoped strictly to
one job. Chat history is persistent and assembled with rich context
(`extracted_job_json`, `tailored_resume_json`, resume data) on every turn.

Prompt version: `job_chat_v1.0.0` (logged on every assistant message).

### Security notes
- Resume PII (email, phone, full name) is stripped server-side before the
  prompt is assembled.
- Raw `extracted_job_json` and `tailored_resume_json` blobs are NEVER embedded
  in the prompt — only structured summaries.
- Scope-guarding rules in the system prompt instruct the model to refuse
  off-topic questions.
- All endpoints are authenticated; the AI-triggering ones also pass through
  the AI gate (see above).

### POST /chat/sessions

**Purpose:** Create a new chat session for a job, or return the existing one.

**Authentication:** Required. **AI gate:** Required.

**Rate limit:** 20/user per minute (burst 20).

**Request body:**
```json
{ "job_id": "<uuid>" }
```

**Success `201 Created`** (new session) **or `200 OK`** (existing session):
```json
{
  "data": {
    "id": "<uuid>",
    "job_id": "<uuid>",
    "job_title": "Senior Backend Engineer",
    "company": "Acme Co.",
    "match_score": 82,
    "message_count": 0,
    "last_message_at": null,
    "created_at": "2025-05-01T12:34:56Z"
  }
}
```

**Errors:**
| Code | Status |
|---|---|
| `INVALID_INPUT` | 400 |
| `NOT_FOUND` | 404 (job not found) |
| `JOB_NOT_READY` | 409 (alignment not complete) |
| `API_KEY_REQUIRED` | 403 |

---

### GET /chat/sessions

**Purpose:** List the user's active chat sessions, newest-activity first.

**Authentication:** Required.

**Success `200 OK`:**
```json
{
  "data": {
    "items": [
      {
        "id": "<uuid>",
        "job_id": "<uuid>",
        "job_title": "Senior Backend Engineer",
        "company": "Acme Co.",
        "match_score": 82,
        "message_count": 4,
        "last_message_at": "2025-05-02T09:30:00Z",
        "created_at": "2025-05-01T12:34:56Z"
      }
    ]
  }
}
```

---

### GET /chat/sessions/:session_id/messages

**Purpose:** Load a page of messages for a session (cursor-based pagination,
oldest-first within the page, system messages never included).

**Authentication:** Required.

**Query parameters:**
| Param | Type | Default | Notes |
|---|---|---|---|
| `before` | uuid | — | Cursor: oldest currently-loaded message id. Omit to load most recent page. |
| `limit`  | int  | 50    | Max 100. |

**Success `200 OK`:**
```json
{
  "data": {
    "messages": [
      {
        "id": "<uuid>",
        "role": "user",
        "content": "What gaps stand out the most?",
        "created_at": "2025-05-02T09:30:00Z"
      },
      {
        "id": "<uuid>",
        "role": "assistant",
        "content": "You're strong on X but missing Y…",
        "model_used": "anthropic/claude-3.5-sonnet",
        "metadata": { "tokens_in": 850, "tokens_out": 220, "finish_reason": "stop", "latency_ms": 2100 },
        "created_at": "2025-05-02T09:30:04Z"
      }
    ],
    "has_more": true,
    "oldest_message_id": "<uuid>"
  }
}
```

---

### POST /chat/sessions/:session_id/messages

**Purpose:** Send a user message and receive the assistant's reply. The user
message is persisted BEFORE the AI call so it is never lost on failure.

**Authentication:** Required. **AI gate:** Required.

**Rate limits (per user, ANDed):**
- 10 messages per minute
- 30 messages per hour

**Request body:**
```json
{ "content": "Draft a 3-paragraph cover letter." }
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `content` | string | Yes | 1–4000 chars after trimming |

**Success `201 Created`:**
```json
{
  "data": {
    "id": "<uuid>",
    "role": "assistant",
    "content": "Dear hiring team…",
    "model_used": "anthropic/claude-3.5-sonnet",
    "metadata": { "tokens_in": 950, "tokens_out": 420, "finish_reason": "stop", "latency_ms": 2400 },
    "created_at": "2025-05-02T09:30:04Z"
  }
}
```

**Errors:**
| Code | Status |
|---|---|
| `INVALID_INPUT` | 400 |
| `NOT_FOUND` | 404 |
| `RATE_LIMITED` | 429 |
| `API_KEY_REQUIRED` | 403 |
| `AI_UNAVAILABLE` | 502 |
| `CONTEXT_ASSEMBLY_FAILED` | 500 |

---

### DELETE /chat/sessions/:session_id

**Purpose:** Soft-delete a chat session and its messages. The row remains in
the DB with `deleted_at` set so analytics can still reason about activity.

**Authentication:** Required.

**Success `200 OK`:**
```json
{ "data": { "id": "<uuid>" }, "message": "Chat session deleted." }
```

---

## Autopilot (Agent)

The autopilot searches job boards for the user, scores every posting against
their resume, and asks the user to approve the ones worth applying to. On the
next run it applies to everything approved:

- **Email applications** (postings that say "send your CV to ...") are sent by
  the server from the user's agent mailbox, with the tailored resume attached.
- **Form applications** (Greenhouse, Lever, Ashby and other ATS pages) are
  queued for the Chrome extension, which fills and submits them in the user's
  own browser.

Replies arrive in the agent mailbox (Resend Inbound), are triaged by AI, and
move the tracker automatically (confirmation -> applied, rejection ->
rejected, interview/assessment -> interview, offer -> offer).

### Run loop

A run is triggered by the scheduler (every `run_interval_hours` while the
profile is `enabled`) or manually (`POST /agent/runs`). Each run:

1. **Applies** to approved leads (status `queued` applications), up to
   `apply_settings.daily_limit` per rolling 24 hours: scrape the full posting
   if needed, tailor the resume (same pipeline as `POST /jobs`, recorded with
   `input_method: "agent"`), write a cover letter, then email it or mark it
   `ready` for the extension.
2. **Discovers** new postings from every enabled source, drops what cannot
   fit (titles, excluded keywords/companies, remote/location, employment type,
   age for aggregators), removes duplicates, and scores up to
   `AGENT_MAX_LEADS_SCORED_PER_RUN` postings with the user's **fast** model.
   Leads below `search_prefs.min_score` (or with a deal-breaker) are stored as
   `dismissed` so they are never re-scored.
3. **Auto-approves** leads at or above `apply_settings.auto_approve_score`
   (off by default) and applies to them in the same run.
4. **Expires** leads left unreviewed for 21 days and emails a **digest** to the
   account email.

### Statuses

| Lead `status` | Meaning |
|---|---|
| `new` | Awaiting the user's decision |
| `approved` | Approved; an application is queued |
| `applying` | Application being prepared or waiting on the extension |
| `applied` | Submitted |
| `failed` | Preparation or submission failed (retryable) |
| `dismissed` | Dismissed by the user, or auto-dismissed (`dismiss_reason`: `user`, `low_score`, `dealbreaker`, `cancelled`) |
| `expired` | Not reviewed within 21 days |

| Application `status` | Meaning |
|---|---|
| `queued` | Approved; will be prepared on the next run |
| `preparing` | Tailoring / cover letter in progress |
| `ready` | Waiting for the extension to claim it (`channel: browser`) |
| `in_progress` | Claimed by the extension (lease: `AGENT_CLAIM_LEASE_MINUTES`) |
| `needs_input` | Waiting on the user (`needs.reason`: `missing_answers`, `captcha`, `login_required`, `verification`, `unsupported_form`, `review`) |
| `submitted` | Done |
| `failed` | See `last_error`; `POST .../retry` re-queues it |
| `cancelled` | Cancelled by the user |

### Mailbox setup (Resend Inbound)

1. Choose a subdomain for agent mail, e.g. `agent.example.com`, and set
   `AGENT_MAIL_DOMAIN=agent.example.com`. Use a subdomain: once its MX points
   at Resend, Resend receives **all** mail for that domain.
2. In Resend, add the domain for receiving and create the MX record it shows.
   Verify the same domain for sending (SPF/DKIM) so email applications can be
   sent from it.
3. Add a webhook for `email.received` pointing at
   `https://<api-host>/api/v1/webhooks/resend` and set its signing secret as
   `RESEND_WEBHOOK_SECRET`.
4. If the agent domain lives in a different Resend account than the one
   behind `RESEND_API_KEY`, create a **Full access** key in that account and
   set it as `AGENT_RESEND_API_KEY` (a sending-only key cannot read received
   mail). Platform mail (OTPs, digests, alerts) keeps using `RESEND_API_KEY`.

Each user gets `<first>.<last>@AGENT_MAIL_DOMAIN` (editable). That address is
what the agent puts on applications, so replies come back to the agent.
Without `AGENT_MAIL_DOMAIN` the agent uses the account email and inbound
features are disabled.

All endpoints below require `Authorization: Bearer <access_token>` and use the
standard envelope. List endpoints return `{ "items": [...], "pagination":
{ "page", "page_size", "total_items", "total_pages", "has_next", "has_prev" } }`.

### GET /agent/overview

Home-screen summary. Creates the profile with defaults (derived from the
latest processed resume) on first call.

```json
{
  "data": {
    "profile": { "...": "see GET /agent/profile" },
    "setup": {
      "ai_provider": "anthropic", "has_ai_key": true, "web_search_available": true,
      "has_resume": true, "has_preferences": true, "mailbox_enabled": true,
      "inbound_enabled": true, "extension_connected": false
    },
    "counts": {
      "leads": { "new": 29, "dismissed": 11, "applied": 1 },
      "applications": { "ready": 2, "submitted": 1 },
      "unread_important": 1,
      "submitted_today": 1
    },
    "running_run": null,
    "last_run": { "...": "run object" },
    "recent_events": [ { "...": "event object" } ]
  }
}
```

### GET /agent/profile · PUT /agent/profile

```json
{
  "enabled": false,
  "resume_id": "uuid",
  "mailbox_address": "collins.adi@agent.example.com",
  "mailbox_domain": "agent.example.com",
  "search_prefs": {
    "titles": ["Backend Engineer"], "keywords": ["Go", "PostgreSQL"],
    "exclude_keywords": ["clearance"], "locations": ["Lagos, Nigeria"], "remote_only": true,
    "seniority": ["senior"], "employment_types": ["full_time"],
    "min_salary": 80000, "salary_currency": "USD", "exclude_companies": [],
    "max_age_days": 30, "min_score": 60,
    "sources": { "greenhouse": true, "lever": true, "ashby": true, "remotive": true, "remoteok": true,
                 "himalayas": true, "jobicy": true, "arbeitnow": false, "web_search": true },
    "watchlist": [ { "ats": "greenhouse", "slug": "stripe", "name": "Stripe" } ]
  },
  "application_profile": {
    "full_name": "Collins Adi", "phone": "", "location": "Lagos, Nigeria", "country": "Nigeria",
    "linkedin": "", "github": "", "portfolio": "", "website": "",
    "work_authorization": "Nigerian citizen; needs sponsorship for the US",
    "requires_sponsorship": true, "willing_to_relocate": null,
    "notice_period": "2 weeks", "earliest_start_date": "", "salary_expectation": "USD 90,000",
    "years_of_experience": 5, "pronouns": "", "how_did_you_hear": "Company website",
    "additional_info": "",
    "eeo": { "gender": "", "race": "", "veteran": "", "disability": "", "sexual_orientation": "" }
  },
  "apply_settings": {
    "auto_submit": true, "daily_limit": 15, "auto_approve_score": null,
    "cover_letters": true, "digest_emails": true, "important_alerts": true
  },
  "run_interval_hours": 24,
  "next_run_at": null,
  "last_run_at": null,
  "updated_at": "2026-11-02T10:00:00Z"
}
```

`PUT` accepts any subset of: `enabled`, `resume_id`, `mailbox_local_part`,
`search_prefs`, `application_profile`, `apply_settings`, `run_interval_hours`.
Objects are replaced as a whole. Empty EEO answers mean "decline to
self-identify".

| Rule | Error |
|---|---|
| Enabling needs a processed resume | `422 RESUME_REQUIRED` |
| Enabling needs at least one title or keyword | `400 INVALID_INPUT` |
| `mailbox_local_part`: 1-40 of `a-z 0-9 . _ -` | `400 INVALID_INPUT`, `409 MAILBOX_TAKEN`, `422 MAILBOX_DISABLED` |
| `daily_limit` 1-100, `auto_approve_score` 50-100 or null, `run_interval_hours` 1-168, `min_score` 0-100, `max_age_days` 0-365 | `400 INVALID_INPUT` |
| `watchlist[].ats` must be `greenhouse`, `lever` or `ashby`; `slug` `[A-Za-z0-9._-]` | `400 INVALID_INPUT` |

Enabling sets `next_run_at` to now, so the first scheduled run starts within
`AGENT_SCHEDULER_INTERVAL_SECONDS`.

### GET /agent/sources

Source catalogue (`id`, `label`, `kind`: `ats` | `board` | `ai`,
`description`, `attribution`) and `starter_watchlist`. Sources with
`attribution: true` (Remotive, Remote OK, Jobicy) require clients to show the
source name linking to the lead's `url`.

### POST /agent/runs

Starts a run now. **AI gate**; rate limit 12/hour. Returns `202` with the run.
`409 RUN_IN_PROGRESS` if one is already running; `422 RESUME_REQUIRED`;
`400 INVALID_INPUT` when the profile has no target titles or keywords.

### GET /agent/runs?limit= · GET /agent/runs/:id

```json
{
  "id": "uuid", "trigger": "manual", "status": "completed",
  "stats": {
    "sources_queried": 8, "source_errors": { "remotive": "HTTP 503" },
    "postings_fetched": 598, "new_leads": 29, "scored": 40, "strong_matches": 9,
    "auto_approved": 0, "prepared": 3, "emails_sent": 1, "ready_for_browser": 2,
    "failed": 0, "messages_triaged": 0
  },
  "error": null, "started_at": "...", "finished_at": "..."
}
```

### GET /agent/events?before=&limit=

Activity feed, newest first (`before` = an event `id` for paging).

```json
{ "id": 42, "kind": "leads_found", "level": "success", "message": "Found 29 new jobs to review (9 strong matches)",
  "run_id": "uuid", "lead_id": null, "application_id": null, "data": null, "created_at": "..." }
```

Kinds: `run_started`, `run_finished`, `run_failed`, `leads_found`,
`source_error`, `lead_approved`, `application_prepared`,
`application_emailed`, `application_submitted`, `application_needs_input`,
`application_failed`, `mail_received`, `status_changed`, `digest_sent`.

### GET /agent/leads

Query: `status` (comma-separated), `min_score`, `source`, `remote`
(`true`/`false`), `search`, `sort` (`score` default | `recent`), `page`,
`page_size` (max 100).

```json
{
  "id": "uuid", "source": "ashby", "source_label": "OpenAI (Ashby)",
  "title": "Software Engineer", "company": "OpenAI", "location": "San Francisco", "is_remote": false,
  "employment_type": "full_time",
  "salary": { "min": null, "max": null, "currency": null, "text": "$266K - $445K" },
  "url": "https://jobs.ashbyhq.com/openai/...", "apply_url": "https://jobs.ashbyhq.com/openai/.../application",
  "apply_channel": "browser", "ats": "ashby", "auto_apply_supported": true,
  "posted_at": "...",
  "match": { "score": 92, "fit": "strong", "summary": "You ...", "pros": ["..."], "gaps": ["..."], "dealbreaker": null },
  "status": "new", "dismiss_reason": null, "decided_at": null, "job_id": null, "created_at": "..."
}
```

`match` is `null` until the lead is scored. `apply_channel` is `email` when
the posting asks for applications by email. `auto_apply_supported` is true
for email and for Greenhouse/Lever/Ashby forms.

### GET /agent/leads/:id

`{ "lead": <lead + "description">, "application": <application or null> }`.

### POST /agent/leads/:id/decision

```json
{ "decision": "approve" }
```

`approve` queues an application for the next run; `dismiss` hides the lead
(and cancels a queued application); `reset` brings a dismissed/expired lead
back, and also undoes an approval whose application has not started yet (the
queued application is removed; `400` once the agent has started it). Returns `{ "lead", "application" }`. `400 INVALID_INPUT` when the
application is already being submitted.

### POST /agent/leads/decisions

`{ "ids": ["uuid", ...], "decision": "approve" }` (1-100 ids). Returns
`{ "results": [ { "id", "ok", "error"? } ] }`.

### POST /agent/leads

Adds a posting the user found. **AI gate**; rate limit 40/hour.

```json
{ "url": "https://...", "page_text": "optional visible page text", "approve": false, "source": "extension" }
```

The page is scraped (SSRF-protected) when `page_text` is shorter than 200
characters, parsed with the job extraction prompt, scored and stored.
Returns `201 { "lead", "application" }`; an existing lead for the same
company + title is returned instead of a duplicate.

### GET /agent/applications?status=&page=&page_size=

```json
{
  "id": "uuid", "lead_id": "uuid", "job_id": "uuid", "channel": "browser", "status": "ready",
  "apply_url": "https://job-boards.greenhouse.io/embed/job_app?for=reddit&token=1", "apply_email": null,
  "ats": "greenhouse", "has_cover_letter": true, "use_original_resume": false, "attempts": 0,
  "last_error": null,
  "needs": { "reason": "missing_answers", "message": "...", "questions": [ { "field_id": "q1", "label": "...", "type": "text", "options": [] } ], "page_url": "..." },
  "result": { "filled": 7, "final_url": "...", "message": "..." },
  "claim_expires_at": null, "submitted_at": null, "created_at": "...", "updated_at": "...",
  "lead": { "title": "...", "company": "...", "score": 88, "url": "..." }
}
```

`GET /agent/applications/:id` adds `cover_letter`.

### POST /agent/applications/:id/answers

Answers the questions of a `needs_input` application; they are saved for
every future form and the application returns to `ready`.

```json
{ "answers": [ { "question": "Do you hold an active TS/SCI clearance?", "answer": "No" } ] }
```

### POST /agent/applications/:id/retry · POST /agent/applications/:id/cancel

Retry re-queues a `failed`, `needs_input` or `cancelled` application. Cancel
stops any application that is not `submitted` (the lead becomes `dismissed`).

### Extension protocol

The extension works the queue of `ready` browser applications:

1. **`POST /agent/applications/claim`** — leases the next `ready` application
   (`in_progress`, expires after `AGENT_CLAIM_LEASE_MINUTES`; an expired lease
   becomes claimable again). Returns `data: null` when nothing is waiting,
   otherwise a packet:

   ```json
   {
     "application": { "...": "application object" },
     "lead": { "...": "lead object" },
     "identity": { "full_name": "Collins Adi", "first_name": "Collins", "last_name": "Adi",
                   "email": "collins.adi@agent.example.com", "phone": "...", "location": "...",
                   "linkedin": "...", "github": "...", "portfolio": "", "website": "" },
     "profile": { "...": "application_profile" },
     "answers": [ { "id": "uuid", "question": "...", "answer": "...", "source": "user", "updated_at": "..." } ],
     "cover_letter": "Dear Hiring Team, ...",
     "resume": { "filename": "Collins_Adi_Resume.pdf", "path": "/agent/applications/<id>/resume" },
     "cover_letter_file": { "filename": "Collins_Cover_Letter.pdf", "path": "/agent/applications/<id>/cover-letter.pdf" },
     "auto_submit": true,
     "verification_since": "..."
   }
   ```

   `identity.email` is the agent mailbox when configured. `GET
   /agent/applications/:id/packet` returns the same packet without claiming.

2. **`GET /agent/applications/:id/resume`** and
   **`GET /agent/applications/:id/cover-letter.pdf`** — the files to upload
   (tailored PDF, or the original upload when tailoring was skipped).
   `Content-Disposition` and `X-File-Name` carry the file name.

3. **`POST /agent/applications/:id/fill`** — **AI gate**; rate limit 150/hour.
   Send the fields detected on the current page:

   ```json
   {
     "page_url": "https://...",
     "fields": [
       { "field_id": "first_name", "label": "First Name", "type": "text", "required": true },
       { "field_id": "auth", "label": "Authorized to work in the US?", "type": "select", "required": true, "options": ["Yes", "No"] },
       { "field_id": "resume", "label": "Resume/CV", "type": "file", "required": true }
     ]
   }
   ```

   Field fields: `field_id` (unique, max 120), `label`, `type`, `name`,
   `placeholder`, `required`, `options` (for select/radio/checkbox/combobox),
   `section`, `help`. 1-150 fields per call. Response:

   ```json
   {
     "fills": [ { "field_id": "first_name", "value": "Collins", "confidence": "high" },
                { "field_id": "resume", "value": "__RESUME__", "confidence": "high" } ],
     "missing": [ { "field_id": "q7", "label": "Do you hold an active clearance?", "type": "text" } ]
   }
   ```

   Option answers are always one of the field's `options` (multi-select
   values are joined with `" | "`). File fields get `__RESUME__` or
   `__COVER_LETTER__`. `missing` lists required fields that need the user.

4. **`POST /agent/applications/:id/result`** — report the outcome:

   ```json
   { "status": "submitted", "filled": 9, "final_url": "https://.../thanks", "message": "Thank you for applying" }
   { "status": "needs_input", "reason": "missing_answers", "message": "...", "questions": [ ... ], "page_url": "..." }
   { "status": "failed", "message": "Submit button not found" }
   { "status": "released" }
   ```

   `submitted` marks the lead `applied` and the tracker job `applied`.
   `released` hands the claim back (`ready`) without counting an attempt.
   Only `in_progress`, `ready` or `needs_input` applications accept results
   (`409 NOT_CLAIMABLE`); a `failed` one also accepts `submitted`, so the
   dashboard can record an application the user finished by hand. Results
   are at-least-once: a repeated `needs_input` updates the questions without
   a second event.

5. **`GET /agent/inbox/verifications?since=<RFC3339>`** — verification codes
   and links received since `since` (default: last 15 minutes; `400` if it is
   not RFC 3339 — URL-encode a `+` offset, or use the packet's UTC
   `verification_since`), for forms that email a security code:

   ```json
   [ { "message_id": "uuid", "from": "no-reply@greenhouse.io", "subject": "Your security code",
       "code": "X7K2P9QM", "link": null, "received_at": "..." } ]
   ```

### GET /agent/inbox?category=&page=&page_size=

`category`: `confirmation`, `rejection`, `interview`, `assessment`, `offer`,
`verification`, `recruiter`, `other`, `application` (sent applications),
`important`, `outbound`.

```json
{
  "id": "uuid", "direction": "inbound", "from_address": "recruiting@openai.com", "from_name": "OpenAI Recruiting",
  "to": ["collins.adi@agent.example.com"], "subject": "Next steps", "snippet": "Hi Collins, ...",
  "category": "interview", "summary": "OpenAI wants to schedule a call.", "important": true,
  "application_id": "uuid", "job_id": "uuid", "triage_status": "done", "read_at": null, "received_at": "..."
}
```

`GET /agent/inbox/:id` adds `text_body`, `links`, `attachments` (metadata)
and `extracted` (`category`, `company`, `job_title`, `summary`,
`action_required`, `action`, `deadline`, `verification_code`,
`verification_link`, `matched_application`). Only plain text is stored; HTML
is never rendered. `POST /agent/inbox/:id/read` with `{ "read": true }`.

### GET /agent/answers · PUT /agent/answers · DELETE /agent/answers/:id

Saved answers the agent reuses on every form. `PUT` upserts
`{ "question": "...", "answer": "..." }` (questions match case- and
punctuation-insensitively).

### POST /webhooks/resend

Public. Resend `email.received` webhook, verified with the Svix signature
headers (`svix-id`, `svix-timestamp`, `svix-signature`) against
`RESEND_WEBHOOK_SECRET` with a 5-minute replay window. Mail for addresses on
`AGENT_MAIL_DOMAIN` is fetched from Resend's receiving API, stored per
recipient (idempotent per Resend email id) and triaged in the background.

| Status | Meaning |
|---|---|
| `200` | Accepted (including ignored events and unknown mailboxes) |
| `401 INVALID_SIGNATURE` | Signature or timestamp check failed |
| `503 INBOUND_DISABLED` | `AGENT_MAIL_DOMAIN` or `RESEND_WEBHOOK_SECRET` not set |
| `500` | Fetching the email failed; Resend retries |

---

## Extension Devices

The extension connects once through the dashboard handshake and then stays
connected with a **device token** (no 15-minute reconnects).

### POST /auth/extension-token/exchange

Request: `{ "ext_token": "<single-use token>", "device_name": "optional" }`.
The response now also carries the device credential:

```json
{
  "data": {
    "access_token": "eyJ...", "expires_at": "...",
    "device_id": "uuid", "device_token": "<64 hex chars>",
    "user": { "id": "uuid", "full_name": "Collins Adi", "email": "collinsadi20@gmail.com" }
  }
}
```

At most `EXTENSION_DEVICE_MAX_PER_USER` devices stay active; older ones are
revoked.

### POST /auth/extension/refresh

Public; rate limit 60/hour per IP. `{ "device_token": "..." }` returns the
same shape as the exchange with a **rotated** `device_token` — store it and
discard the old one.

| Error | Meaning |
|---|---|
| `401 DEVICE_TOKEN_ROTATED` | The token was replaced within the last 2 minutes (concurrent refresh): re-read the stored token and retry |
| `401 DEVICE_REVOKED` | Revoked, unknown, or a reused old token (theft protection revokes the device): reconnect from the dashboard |

### GET /auth/extension/devices · DELETE /auth/extension/devices/:id

Lists active devices (`id`, `name`, `last_used_at`, `created_at`) and
disconnects one.

---

## Agent Error Codes

| Code | Meaning |
|---|---|
| `RUN_IN_PROGRESS` | A run is already running for this user |
| `RESUME_REQUIRED` | No processed resume selected |
| `MAILBOX_TAKEN` | Mailbox name already used |
| `MAILBOX_DISABLED` | `AGENT_MAIL_DOMAIN` is not configured |
| `NOT_CLAIMABLE` | The application is not waiting on the extension |
| `UNSUPPORTED` | The active AI provider cannot do this (e.g. web search on OpenRouter) |
| `PROVIDER_KEY_REQUIRED` | Switching to a provider without a valid key |
| `INVALID_API_KEY` | Key format invalid or rejected by the provider |
| `DEVICE_TOKEN_ROTATED`, `DEVICE_REVOKED` | See Extension Devices |
| `INVALID_SIGNATURE`, `INBOUND_DISABLED` | See `POST /webhooks/resend` |
