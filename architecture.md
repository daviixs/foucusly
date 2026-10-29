# Foucusly architecture

Foucusly is a TypeScript monorepo for a local-first Pomodoro application. It uses a browser SPA, a small HTTP API, and one SQLite file. The design favors a simple deployable unit over distributed services: the API process owns durable state and the optional push reminder loop, while the browser renders and advances the live timer.

## System context

```text
┌─────────────────────────────────── Browser ───────────────────────────────────┐
│ React + Vite SPA                                                               │
│ App / panels / dialogs ── api.ts ── fetch("/api/*", x-profile-id)              │
│ live countdown, audio, browser notifications, local profile selection          │
└─────────────────────────────────┬─────────────────────────────────────────────┘
                                  │
                         reverse proxy in production
                                  │
┌─────────────────────────────── Fastify API ───────────────────────────────────┐
│ routes → Zod validation → domain/data helpers → SQLite prepared statements     │
│              └──────── optional Web Push scheduler ──────────┐                 │
└─────────────────────────────────┬────────────────────────────┼─────────────────┘
                                  │                            │
                      data/foucusly.sqlite                 Web Push service
```

The frontend development server proxies `/api` to Fastify on port `3001`. In production, a static server serves `apps/web/dist` and proxies the same path to the API. The API binds to `127.0.0.1` by default, which keeps the common proxy deployment private by default.

## Monorepo boundaries

| Area                   | Location             | Responsibility                                                                                                         |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Shared domain contract | `packages/contracts` | TypeScript types for API payloads, timer settings/defaults, and pure duration calculation.                             |
| Web client             | `apps/web`           | React UI, client-side countdown, sounds, dialogs, local restoration of profile selection, and API calls.               |
| HTTP and persistence   | `apps/api`           | Fastify lifecycle, request validation, profile-scoped routes, SQLite schema/data access, reporting, and push delivery. |

`@foucusly/contracts` is the only package shared by the web and API. It deliberately has no browser or database dependencies. A domain shape exposed by an endpoint should be represented there, rather than re-declared in each application.

## Request and profile scope

Profiles are local data partitions, not authenticated accounts. On startup, the web client retrieves the available profiles, restores `foucusly-profile-id` from `localStorage` when possible, and sends the selected id as `x-profile-id` on subsequent scoped requests.

The API permits only health and profile-management routes without the standard pre-handler guard. Every other route checks that the header exists and refers to a current profile before it performs work. Data queries then include `profile_id`; this second layer is essential, because header validation alone does not prevent an unscoped SQL query from leaking data across local profiles.

```text
ProfileGate → POST /api/profiles → profile id in localStorage
                                      ↓
component → api.ts → x-profile-id → Fastify preHandler → profile-scoped SQL
```

Profile deletion is intentionally guarded by requiring the request header to match the profile id being deleted.

## API shape

The API uses JSON below `/api`. `server.ts` owns the shared server configuration, error conversion, rate limiting, and core resources; modular route files handle profiles, projects, and reports.

| Resource       | Main endpoints                                                              | Notes                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health         | `GET /health`                                                               | Unscoped liveness response.                                                                                                                                    |
| Profiles       | `GET/POST /profiles`, `DELETE /profiles/:id`                                | Local profile management.                                                                                                                                      |
| Bootstrap      | `GET /bootstrap`                                                            | Returns the selected profile's tasks, projects, settings, and timer in one read.                                                                               |
| Tasks          | `POST /tasks`, `PATCH/DELETE /tasks/:id`, `POST /tasks/actions/:action`     | Tasks belong to a profile and may reference an active project. Bulk actions are `clear-finished`, `clear-pomos`, and `clear-all` (`services/task-actions.ts`). |
| Projects       | `GET/POST /projects`, `PATCH/DELETE /projects/:id`, archived/restore routes | Deletion archives; it does not delete history.                                                                                                                 |
| Timer/settings | `PUT /timer`, `PUT /settings`                                               | Durable per-profile snapshots/settings.                                                                                                                        |
| Sessions       | `POST /sessions`                                                            | Idempotently records a completed cycle and applies focus-task side effects.                                                                                    |
| Reports        | `GET /reports`, `/reports/detail`, `/reports/ranking`                       | Focus-only aggregate, detail, and ranking queries.                                                                                                             |

All request payloads are parsed with Zod before a write occurs. The error handler turns validation failures into `400` responses and avoids exposing internal error details for `5xx` failures. Fastify has a global request rate limit, with tighter limits on write-heavy routes.

## Persistence model

`createDatabase` opens the file at `DATABASE_PATH` (default `data/foucusly.sqlite`), enables WAL mode and foreign keys, creates missing tables, and performs additive compatibility migrations. This allows newer app versions to reuse an existing local database.

| Table                | Purpose                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `profiles`           | Local profile id, case-insensitive unique username, creation time.                                                 |
| `settings`           | One JSON settings value per profile.                                                                               |
| `timer`              | One persisted timer state per profile, including active-session snapshot fields.                                   |
| `projects`           | Profile-owned projects, optional color, and `archived_at` marker.                                                  |
| `tasks`              | Profile-owned task queue, estimates/progress/completion state, optional project link, and ordering.                |
| `sessions`           | Completed focus or break intervals, with a UUID primary key for idempotency and denormalized task/project context. |
| `push_subscriptions` | Browser push subscription JSON per profile and endpoint.                                                           |
| `push_reminders`     | `(profile_id, ends_at)` deduplication record for scheduled notifications.                                          |
| `app_config`         | Process-level persisted settings, including VAPID material when configured.                                        |

Task, project, and session indexes include profile-related access patterns. Reporting filters completed `pomodoro` sessions by their end time; archived projects therefore remain reportable through the historical session record.

## Timer and session lifecycle

The timer is a coordinated browser/API state machine:

1. `App.tsx` loads the bootstrap payload and retains the persisted `TimerState` locally.
2. Starting a stopped timer assigns a UUID session id (when needed), captures the task title and project id, sets `endsAt`, and persists the updated state through `PUT /api/timer`.
3. The browser checks `endsAt` on a short interval. This avoids trusting elapsed ticks and allows the remaining time to be recalculated after a delayed tab.
4. When the timer finishes, the client posts one completed record to `POST /api/sessions` using its session id.
5. The API inserts the session with `INSERT OR IGNORE`. A newly inserted Pomodoro increments its associated task; configured auto-completion and queue reordering occur in the same completion path.
6. The client selects the next mode: a short break normally follows a Pomodoro, a long break follows every configured interval, and Pomodoro follows any break. Auto-start settings decide whether the next state runs immediately.
7. The next timer snapshot is persisted and the bootstrap data is refreshed.

Pausing stores the remaining seconds and clears `endsAt`; resuming retains the original session context. Thus a pause/resume does not create extra session records.

## Reporting

Report routes delegate period parsing and aggregation to `services/reporting.ts`. Inputs constrain the requested period (`day`, `week`, `month`, `year`) and anchor date. The reporting service returns:

- total focus seconds and completed focus sessions;
- active-day and current-streak counts;
- time buckets for a timeline;
- project summaries;
- detailed session history;
- ranked projects or tasks.

The UI accesses those routes through the API client and presents them in `ReportDialog` rather than calculating report data from the current task list. Completed sessions are the accounting source of truth.

## Push reminders

The API starts a polling scheduler after Fastify begins listening. At the configured interval (15 seconds by default), it finds profile timers whose `endsAt` is due, skips ones already recorded in `push_reminders`, builds a mode-aware payload, and sends it to every stored subscription for that profile. Expired subscriptions are removed; successful or attempted reminder windows are recorded to prevent duplicate sends.

This scheduler is intentionally in-process. One API process with one SQLite database is the supported topology. Multiple API processes sharing a file or scheduler ownership would require explicit coordination before it can make reliable delivery guarantees.

## Configuration and operational constraints

| Variable                | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `PORT`, `HOST`          | Fastify listener; defaults to `3001` and `127.0.0.1`.                |
| `DATABASE_PATH`         | SQLite database location.                                            |
| `CORS_ORIGINS`          | Optional comma-separated allowlist for cross-origin browser clients. |
| `TRUST_PROXY`           | Enables/configures Fastify proxy trust.                              |
| `PUSH_POLL_INTERVAL_MS` | Scheduler interval in milliseconds; defaults to `15000`.             |

SQLite is durable application data, not a cache. Back it up before upgrades or migrations. The browser's `localStorage` only remembers the selected local profile and is recoverable; all substantive state lives in SQLite.

## Change guide

- Add or alter cross-boundary domain data in `packages/contracts`, then update both applications.
- Add an API feature by defining Zod validation, enforcing profile scope, using prepared statements, and extending `apps/web/src/api.ts` before integrating a component.
- Add a persisted field with a backward-compatible `db.ts` migration path and ensure old timer/settings JSON is still handled safely.
- Change completion behavior only after considering duplicate session submissions, paused timers, task deletion/archive, and report correctness.
- Run `bun run typecheck` for all changes, and `bun run build` when package or production boundaries are affected.
