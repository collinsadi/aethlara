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

## AI / OpenRouter Architecture (Non-Negotiable)

This platform holds **no platform-level OpenRouter API key**. Every AI call —
resume extraction, job extraction, resume alignment, tailored-PDF context, and
job chat — resolves the authenticated user's own encrypted key per request.

**Guarantees:**
- `OPENROUTER_API_KEY` is NOT a valid environment variable. There is no fallback.
- Decrypted keys live only inside a single request's stack frame and are zeroed
  before the function returns.
- Every AI-dependent endpoint is gated by the `AIGate` middleware which checks
  `settings.HasValidAPIKey(userID)` before the handler runs.
- Service-level code also validates the key (defence-in-depth) and returns
  `ai.ErrNoAPIKey` if none is available, which handlers map to `403
  API_KEY_REQUIRED`.

**403 shape used for missing / invalid keys:**
```json
{
  "error": {
    "code": "API_KEY_REQUIRED",
    "message": "An OpenRouter API key is required to use this feature. Add your key in Settings.",
    "action": { "label": "Add API Key", "path": "/settings#api-key" }
  }
}
```

Endpoints protected by the AI gate:
- `POST /resumes/upload`
- `POST /jobs`
- `POST /chat/sessions`
- `POST /chat/sessions/:session_id/messages`

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
