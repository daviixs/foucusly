import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SETTINGS, durationForMode, type Settings, type TimerMode } from "@foucusly/contracts";
import { findProfile, type AppDatabase, readBootstrap, readSettings, readTimer, writeSettings, writeTimer } from "./db.js";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { projectRoutes } from "./routes/projects.js";
import { profileRoutes } from "./routes/profiles.js";
import { reportRoutes } from "./routes/reports/index.js";
import { taskRoutes } from "./routes/tasks.js";
import { sessionRoutes } from "./routes/sessions.js";
import { pushRoutes } from "./routes/push.js";
import type { PushSender } from "./push/sender.js";

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
  activeTaskId: z.string().nullable(), currentSessionId: z.string().nullable(), sessionStartedAt: z.string().datetime().nullable(),
  currentSessionTaskId: z.string().nullable().optional(), currentSessionTaskTitle: z.string().nullable().optional(), currentSessionProjectId: z.string().nullable().optional()
});
const templateInput = z.object({ name: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200), note: z.string().max(3000).default(""), estimatePomos: z.number().int().min(1).max(24).default(1) });

const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const trustProxy: boolean | string = process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY?.trim() || false;
const strictRateLimit = { max: 60, timeWindow: "1 minute" };

export interface ServerOptions { pushSender?: PushSender; }

export function buildServer(db: AppDatabase, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1_000_000, trustProxy });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error instanceof z.ZodError ? 400 : error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    reply.status(statusCode < 500 ? statusCode : 500)
      .send({ error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : statusCode < 500 && error instanceof Error ? error.message : "Internal server error" });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/health") || request.url.startsWith("/api/profiles")) return;
    const id = request.headers["x-profile-id"];
    if (typeof id !== "string" || !id) return reply.code(401).send({ error: "Choose a profile to continue" });
    if (!findProfile(db, id)) return reply.code(404).send({ error: "Profile not found" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  if (corsOrigins.length) {
    void app.register(cors, {
      origin: corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["content-type", "x-profile-id"]
    });
  }
  void app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  app.get("/api/bootstrap", async (request) => readBootstrap(db, request.headers["x-profile-id"] as string));
  void app.register(profileRoutes, { db });
  void app.register(projectRoutes, { db });
  void app.register(reportRoutes, { db });
  void app.register(taskRoutes, { db });
  void app.register(sessionRoutes, { db });
  void app.register(pushRoutes, { db, sender: options.pushSender ?? { async send() { return { ok: false, expired: false, reason: "Push sender is not configured" }; } } });

  app.post("/api/templates", { config: { rateLimit: strictRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = templateInput.parse(request.body);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM templates WHERE profile_id=?").get(owner) as { count: number }).count;
    if (count >= 3) return reply.code(409).send({ error: "Free templates are limited to three" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO templates (id,name,title,note,estimate_pomos,created_at,profile_id) VALUES (?,?,?,?,?,?,?)")
      .run(id, input.name, input.title, input.note, input.estimatePomos, createdAt, owner);
    reply.code(201);
    return readBootstrap(db, owner).templates.find((template) => template.id === id);
  });
  app.delete<{ Params: { id: string } }>("/api/templates/:id", { config: { rateLimit: strictRateLimit } }, async (request, reply) => {
    const result = db.prepare("DELETE FROM templates WHERE id=? AND profile_id=?").run(request.params.id, request.headers["x-profile-id"] as string);
    if (!result.changes) return reply.code(404).send({ error: "Template not found" });
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/templates/:id/use", { config: { rateLimit: strictRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const template = db.prepare("SELECT * FROM templates WHERE id=? AND profile_id=?").get(request.params.id, owner) as { title: string; note: string; estimate_pomos: number } | undefined;
    if (!template) return reply.code(404).send({ error: "Template not found" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const count = (db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE profile_id=?").get(owner) as { count: number }).count;
    db.prepare("INSERT INTO tasks (id,title,note,estimate_pomos,sort_order,created_at,profile_id) VALUES (?,?,?,?,?,?,?)")
      .run(id, template.title, template.note, template.estimate_pomos, count, createdAt, owner);
    reply.code(201);
    return readBootstrap(db, owner).tasks.find((task) => task.id === id);
  });

  app.put("/api/settings", { config: { rateLimit: strictRateLimit } }, async (request) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = settingsInput.parse(request.body);
    writeSettings(db, owner, input as Settings);
    const timer = readTimer(db, owner);
    if (!timer.running) writeTimer(db, owner, { ...timer, remainingSeconds: durationForMode(input as Settings, timer.mode) });
    return readSettings(db, owner);
  });

  app.put("/api/timer", { config: { rateLimit: strictRateLimit } }, async (request) => {
    const owner = request.headers["x-profile-id"] as string;
    const parsed = timerInput.parse(request.body);
    const taskId = parsed.currentSessionTaskId === undefined ? parsed.activeTaskId : parsed.currentSessionTaskId;
    const task = taskId ? db.prepare("SELECT title, project_id AS projectId FROM tasks WHERE id=? AND profile_id=?").get(taskId, owner) as { title: string; projectId: string | null } | undefined : undefined;
    const timer = {
      ...parsed,
      currentSessionTaskId: parsed.currentSessionTaskId === undefined ? taskId : parsed.currentSessionTaskId,
      currentSessionTaskTitle: parsed.currentSessionTaskTitle === undefined ? task?.title ?? null : parsed.currentSessionTaskTitle,
      currentSessionProjectId: parsed.currentSessionProjectId === undefined ? task?.projectId ?? null : parsed.currentSessionProjectId
    };
    writeTimer(db, owner, timer);
    return timer;
  });

  return app;
}


