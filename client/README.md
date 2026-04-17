# Aethlara — Client

React + TypeScript frontend for the [Aethlara](../README.md) platform.

## Overview

The Aethlara client is a Vite-powered SPA that talks to the Go backend over REST. It handles passwordless sign-in, resume upload, job creation, the Kanban tracker, the analytics dashboard, and the settings surface for encrypted API key management.

For the full product context, see the [root README](../README.md).

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** (dev server + build)
- **Tailwind CSS v4**
- **React Query v5** (`@tanstack/react-query`) for server state
- **React Hook Form** + **Zod** for forms and validation
- **React Router v7** for routing
- **Zustand** for auth store (in-memory access token)
- **dnd-kit** for the Kanban tracker
- **Recharts** for analytics charts
- **Axios** for HTTP + `js-cookie` for refresh-token cookie
- **Framer Motion** for interaction animation
- **shadcn/ui** primitives (Base UI under the hood)

## Project Structure

```
src/
├── api/              # Typed API call functions
│   ├── client.ts           # Axios instance + interceptors (attach access token, handle 401 refresh)
│   ├── auth.ts
│   ├── jobs.ts
│   ├── resumes.ts
│   ├── settings.ts
│   └── analytics.ts
├── components/
│   ├── dashboard/          # MatchScoreChart, MonthlyTrendChart, StatusBreakdownChart, TopCompaniesChart
│   ├── jobs/               # CreateJobModal, JobDetailDrawer, ApiJobCard
│   ├── resumes/            # UploadResumeModal, ResumeCard, ResumePreviewModal, DeleteResumeDialog
│   ├── settings/           # ApiKeySection, ApiKeyStatusBanner, ProfileSection, EmailChangeSection
│   ├── tracker/            # ApiKanbanBoard
│   ├── layout/             # AppLayout, MarketingLayout, Sidebar, Topbar
│   ├── ui/                 # shadcn primitives (button, dialog, input, badge, ...)
│   └── *.tsx               # Shared feature components (OtpInput, StatsCard, ThemeSwitcher, ...)
├── hooks/            # React Query hooks (useAuth, useJobs, useResumes, useAnalytics, useApiKey, ...)
├── lib/              # Shared utilities
│   ├── queryClient.ts      # React Query client config
│   ├── queryKeys.ts        # Centralised query keys — single source of truth
│   ├── cookies.ts          # Cookie helpers (refresh token only)
│   ├── tokens.ts           # In-memory access-token holder
│   ├── utils.ts            # cn() and friends
│   └── validators/         # Zod schemas (auth, job, resume)
├── middleware/       # AuthGuard, ScrollToTop
├── pages/            # Route-level pages (Landing, Login, Signup, Dashboard, Jobs, JobDetail,
│                     #  NewJob, Resumes, Tracker, Settings, About, Contact, Privacy, Terms, Pricing)
├── stores/           # authStore.ts (Zustand)
├── App.tsx           # Router + providers
├── main.tsx
└── index.css         # Tailwind + CSS variables (design tokens)
```

## Environment Variables

Create a `.env` in this directory:

```bash
VITE_API_URL=http://localhost:8080/api/v1
```

Only variables prefixed with `VITE_` are exposed to the client at build time.

## Setup & Development

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:5173` by default.

## Build

```bash
npm run build
```

Output lands in `dist/`. Preview the production build with `npm run preview`.

## Key Patterns

- **All API calls go through `src/api/client.ts`.** It owns the axios instance, attaches the access token from the in-memory store, and handles `401` refresh transparently.
- **All React Query keys are centralised in `src/lib/queryKeys.ts`.** Never write inline keys — it breaks cache invalidation.
- **All cookie operations go through `src/lib/cookies.ts`.** The only cookie the client sets directly is for UI preferences; the refresh token lives in an HttpOnly cookie set by the server.
- **Access tokens are held in memory only** (`src/lib/tokens.ts` + `src/stores/authStore.ts`). Never written to `localStorage` or `sessionStorage`.
- **Auth guard** (`src/middleware/AuthGuard.tsx`) wraps every protected route. It silently refreshes on mount and redirects unauthenticated users to `/login`.
- **Forms** use React Hook Form + Zod resolvers. Validators live in `src/lib/validators/`.
- **Every feature component handles loading, error, and empty states** — this is enforced in code review.

## Light & Dark Mode

The app ships with both themes. **Every component must use CSS variables from the design system** — e.g. `bg-background`, `text-foreground`, `border-border`. Hardcoded colours (`bg-white`, `text-gray-800`, hex literals) are not allowed because they break dark mode.

The theme is toggled via `ThemeSwitcher` and persisted to `localStorage`.

## Related

- [Root README](../README.md) — full product overview
- [Server README](../server/README.md) — backend setup
- [API docs](../server/docs.md)
- [Contributing guide](../CONTRIBUTING.md)
