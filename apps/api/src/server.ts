import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SETTINGS, durationForMode, type DailyReport, type ReportData, type ReportPeriod, type SessionRecord, type Settings, type TimerMode } from "@pomofocus/contracts";
import { type AppDatabase, readBootstrap, readSettings, readTimer, writeSettings, writeTimer } from "./db.js";

const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().max(3000).default(""),
  estimatePomos: z.number().int().min(1).max(24).default(1)
});
const taskPatch = taskInput.partial().extend({
  completed: z.boolean().optional(),
  completedPomos: z.number().int().min(0).max(24).optional(),
  sortOrder: z.number().int().optional()
});
const settingsInput = z.object({
  pomodoroMinutes: z.number().int().min(1).max(180),
  shortBreakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(90),
  longBreakInterval: z.number().int().min(2).max(12),
  autoStartBreaks: z.boolean(), autoStartPomodoros: z.boolean(), autoCheckTasks: z.boolean(), checkToBottom: z.boolean(),
  alarmSound: z.string().min(1).max(40), alarmVolume: z.number().int().min(0).max(100), alarmRepeat: z.number().int().min(1).max(5),
  focusSound: z.string().min(1).max(40), focusVolume: z.number().int().min(0).max(100),
  themeColor: z.enum(["red", "teal", "blue", "green", "purple"]), hourFormat: z.enum(["12-hour", "24-hour"]),
  darkModeWhenRunning: z.boolean(), notificationReminderMinutes: z.number().int().min(0).max(120),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]), tasksVisible: z.boolean()
});
const timerInput = z.object({
  mode: z.enum(["pomodoro", "shortBreak", "longBreak"]),
  remainingSeconds: z.number().int().min(0).max(10800),
  running: z.boolean(), endsAt: z.number().nullable(), cyclePomos: z.number().int().min(0).max(100),
  activeTaskId: z.string().nullable(), currentSessionId: z.string().nullable(), sessionStartedAt: z.string().datetime().nullable()
});
const sessionInput = z.object({
  id: z.string().uuid(), mode: z.enum(["pomodoro", "shortBreak", "longBreak"]),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), durationSeconds: z.number().int().min(1).max(10800),
  taskId: z.string().nullable().optional()
});
const templateInput = z.object({ name: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200), note: z.string().max(3000).default(""), estimatePomos: z.number().int().min(1).max(24).default(1) });
const todayString = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIME_ZONE ?? "America/Sao_Paulo" }).format(date);
const nextDay = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

function periodBounds(period: ReportPeriod, dateValue: string, weekStartsOn: 0 | 1) {
  const date = new Date(`${dateValue}T12:00:00`);
  const day = date.getDay();
  const back = (day - weekStartsOn + 7) % 7;
  const start = period === "day" ? date : period === "week" ? nextDay(date, -back) : period === "month"
    ? new Date(date.getFullYear(), date.getMonth(), 1, 12) : new Date(date.getFullYear(), 0, 1, 12);
  const days = period === "day" ? 1 : period === "week" ? 7 : period === "month"
    ? new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() : 365 + (new Date(start.getFullYear(), 1, 29).getMonth() === 1 ? 1 : 0);
  return { start: todayString(start), end: todayString(nextDay(start, days - 1)), days };
}

function reportFor(db: AppDatabase, period: ReportPeriod, date: string): ReportData {
  const settings = readSettings(db);
  const bounds = periodBounds(period, date, settings.weekStartsOn);
  const sessions = db.prepare(`SELECT id, mode, started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds, task_id AS taskId
    FROM sessions WHERE mode = 'pomodoro' AND ended_at >= ? AND ended_at < ? ORDER BY ended_at DESC`)
    .all(`${bounds.start}T00:00:00`, `${todayString(nextDay(new Date(`${bounds.end}T12:00:00`), 1))}T00:00:00`) as SessionRecord[];
  const dailyMap = new Map<string, DailyReport>();
  for (let offset = 0; offset < bounds.days; offset++) {
    const day = todayString(nextDay(new Date(`${bounds.start}T12:00:00`), offset));
    dailyMap.set(day, { date: day, focusSeconds: 0, sessions: 0 });
  }
  for (const session of sessions) {
    const day = todayString(new Date(session.endedAt));
    const item = dailyMap.get(day);
    if (item) { item.focusSeconds += session.durationSeconds; item.sessions += 1; }
  }
  const allDays = db.prepare("SELECT DISTINCT substr(ended_at, 1, 10) AS day FROM sessions WHERE mode = 'pomodoro' ORDER BY day DESC").all() as Array<{ day: string }>;
  const daySet = new Set(allDays.map(({ day }) => day));
  let streak = 0;
  let cursor = new Date(`${todayString(new Date())}T12:00:00`);
  while (daySet.has(todayString(cursor))) { streak += 1; cursor = nextDay(cursor, -1); }
  const daily = [...dailyMap.values()];
  return {
    period, startDate: bounds.start, endDate: bounds.end,
    focusSeconds: daily.reduce((total, item) => total + item.focusSeconds, 0),
    focusSessions: daily.reduce((total, item) => total + item.sessions, 0),
    activeDays: daily.filter((item) => item.sessions > 0).length,
    currentStreak: streak, daily, sessions
  };
}

export function buildServer(db: AppDatabase): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    reply.status(statusCode < 500 ? statusCode : 500)
      .send({ error: statusCode < 500 && error instanceof Error ? error.message : "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/bootstrap", async () => readBootstrap(db));

  app.post("/api/tasks", async (request, reply) => {
    const input = taskInput.parse(request.body);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const count = (db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count;
    db.prepare("INSERT INTO tasks (id,title,note,estimate_pomos,sort_order,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, input.title, input.note, input.estimatePomos, count, createdAt);
    reply.code(201);
    return readBootstrap(db).tasks.find((task) => task.id === id);
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const input = taskPatch.parse(request.body);
    const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: "Task not found" });
    const merged = {
      title: input.title ?? current.title as string,
      note: input.note ?? current.note as string,
      estimatePomos: input.estimatePomos ?? current.estimate_pomos as number,
      completedPomos: input.completedPomos ?? current.completed_pomos as number,
      completed: input.completed === undefined ? Boolean(current.completed) : input.completed,
      sortOrder: input.sortOrder ?? current.sort_order as number
    };
    db.prepare("UPDATE tasks SET title=?, note=?, estimate_pomos=?, completed_pomos=?, completed=?, sort_order=? WHERE id=?")
      .run(merged.title, merged.note, merged.estimatePomos, merged.completedPomos, Number(merged.completed), merged.sortOrder, request.params.id);
    return readBootstrap(db).tasks.find((task) => task.id === request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const result = db.prepare("DELETE FROM tasks WHERE id=?").run(request.params.id);
    if (!result.changes) return reply.code(404).send({ error: "Task not found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { action: string } }>("/api/tasks/actions/:action", async (request, reply) => {
    const action = request.params.action;
    if (action === "clear-finished") db.prepare("DELETE FROM tasks WHERE completed=1").run();
    else if (action === "clear-all") db.prepare("DELETE FROM tasks").run();
    else if (action === "clear-pomos") db.prepare("UPDATE tasks SET completed_pomos=0").run();
    else if (action === "toggle-hidden") {
      const settings = readSettings(db);
      writeSettings(db, { ...settings, tasksVisible: !settings.tasksVisible });
    } else return reply.code(400).send({ error: "Unknown task action" });
    return readBootstrap(db);
  });

  app.post("/api/templates", async (request, reply) => {
    const input = templateInput.parse(request.body);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM templates").get() as { count: number }).count;
    if (count >= 3) return reply.code(409).send({ error: "Free templates are limited to three" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO templates (id,name,title,note,estimate_pomos,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, input.name, input.title, input.note, input.estimatePomos, createdAt);
    reply.code(201);
    return readBootstrap(db).templates.find((template) => template.id === id);
  });
  app.delete<{ Params: { id: string } }>("/api/templates/:id", async (request, reply) => {
    const result = db.prepare("DELETE FROM templates WHERE id=?").run(request.params.id);
    if (!result.changes) return reply.code(404).send({ error: "Template not found" });
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/templates/:id/use", async (request, reply) => {
    const template = db.prepare("SELECT * FROM templates WHERE id=?").get(request.params.id) as { title: string; note: string; estimate_pomos: number } | undefined;
    if (!template) return reply.code(404).send({ error: "Template not found" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const count = (db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count;
    db.prepare("INSERT INTO tasks (id,title,note,estimate_pomos,sort_order,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, template.title, template.note, template.estimate_pomos, count, createdAt);
    reply.code(201);
    return readBootstrap(db).tasks.find((task) => task.id === id);
  });

  app.put("/api/settings", async (request) => {
    const input = settingsInput.parse(request.body);
    writeSettings(db, input as Settings);
    const timer = readTimer(db);
    if (!timer.running) writeTimer(db, { ...timer, remainingSeconds: durationForMode(input as Settings, timer.mode) });
    return readSettings(db);
  });

  app.put("/api/timer", async (request) => {
    const timer = timerInput.parse(request.body);
    writeTimer(db, timer);
    return timer;
  });

  app.post("/api/sessions", async (request, reply) => {
    const input = sessionInput.parse(request.body);
    const insert = db.prepare("INSERT OR IGNORE INTO sessions (id,mode,started_at,ended_at,duration_seconds,task_id) VALUES (?,?,?,?,?,?)")
      .run(input.id, input.mode, input.startedAt, input.endedAt, input.durationSeconds, input.taskId ?? null);
    if (insert.changes && input.mode === "pomodoro" && input.taskId) {
      const settings = readSettings(db);
      const task = db.prepare("SELECT completed_pomos, estimate_pomos FROM tasks WHERE id=?").get(input.taskId) as { completed_pomos: number; estimate_pomos: number } | undefined;
      if (task) {
        const completedPomos = task.completed_pomos + 1;
        db.prepare("UPDATE tasks SET completed_pomos=?, completed=? WHERE id=?")
          .run(completedPomos, Number(settings.autoCheckTasks && completedPomos >= task.estimate_pomos), input.taskId);
        if (settings.checkToBottom && completedPomos >= task.estimate_pomos) {
          const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM tasks").get() as { next: number }).next;
          db.prepare("UPDATE tasks SET sort_order=? WHERE id=?").run(max, input.taskId);
        }
      }
    }
    reply.code(insert.changes ? 201 : 200);
    return { saved: true, duplicate: !insert.changes };
  });

  app.get<{ Querystring: { period?: string; date?: string } }>("/api/reports", async (request, reply) => {
    const period = request.query.period ?? "week";
    if (!["day", "week", "month", "year"].includes(period)) return reply.code(400).send({ error: "Invalid report period" });
    const date = request.query.date ?? todayString(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return reply.code(400).send({ error: "Invalid report date" });
    return reportFor(db, period as ReportPeriod, date);
  });

  app.get("/api/reports/sessions", async () => db.prepare("SELECT id, mode, started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds, task_id AS taskId FROM sessions ORDER BY ended_at DESC LIMIT 100").all());
  return app;
}

