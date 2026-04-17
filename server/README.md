# Aethlara — Server

Go REST API backend for the [Aethlara](../README.md) platform.

## Overview

The Aethlara server is a Go 1.22+ REST API built on Chi. It follows a domain-based module architecture — each business domain (`auth`, `user`, `resume`, `job`, `settings`, `analytics`, `apikey`) owns its own `handler`, `service`, `repository`, and `routes`. PostgreSQL is accessed via `pgx`. Files live on Cloudflare R2 (S3-compatible). All AI calls are routed through a single service that decrypts the user's OpenRouter API key only at the moment of the call.

## Tech Stack

- **Go 1.22+**
- **Chi Router** (`github.com/go-chi/chi/v5`)
- **pgx** (PostgreSQL driver)
- **AWS SDK v2** (for Cloudflare R2 — S3-compatible)
- **Resend** (transactional email)
- **golang-jwt** (access tokens) + opaque random refresh tokens
- **AES-256-GCM** (API key encryption, `crypto/aes` + `crypto/cipher`)
- **go-pdf/fpdf** (tailored resume PDF generation)
- **ledongthuc/pdf** (resume text extraction)
- **bcrypt** (OTP + dummy password hashing)
- **godotenv** (env loading in dev)
- **Air** (hot reload)
- **Docker** + **Docker Compose**

## Project Structure

```
server/
├── cmd/api/
│   └── main.go                      # Application entrypoint — loads config, wires modules, starts HTTP server
├── internal/
│   ├── auth/                        # Passwordless OTP auth (signup, login, verify, refresh, logout, logout-all)
│   ├── user/                        # User profile (/user/me)
│   ├── resume/                      # Resume upload, AI extraction, preview URL, soft delete
│   ├── job/                         # Job creation pipeline — scraper, AI orchestration, PDF generation
│   ├── analytics/                   # Dashboard aggregations (match score, monthly trend, status breakdown)
│   ├── settings/                    # API key CRUD, profile update, email change flow
│   ├── apikey/                      # AES-256-GCM encryption service for user OpenRouter keys
│   ├── ai/
│   │   └── openrouter.go            # The single AI call site
│   ├── prompts/                     # Versioned AI system prompts (job extraction, resume alignment, ...)
│   ├── email/                       # Resend service + email templates (OTP, notifications)
│   ├── storage/
│   │   └── r2.go                    # Cloudflare R2 client (upload, presigned URL, delete)
│   ├── middleware/                  # auth, ratelimit, cors, security, logger, recover, requestid, ai_gate
│   ├── database/                    # Postgres connection + migrations runner
│   │   └── migrations/              # 001_init.sql, 002_resumes.sql, 003_jobs.sql, 004_settings.sql
│   └── config/
│       └── config.go                # Typed env loader — fails fast on missing/invalid vars
├── pkg/
│   ├── response/                    # Consistent API envelope (success/error)
│   ├── validator/                   # Input validation helpers
│   └── tokenutil/                   # JWT sign/verify + refresh token helpers
├── docs.md                          # Full API documentation (all endpoints)
├── Dockerfile
├── docker-compose.yml
├── .air.toml                        # Hot reload config
├── .env.example
├── go.mod
└── go.sum
```

Every domain module follows the same four-file pattern:

- `handler.go` — HTTP handlers, request parsing, response rendering
- `service.go` — business logic
- `repository.go` — database access
- `routes.go` — route registration, middleware wiring

## Environment Variables

The canonical reference is [`.env.example`](./.env.example). Key variables:

| Variable | Purpose | Example |
|---|---|---|
| `APP_ENV` | Environment name (`development`, `production`) | `development` |
| `PORT` | HTTP listen port | `8080` |
| `APP_URL` | Public base URL of this API | `http://localhost:8080` |
| `APP_NAME` | Display name used in email templates | `Aethlara` |
| `DATABASE_URL` | Postgres DSN (use `sslmode=require` in production) | `postgres://user:pass@localhost:5432/aethlara_db?sslmode=disable` |
| `JWT_ACCESS_SECRET` | JWT access-token signing secret (min 32 chars) | *(generate with `openssl rand -hex 32`)* |
| `JWT_REFRESH_SECRET` | JWT refresh-token signing secret (min 32 chars) | *(generate with `openssl rand -hex 32`)* |
| `JWT_ACCESS_EXPIRY_MINUTES` | Access token TTL | `15` |
| `JWT_REFRESH_EXPIRY_DAYS` | Refresh token TTL | `30` |
| `OTP_EXPIRY_MINUTES` | OTP validity window | `10` |
| `OTP_MAX_ATTEMPTS` | Brute-force lockout threshold | `5` |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Global per-IP rate limit | `120` |
| `RATE_LIMIT_BURST` | Burst capacity | `60` |
| `BCRYPT_COST` | bcrypt work factor | `12` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origin whitelist | `http://localhost:5173` |
| `TRUSTED_PROXIES` | Trusted proxy CIDRs for `X-Forwarded-For` | *(empty)* |
| `RESEND_API_KEY` | Resend API key | `re_...` |
| `EMAIL_FROM_ADDRESS` | Sender address | `noreply@aethlara.com` |
| `EMAIL_FROM_NAME` | Sender display name | `Aethlara` |
| `EMAIL_DEV_LOG_ONLY` | In dev, print OTPs to logs instead of sending email | `false` |
| `OPENROUTER_API_KEY` | Fallback/self-host OpenRouter key | `sk-or-...` |
| `OPENROUTER_BASE_URL` | OpenRouter API base | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Default model | `anthropic/claude-3.5-sonnet` |
| `RESUME_MAX_FILE_SIZE_MB` | Max resume upload size | `5` |
| `RESUME_PRESIGNED_URL_EXPIRY_MINUTES` | Resume preview URL TTL | `15` |
| `RESUME_MAX_ACTIVE_PER_USER` | Max non-deleted resumes per user | `10` |
| `R2_ACCOUNT_ID` | Cloudflare account ID | |
| `R2_ACCESS_KEY_ID` | R2 access key | |
| `R2_SECRET_ACCESS_KEY` | R2 secret | |
| `R2_BUCKET_NAME` | R2 bucket | |
| `R2_PUBLIC_ENDPOINT` | R2 public endpoint URL | |
| `SCRAPER_REQUEST_TIMEOUT_SECONDS` | HTTP fetch timeout for job URL scrape | `15` |
| `SCRAPER_MAX_HTML_BYTES` | Hard cap on scraped HTML size | `2097152` |
| `SCRAPER_USER_AGENT` | User-Agent sent by the scraper | `Mozilla/5.0 (compatible; Aethlara/1.0)` |
| `ALLOWED_SCRAPE_SCHEMES` | Permitted URL schemes | `https` |
| `JOB_MAX_TEXT_INPUT_BYTES` | Max pasted job description size | `51200` |
| `JOB_AI_TIMEOUT_SECONDS` | AI call timeout | `60` |
| `JOB_PDF_MAX_RETRIES` | Retries for PDF generation | `3` |
| `PDF_STORAGE_PREFIX` | R2 prefix for tailored PDFs | `jobs/resumes/` |
| `PDF_TEMPLATE` | PDF template identifier | `minimal` |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | Pagination defaults | `20` / `100` |
| `API_KEY_ENCRYPTION_SECRET` | **AES-256-GCM key for user OpenRouter keys — exactly 32 bytes** | *(generate with `openssl rand -hex 32`)* |
| `API_KEY_PREVIEW_LENGTH` | Masked preview length shown in UI | `18` |

> **Critical.** `API_KEY_ENCRYPTION_SECRET` must be exactly **32 bytes** (64 hex chars). Generate it with:
>
> ```bash
> openssl rand -hex 32
> ```
>
> Changing this value after users have saved API keys will render those stored keys unrecoverable.

## Running with Docker (Recommended)

```bash
cd server
cp .env.example .env
# Fill in your .env values
docker compose up --build
# API available at http://localhost:8080
```

The Dockerfile produces a small static binary; `docker-compose.yml` loads `.env` into the container.

## Running without Docker

```bash
cd server
cp .env.example .env
# Fill in your .env values
go mod download
air                           # hot reload (recommended)
# or
go run cmd/api/main.go        # single run
```

The `run.sh` helper script in this directory wraps the most common local commands.

## Database Migrations

Migrations live in [`internal/database/migrations/`](./internal/database/migrations) and run in filename order:

- `001_init.sql` — users, otps, refresh_tokens
- `002_resumes.sql` — resumes + soft-delete columns
- `003_jobs.sql` — jobs, job events, indexes
- `004_settings.sql` — encrypted API keys, email change requests

Migrations are applied automatically on server startup by `internal/database/migrate.go`. If you need to add a new migration, create a new file with the next numeric prefix — never edit an existing one that has already shipped.

## API Documentation

Full endpoint documentation lives in [`docs.md`](./docs.md).

**Base URL:** `/api/v1`

All responses use a consistent envelope:

```json
{ "data": { "...": "..." }, "message": "optional string" }
```

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message." } }
```

## Security Notes

- **Single AI call site.** All OpenRouter requests go through `internal/ai/openrouter.go`. The user's encrypted API key is decrypted inside this service and never leaves it.
- **AES-256-GCM** for user API keys. The encryption secret must be exactly 32 bytes. Ciphertexts include a random 12-byte nonce and a 16-byte auth tag.
- **Soft delete by default.** All delete operations mark rows as deleted rather than removing them. The one exception is API keys — those are hard-deleted, because leaving an encrypted secret around after a user asked to remove it is the wrong default.
- **SSRF protection** on all URL scraping. Scheme, host resolution, and private-IP ranges are checked before the HTTP request is issued; response size is capped at `SCRAPER_MAX_HTML_BYTES`.
- **Rate limiting** via per-IP token bucket. Auth endpoints (`/auth/signup`, `/auth/login`, `/auth/verify-otp`) have stricter overrides on top of the global limit.
- **Refresh token rotation** with reuse detection. Presenting a revoked token invalidates every session for that user — the breach signal is explicit.
- **OTPs** are generated with `crypto/rand`, stored as bcrypt hashes, single-use, locked after `OTP_MAX_ATTEMPTS`.
- **Parameterised queries only.** Zero string interpolation in SQL.
- **Security headers** applied globally: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`, plus `Strict-Transport-Security` in production.
- **`Authorization` header is never logged.**

## Adding a New Module

1. Create `internal/{module}/` with the four standard files:
   ```
   internal/{module}/
   ├── handler.go      # HTTP handlers
   ├── service.go      # business logic
   ├── repository.go   # database access
   └── routes.go       # route registration
   ```
2. Register the routes in `cmd/api/main.go` alongside the existing modules.
3. If the module involves AI, add its system prompt in `internal/prompts/`. Version prompts by filename — don't mutate a shipped prompt in place.
4. Document every new endpoint in [`docs.md`](./docs.md) — request shape, response shape, error codes, rate limit, security notes.
5. Add any new env vars to `.env.example` and to the table in this README.

## Related

- [Root README](../README.md) — full product overview
- [Client README](../client/README.md) — frontend setup
- [API docs](./docs.md)
- [Contributing guide](../CONTRIBUTING.md)
