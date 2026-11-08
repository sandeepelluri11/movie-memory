# Movie Memory

Sign in with Google, tell us your favorite movie, and get a fun fact about it from OpenAI.

**Variant chosen: A — Backend-focused (caching & correctness).**

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Postgres 17 · Prisma 7 · Auth.js v5 (Google) · OpenAI · Vitest.

---

## Setup

Prerequisites: Node 20.9+, Docker (or any Postgres 14+).

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill in the values below
docker compose up -d --wait # local Postgres on :5432
npm run db:migrate          # apply migrations (prisma migrate dev)
npm run dev                 # http://localhost:3000
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Defaults in `.env.example` match `docker-compose.yml`. |
| `AUTH_SECRET` | yes | `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | yes | Google Cloud Console → OAuth client (Web). Redirect URI: `http://localhost:3000/api/auth/callback/google`. |
| `OPENAI_API_KEY` | yes | Server-only. |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini`. |
| `AUTH_URL` or `AUTH_TRUST_HOST` | production only | Needed for `next start` outside Vercel. Prefer `AUTH_URL` (the public URL); `AUTH_TRUST_HOST=true` trusts the `Host` header and is only safe behind a proxy that sets it. |

None of these use the `NEXT_PUBLIC_` prefix, so none are bundled for the browser.

### Database migrations

- Development: `npm run db:migrate` (`prisma migrate dev`) — applies and, after schema edits, creates migrations.
- Production/CI: `npm run db:deploy` (`prisma migrate deploy`) — applies committed migrations only.

### Tests

Three layers, all run in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on every push and PR, together with lint and typecheck:

```bash
npm test          # unit: no DB or network needed
npm run test:db   # integration: needs Postgres (docker compose up -d)
npm run test:e2e  # end-to-end: builds the app, needs Postgres
```

| Layer | What it proves |
| --- | --- |
| **Unit** (Vitest) | The fact service's cache window (59.999s vs 60s), burst protection, stale fallback and per-user scoping, run against an in-memory repository and a fake clock. Also: the `/api/fact` status codes (401/409/503/500), onboarding validation and its "never overwrite" rule, and the `FunFact` component's loading/error/stale/401 states. |
| **Integration** (Vitest + Postgres) | The real Prisma repository: exactly 1 of 20 concurrent callers gets the lease, only the owner can release it, queries are scoped by user, and 10 concurrent service calls generate one fact. |
| **End-to-end** (Vitest + `next start`) | The production build over HTTP with real Postgres and real Auth.js database sessions; only OpenAI is replaced by a local stub that can succeed, fail or slow down and counts calls. Covers redirects, forged cookies, onboarding routing, dashboard content (including a missing name/photo), cache → regenerate, a 6-request burst making 1 OpenAI call, fallback, cross-user isolation, logout and security headers. |

The e2e suite seeds sessions directly in the `Session` table rather than driving Google's consent screen, which can't run headlessly in CI. It creates throwaway users (`*@e2e.example.com`) and deletes them afterwards.

---

## Architecture overview

```
src/
  auth.ts                       Auth.js config (Google, Prisma adapter, database sessions)
  proxy.ts                      Optimistic cookie check → 307 to "/" for /dashboard, /onboarding
  app/
    page.tsx                    Landing page ("Sign in with Google"); signed-in users → /dashboard
    actions.ts                  Server actions: sign in/out, saveFavoriteMovie (validated)
    onboarding/                 First-time favorite-movie form (useActionState)
    dashboard/page.tsx          Profile, favorite movie, logout
    dashboard/fun-fact.tsx      Client component that calls GET /api/fact
    api/fact/route.ts           Session-scoped fact endpoint; maps domain errors to HTTP
  lib/
    session.ts                  requireUser(): authoritative session + DB lookup
    movie.ts                    zod validation for the movie title
    facts/service.ts            Cache window, burst protection, failure fallback (pure, no I/O imports)
    facts/prisma-repository.ts  Postgres implementation of the repository interface
    facts/openai-generator.ts   OpenAI call with timeout and prompt hardening
  app/error.tsx                 Error boundary for unexpected render errors
prisma/                         Schema + committed migrations
e2e/                            End-to-end suite, including an OpenAI stub server
.github/workflows/ci.yml        Lint, typecheck, unit, integration and e2e on every push/PR
```

### Auth flow

1. `/` shows "Sign in with Google". The button is a server action calling `signIn("google", { redirectTo: "/dashboard" })`.
2. Auth.js (Prisma adapter, **database sessions**) creates/links the `User` + `Account` and sets an opaque session cookie.
3. `/dashboard` loads the user from the DB; if `favoriteMovie` is `null` it redirects to `/onboarding`. So "first-time user" means "has not completed onboarding", which also covers a user who signed in once and abandoned onboarding.
4. `/onboarding` redirects to `/dashboard` if a movie is already set. The save action uses `updateMany({ where: { id, favoriteMovie: null } })`, so onboarding can never overwrite an existing movie, even via a replayed request.
5. Signed-out access to `/dashboard` or `/onboarding` gets a 307 to `/` from `proxy.ts` (cookie presence only). The page itself then does the **authoritative** check (`auth()` → DB session lookup); a forged cookie passes the proxy but gets no data.

Pages read the session inside `<Suspense>`, as required by Next 16 Cache Components for request-time data.

If Google sign-in fails or the user cancels consent, Auth.js redirects to `/?error=…` and the landing page shows a friendly message.

### Data model

- **`User`** (Auth.js shape) plus:
  - `favoriteMovie String?` — one favorite per user, so a column rather than a table; `null` doubles as the "needs onboarding" flag.
  - `factGenerationStartedAt DateTime?` — the "generation in progress" lease (see below).
- **`Account` / `Session` / `VerificationToken`** — standard Auth.js adapter tables.
- **`MovieFact`** `(id, userId → User, movie, content, createdAt)` — append-only history of generated facts.
  - `movie` is a **snapshot** of the title the fact is about, so a cached fact is only reused for the same user **and** movie, as required.
  - Index `(userId, movie, createdAt DESC)` makes "latest fact for this user + movie" a single index lookup.
  - `createdAt` is written by the app clock (not `DEFAULT now()`), so the 60s comparison always uses one clock.
  - `onDelete: Cascade` from `User`.
- **Length limits in the database too:** `favoriteMovie`/`movie` are `VARCHAR(100)` (matching validation) and `content` is `VARCHAR(1000)`. The DB enforces the limits even if a future code path skips validation.

### Fact generation (Variant A)

`GET /api/fact` → `factService.getFactForUser(sessionUserId)`:

```
movie  = user.favoriteMovie                       (none → 409)
latest = newest fact for (user, movie)
if latest is < 60s old            → return latest            source: "cache"
try to acquire lease (atomic UPDATE)
  lost  → poll (500ms, ≤15s) for a fresh fact from the winner → "cache"
          winner finished without one → latest (stale) or 503
  won   → re-check freshness (someone may have just finished)  → "cache"
          call OpenAI (10s timeout)
            ok    → insert fact, return                        → "generated"
            fails → return latest if any                       → "stale-fallback"
                    else friendly 503
          finally release lease (only if we still own it)
```

**Cache window.** Fresh means `now - createdAt < 60_000ms`. A fact exactly 60s old triggers regeneration. Tests cover 59.999s, exactly 60s, and a walk through 0s → 30s → 60s.

**Burst protection — "generation in progress" lease.** I chose this from the list of allowed approaches:

```sql
UPDATE "User" SET "factGenerationStartedAt" = $now
WHERE id = $userId AND ("factGenerationStartedAt" IS NULL OR "factGenerationStartedAt" < $now - 30s)
```

- A single conditional `UPDATE` is atomic in Postgres. Under READ COMMITTED, concurrent updaters block on the row lock and re-evaluate the `WHERE` once the winner commits, so exactly one caller gets `count = 1`. `npm run test:db` checks this with 20 concurrent callers.
- It works across tabs, processes and server instances, because the state lives in the DB, not in memory.
- **No transaction is held open during the OpenAI call.** The rejected alternative was `SELECT … FOR UPDATE` / an advisory lock wrapped around the API call, which would pin a pooled connection for up to 10s per request.
- **Crash safety:** a lease older than 30s (> OpenAI timeout) is treated as abandoned and can be taken over.
- **Release is ownership-checked** (`WHERE factGenerationStartedAt = <my timestamp>`), so a slow request can't release a lease that a later request took over.
- Losers don't fail: they wait briefly for the winner's fact, so two tabs both show the same new fact.

**Failure handling.** OpenAI errors and timeouts are caught in the service. If any previous fact exists for this user + movie, even an expired one, it's returned with `source: "stale-fallback"` and the UI says so. Otherwise the API returns a 503 with a friendly message. Unexpected errors return a generic 500, and details are only logged server-side.

**Safe OpenAI integration.**
- The key is only read server-side in a `server-only` module.
- 10s timeout, no SDK retries (keeps the worst case under the waiter's 15s budget; fallback covers failures).
- The movie title is user input, so it's length-limited and control-character-free by validation. The model is told to treat it strictly as a title, `max_output_tokens` is capped, and output is trimmed and length-capped.

**Authorization.** `GET /api/fact` takes **no user identifier**. The user id comes only from the server-side session, and every repository query is scoped by `userId`. Tests check that:
- an unauthenticated request gets a 401 and never touches the service;
- the service is called with the session user only;
- a fresh fact belonging to another user, for the same movie, is never returned (unit test + DB test).

The dashboard and onboarding pages likewise only ever load `where: { id: sessionUserId }`.

### Validation

`favoriteMovieSchema` (zod) runs on the server: string required, trim, collapse internal whitespace, 1–100 chars, no control characters. The input's `maxLength`/`required` are UX only.

### Other hardening

- Security headers on every response: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- `app/error.tsx` catches unexpected render errors and shows a retry screen instead of a stack trace.
- OpenAI failures are logged as a single line (no response headers in logs).

---

## Key tradeoffs

- **DB lease vs. in-memory lock vs. unique constraint.**
  - An in-memory lock breaks with more than one server instance or serverless.
  - A unique constraint on `(userId, 60s-bucket)` dedupes inserts, but only after paying for duplicate OpenAI calls, and fixed buckets don't match a sliding "last 60s" window.
  - The lease prevents the duplicate calls themselves, at the cost of one extra column and an `UPDATE` on cache misses.
- **Waiting losers poll** instead of using `LISTEN/NOTIFY` or a queue. Polling is simple and bounded (≤15s, at most 30 cheap indexed reads). For this traffic profile, that's the right complexity.
- **App clock for timestamps.** Using one clock makes the window math exact. With multiple instances it relies on NTP-synced hosts. The alternative is to compute everything with the DB's `now()`.
- **Lease is per user, not per (user, movie).** A user has one movie at a time, so this is equivalent and simpler.
- **Fact fetched client-side** after the dashboard renders, so a slow OpenAI call never blocks the page. The cost is one extra round trip and a loading state.
- **Database sessions over JWT.** Revocable, and the user row stays the single source of truth. The cost is a DB read per authenticated request.
- **Facts are append-only history.** Nice for auditing and fallback, but unbounded growth. A retention job would be needed long-term.

## What I'd improve with 2 more hours

- Per-user rate limiting on `/api/fact` and a stricter cap on regenerations per hour (cost control).
- Moderation pass on model output and an `OPENAI_MODEL` allowlist.
- An "edit favorite movie" flow; the `movie` snapshot on facts already makes cache invalidation correct for it.
- Browser-level tests (Playwright) for the onboarding form and the client-side redirect paths. The current e2e suite works at the HTTP level.
- A Content-Security-Policy with nonces (needs care with Next's inline scripts).
- Structured logging/metrics for cache hit rate, lease contention and OpenAI latency/errors.
- Fact retention policy (e.g. keep the last N per user).

---

## AI usage

- Used an AI coding assistant (GitHub Copilot in VS Code) to scaffold the project, look up Next.js 16 / Prisma 7 / Auth.js v5 API changes (`proxy.ts`, async request APIs, Cache Components + Suspense, Prisma driver adapters), and draft boilerplate (Auth.js tables, Tailwind markup).
- Designed the fact-generation algorithm (lease, waiter, fallback) and the schema myself with AI as a sounding board; reviewed the concurrency reasoning manually and verified it with a real-Postgres concurrency test.
- AI drafted the test cases from my list of scenarios; I reviewed each assertion against the requirements (e.g. "exactly 60s" boundary, cross-user scoping).
- Drafted this README with AI assistance and edited it for accuracy.
