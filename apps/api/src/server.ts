import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { durationForMode, normalizeSettings, WEBHOOK_EVENTS, type Settings } from "@foucusly/contracts";
import { findProfile, type AppDatabase, readBootstrap, readSettings, readTimer, writeSettings, writeTimer } from "./db.js";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { projectRoutes } from "./routes/projects.js";
import { profileRoutes } from "./routes/profiles.js";
import { reportRoutes } from "./routes/reports/index.js";
import { taskRoutes } from "./routes/tasks.js";
import { sessionRoutes } from "./routes/sessions.js";
import { pushRoutes } from "./routes/push.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { validateWebhookUrl } from "./services/webhooks.js";
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
  darkModeWhenRunning: z.boolean(), autoDarkAtNight: z.boolean(), notificationReminderMinutes: z.number().int().min(0).max(120),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  webhookUrl: z.string().trim().max(2000).optional(),
  webhookSecret: z.string().trim().max(256).optional(),
  webhookToken: z.string().trim().max(512).optional(),
  webhookEnabled: z.boolean().optional(),
  webhookEvents: z.array(z.enum(WEBHOOK_EVENTS)).max(8).optional(),
  webhookLastError: z.string().max(500).optional()
});
const timerInput = z.object({
  mode: z.enum(["pomodoro", "shortBreak", "longBreak"]),
  remainingSeconds: z.number().int().min(0).max(10800),
  running: z.boolean(), endsAt: z.number().nullable(), cyclePomos: z.number().int().min(0).max(100),
  activeTaskId: z.string().nullable(), currentSessionId: z.string().nullable(), sessionStartedAt: z.string().datetime().nullable(),
  currentSessionTaskId: z.string().nullable().optional(), currentSessionTaskTitle: z.string().nullable().optional(), currentSessionProjectId: z.string().nullable().optional()
});

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
    if (request.url.startsWith("/api/health") || request.url.startsWith("/api/version") || request.url.startsWith("/api/profiles")) return;
    const id = request.headers["x-profile-id"];
    if (typeof id !== "string" || !id) return reply.code(401).send({ error: "Choose a profile to continue" });
    if (!findProfile(db, id)) return reply.code(404).send({ error: "Profile not found" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/version", async () => ({ commit: process.env.APP_VERSION ?? "unknown" }));
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
  void app.register(webhookRoutes, { db });
  void app.register(pushRoutes, { db, sender: options.pushSender ?? { async send() { return { ok: false, expired: false, reason: "Push sender is not configured" }; } } });

  app.put("/api/settings", { config: { rateLimit: strictRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = settingsInput.parse(request.body);
    const current = readSettings(db, owner);
    const next: Settings = normalizeSettings({
      ...current,
      ...input,
      webhookUrl: input.webhookUrl ?? current.webhookUrl,
      webhookSecret: input.webhookSecret ?? current.webhookSecret,
      webhookToken: input.webhookToken ?? current.webhookToken,
      webhookEnabled: input.webhookEnabled ?? current.webhookEnabled,
      webhookEvents: input.webhookEvents === undefined ? current.webhookEvents : input.webhookEvents,
      webhookLastError: input.webhookLastError ?? current.webhookLastError
    });
    if (next.webhookUrl) {
      const check = await validateWebhookUrl(next.webhookUrl);
      if (!check.ok) return reply.code(400).send({ error: check.reason });
    }
    writeSettings(db, owner, next);
    const timer = readTimer(db, owner);
    if (!timer.running) writeTimer(db, owner, { ...timer, remainingSeconds: durationForMode(next, timer.mode) });
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


