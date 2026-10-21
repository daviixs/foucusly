# Pomofocus

A local Pomofocus recreation with a React, TypeScript, and Tailwind frontend; a Fastify TypeScript API; and a durable SQLite database.

## Start

```sh
npm install
npm run dev
```

Open `http://localhost:5173/` for the timer and homepage or `http://localhost:5173/app` for the simple timer page. The API runs on port `3001`. SQLite is created at `data/pomofocus.sqlite` by default; set `DATABASE_PATH` to choose another file.

For production, run `npm run build`, then start the API with `npm start` and serve `apps/web/dist` from a static web server configured to proxy `/api` to the API.

## Included

- Persistent tasks, templates, timer state, settings, and completed focus sessions
- Pomodoro, short-break, and long-break cycles with configurable durations and auto-start behavior
- Reports by day, week, and month
- Responsive homepage, simple timer page, settings and report dialogs
- Local-only operation; account sign-in and premium integrations remain unavailable
