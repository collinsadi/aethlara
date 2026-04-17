# Contributing to Aethlara

Thanks for taking the time to look at this. Aethlara is built in the open, and it gets better every time someone files a thoughtful issue, ships a clean PR, or points out something the maintainers missed. Whether you want to fix a typo or rewrite a whole module, you're welcome here.

This document covers how we work so contributions land smoothly.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Contributing Code](#contributing-code)
- [Development Setup](#development-setup)
- [Commit Convention](#commit-convention)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Project Structure Guide](#project-structure-guide)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Recognition](#recognition)

---

## Code of Conduct

- Be respectful, inclusive, and constructive.
- No harassment, discrimination, personal attacks, or gatekeeping of any kind.
- Disagree with ideas, not people. Critique code, not the author.
- Maintainers reserve the right to edit, reject, or remove contributions — issues, comments, PRs, wiki edits — that violate these principles, and to ban repeat offenders.

---

## How to Contribute

### Reporting Bugs

Open a [GitHub Issue](https://github.com/collinsadi/aethlara/issues) with the label `bug` and include:

- **OS + version** (e.g. macOS 14.4, Ubuntu 22.04)
- **Browser** (for client bugs) or **Go version** (for server bugs)
- **Steps to reproduce** — as short and deterministic as you can make them
- **Expected behaviour**
- **Actual behaviour** (logs, screenshots, stack traces if relevant)

If you can reproduce on `main`, say so explicitly.

### Suggesting Features

Open a [GitHub Discussion](https://github.com/collinsadi/aethlara/discussions) or an Issue with the label `enhancement`. The most useful feature requests describe:

1. **The problem** you're hitting (not just the solution you want)
2. **Who it affects** and how often
3. **What you've tried** already
4. A rough shape of the solution, if you have one — but the problem is the important part

### Contributing Code

1. **Fork** the repository on GitHub.
2. **Create a feature branch** off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Make your changes** following the commit convention below.
4. **Open a PR** against `main` with a clear description and, where relevant, screenshots or reproduction steps.

---

## Development Setup

Full instructions live in the root [`README.md`](./README.md). In short:

- **Server:** `cd server && cp .env.example .env && docker compose up --build` (or `air` for non-Docker)
- **Client:** `cd client && npm install && npm run dev`

For full local development you'll want both running simultaneously. Point `VITE_API_URL` at your local backend (default: `http://localhost:8080/api/v1`).

---

## Commit Convention

Aethlara uses [Conventional Commits](https://www.conventionalcommits.org/).

**Format:** `type(scope): description`

**Types:**

| Type | Use for |
|---|---|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace, no code change |
| `refactor` | Code change that is neither a feat nor a fix |
| `test` | Adding or fixing tests |
| `chore` | Build, tooling, dependencies |
| `perf` | Performance improvement |

**Scopes:** `client`, `server`, `auth`, `jobs`, `resume`, `settings`, `analytics`, `tracker`, `docs`, `ci`

**Examples:**

```
feat(jobs): add URL scraping with SSRF protection
fix(auth): resolve OTP expiry race condition
docs(server): update API key endpoint documentation
refactor(resume): extract PDF generation into standalone service
chore(ci): bump Go to 1.22 in CI matrix
```

Keep the description in the imperative mood (`add`, not `added`). Keep the first line under 72 characters. Use the body for the *why*.

---

## Pull Request Guidelines

- **One PR, one purpose.** If you find yourself writing "and also…" in the description, split it.
- **Description.** Explain what changed and why. Link the issue it resolves: `Closes #123`.
- **Docs.** Every new endpoint must be documented in [`server/docs.md`](./server/docs.md). Every new env var must be added to `server/.env.example`.
- **States.** Every new React component must handle loading, error, and empty states.
- **Accessibility.** New UI must be keyboard-navigable and use semantic HTML. No hardcoded colours — all colours come from the design system CSS variables.
- **Security-sensitive changes** — anything touching auth, encryption, API keys, or secrets storage — requires an extra paragraph in the PR description explaining the threat model you considered.
- **Checks.** Keep the linter clean (`npm run lint` for client, `go build ./...` for server). CI must pass before merge.

---

## Project Structure Guide

A quick map of where things live. For the full layout, see the root [`README.md`](./README.md).

### Client (`client/src/`)

| Where | What goes there |
|---|---|
| `api/` | Typed `axios` call functions, one file per domain (`auth`, `jobs`, `resumes`, `settings`, `analytics`) |
| `components/` | Feature components, grouped by domain (`dashboard/`, `jobs/`, `resumes/`, `settings/`, `tracker/`, `layout/`, `ui/`) |
| `hooks/` | React Query hooks (`useAuth`, `useJobs`, `useResumes`, `useAnalytics`, ...) |
| `lib/` | Shared utilities — `queryClient`, `queryKeys`, `cookies`, `tokens`, Zod validators |
| `middleware/` | Route guards — `AuthGuard`, `ScrollToTop` |
| `pages/` | Route-level components — one per route |
| `stores/` | Zustand stores — currently just `authStore` |

**When adding a new React Query key**, register it in `client/src/lib/queryKeys.ts`. Never write inline keys.

### Server (`server/internal/`)

| Where | What goes there |
|---|---|
| `auth/`, `user/`, `resume/`, `job/`, `settings/`, `analytics/`, `apikey/` | Domain modules, each with `handler.go`, `service.go`, `repository.go`, `routes.go` |
| `ai/openrouter.go` | The **single** OpenRouter call site. All AI requests go through here. |
| `prompts/` | All AI system prompts. Versioned — don't mutate in place once shipped. |
| `email/` | Resend email service + templates |
| `storage/` | Cloudflare R2 client |
| `middleware/` | Auth, rate limit, CORS, security headers, AI gate |
| `database/` | Postgres connection + `migrations/` |
| `config/` | Typed env loader that fails fast on missing vars |

**When adding a new prompt**, put it in `server/internal/prompts/`. **When adding a new API module**, create `server/internal/{module}/` with the four standard files and register the routes in `server/cmd/api/main.go`.

---

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.**

Instead:

- Use GitHub's [private vulnerability reporting](https://github.com/collinsadi/aethlara/security/advisories/new), or
- Email the maintainer directly.

Please include:

- A description of the vulnerability
- Steps to reproduce (proof-of-concept welcome)
- Potential impact (data exposure, auth bypass, RCE, etc.)
- Any suggested remediation

You'll get an acknowledgement within a few days. Once the fix ships, you'll be credited in the release notes (unless you prefer to stay anonymous).

---

## Recognition

Every contribution counts — a typo fix matters as much as a feature. Contributors are listed on the project's [GitHub contributors page](https://github.com/collinsadi/aethlara/graphs/contributors).

Thanks for making Aethlara better.
