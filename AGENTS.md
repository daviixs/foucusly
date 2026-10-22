# AGENTS.md — Foucusly contributor guide

This file is the canonical instruction file for AI coding agents working in this repository. It describes the product, its technical boundaries, and the safe workflow for changes. Keep any agent-specific instruction files as short pointers here; do not duplicate these rules.

## Project overview

Foucusly is a local-first focus application built around the Pomodoro technique. A person chooses a local profile, organizes work into projects and tasks, runs focus and break cycles, and reviews completed focus sessions in reports.

Core product behavior:

- Timer modes are `pomodoro`, `shortBreak`, and `longBreak`, with configurable durations, cycles, alarms, ambient audio, and automatic starts.
- A completed focus session may increment its task's completed Pomodoros and automatically complete or reorder the task according to the profile settings.
- Profiles partition all user-owned data. The selected profile id travels in the `x-profile-id` request header; it is not authentication and must not be represented as such.
- Projects can be archived instead of deleted. Archiving detaches its active tasks, while historical sessions retain their recorded project relationship for reporting.
- Reports summarize focus sessions by day, week, month, or year and expose session detail and project/task rankings.
- Web Push can notify subscribed browsers when a running timer is due. The application remains usable without push configuration.

The detailed system map is in [architecture.md](architecture.md).

## Technology stack

- **Language and package management:** TypeScript 5.9, native ESM, npm workspaces and npm lockfile.
- **Frontend:** React 19, React DOM, Vite 7, Tailwind CSS 4, Phosphor React icons, and Roboto/Roboto Mono font packages.
- **Backend:** Node.js, Fastify 5, `@fastify/cors`, `@fastify/rate-limit`, and Zod 4 request validation.
- **Persistence:** `better-sqlite3` with a file-backed SQLite database, WAL mode, foreign keys, explicit schema setup, and in-place compatibility migrations.
- **Notifications:** `web-push` and VAPID keys persisted in SQLite, with an in-process scheduler.
- **Shared model:** `@foucusly/contracts`, a compiled TypeScript package containing public types, defaults, and timer-duration logic.
- **Development tools:** `tsx` for API watch mode, Vite for web development/builds, `concurrently` for the root development command, and Vitest available in the API package.

## Repository layout

```text
apps/
├── api/                         Fastify HTTP API and SQLite access
│   └── src/
│       ├── db.ts                database creation, schema evolution, and data helpers
│       ├── server.ts            server configuration and core routes
│       ├── routes/              profile, project, report, task, session routes
│       ├── services/            report-query business logic
│       └── push/                VAPID, subscriptions, payloads, and reminder scheduler
└── web/                         React single-page application
    └── src/
        ├── App.tsx              composition root and timer lifecycle
        ├── api.ts               typed HTTP client and profile-header propagation
        ├── components/          UI panels, dialogs, profile gate, and backgrounds
        └── styles.css            global presentation styles
packages/
└── contracts/                   shared domain types, defaults, and pure helpers
README.md                        local setup and production summary
architecture.md                  detailed technical architecture
```

## Development commands

Run commands from the repository root unless a package-specific command is required.

```sh
npm install
npm run dev
npm run dev:api
npm run dev:web
npm run typecheck
npm run build
npm start
```

`npm run dev` starts the API on port `3001` and the Vite frontend on port `5173`. Vite proxies `/api` to the local API. The default database path is `data/foucusly.sqlite`; override it with `DATABASE_PATH` when needed.

Before handing off a change, run `npm run typecheck`. Run `npm run build` for changes that affect build configuration, package boundaries, or production behavior.

## Working rules

### Shared contracts

- Treat `packages/contracts/src/index.ts` as the source of truth for data crossing the web/API boundary.
- Update a shared type, default, or pure helper there first, then update both consumers. Do not create parallel frontend and backend definitions for the same domain concept.
- Build contracts before dependent packages; the root `build` script already uses the correct order.

### API and data integrity

- Validate every external request body and query at the route boundary with Zod. Return user-safe errors through the Fastify error handler.
- Scope every profile-owned query and mutation by `profile_id`. Resolve it from `x-profile-id`, never from client-supplied request bodies.
- Preserve idempotency for session completion: session ids are UUIDs and duplicate submissions must not increase task counts twice.
- Keep database evolution backward-compatible. `db.ts` opens existing local files, so add migrations/columns defensively rather than assuming a fresh database.
- Use prepared statements and transactions for grouped updates, particularly for project archival and timer/session side effects.
- Keep request limits conservative for write endpoints; `server.ts` defines the global and strict limits.

### Timer lifecycle

- The browser owns the live countdown using `endsAt`; the API persists timer snapshots so the state can survive reloads.
- Create exactly one session id when a cycle begins and send it once when the cycle completes. Do not turn a pause/resume into multiple completed sessions.
- Preserve the session's task title and project id at start time. Tasks and projects can later be renamed, archived, or detached.
- Changes to mode transitions, cycle counting, or auto-start must remain consistent with `durationForMode` and the persisted `TimerState` contract.

### Frontend conventions

- Keep `App.tsx` responsible for application-level state, timer orchestration, and composition; keep dialogs/panels focused on their UI concern.
- Use `api.ts` for API calls rather than placing ad-hoc `fetch` calls in components.
- The active profile is stored locally only to restore a selection. It is not an identity system and should not be described as login/authentication.
- Preserve the responsive timer experience and existing dark/starfield visual treatment unless the task explicitly redesigns it.

### Push notifications

- Push support is optional. Code must tolerate missing VAPID configuration, unsupported browser APIs, expired subscriptions, and scheduler send failures.
- The server scheduler is process-local. Do not imply distributed scheduling guarantees without redesigning the deployment model.

## Environment and deployment

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port for the Fastify API | `3001` |
| `HOST` | API bind host | `127.0.0.1` |
| `DATABASE_PATH` | SQLite database file path | `data/foucusly.sqlite` |
| `CORS_ORIGINS` | Comma-separated allowed origins; CORS is not registered when empty | unset |
| `TRUST_PROXY` | Enable Fastify proxy trust when exactly `true`, or use a supplied proxy setting | unset |
| `PUSH_POLL_INTERVAL_MS` | Push reminder scheduler interval | `15000` |

For production, build all workspaces, run the API, serve `apps/web/dist` from a static server, and proxy `/api` to the API process. Back up the SQLite database as application data; it contains all local profiles, timers, sessions, and push configuration.

## Delivery pipeline

- Pull requests run dependency installation, type checking, API tests, and production builds.
- A merge to `main` publishes immutable API and web images to GHCR, tagged with the commit SHA, then deploys both Coolify applications.
- Production is successful only when `/api/health`, `/api/version`, `/health`, and `/version.json` report a healthy deployment of the expected SHA.
- If verification fails, the workflow restores the Git `production` release on both applications. Image rollback never rolls back SQLite data.
- Do not deploy mutable `latest` images or change Coolify image tags manually. Follow [docs/ci-cd.md](docs/ci-cd.md) for configuration, recovery, and the required persistent SQLite volume.
