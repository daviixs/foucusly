import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SETTINGS, durationForMode, type Settings, type TimerMode } from "@foucusly/contracts";
import { type AppDatabase, readBootstrap, readSettings, readTimer, writeSettings, writeTimer } from "./db.js";
import { projectRoutes } from "./routes/projects.js";
import { reportRoutes } from "./routes/reports/index.js";

const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().max(3000).default(""),
  estimatePomos: z.number().int().min(1).max(24).default(1),
  projectId: z.string().uuid().nullable().default(null)
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
  activeTaskId: z.string().nullable(), currentSessionId: z.string().nullable(), sessionStartedAt: z.string().datetime().nullable(),
  currentSessionTaskId: z.string().nullable().optional(), currentSessionTaskTitle: z.string().nullable().optional(), currentSessionProjectId: z.string().nullable().optional()
});
const sessionInput = z.object({
  id: z.string().uuid(), mode: z.enum(["pomodoro", "shortBreak", "longBreak"]),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), durationSeconds: z.number().int().min(1).max(10800),
  taskId: z.string().nullable().optional(), taskTitle: z.string().nullable().optional(), projectId: z.string().uuid().nullable().optional()
});
const templateInput = z.object({ name: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200), note: z.string().max(3000).default(""), estimatePomos: z.number().int().min(1).max(24).default(1) });
export function buildServer(db: AppDatabase): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error instanceof z.ZodError ? 400 : error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    reply.status(statusCode < 500 ? statusCode : 500)
      .send({ error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : statusCode < 500 && error instanceof Error ? error.message : "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/bootstrap", async () => readBootstrap(db));
  void app.register(projectRoutes, { db });
  void app.register(reportRoutes, { db });

  app.post("/api/tasks", async (request, reply) => {
    const input = taskInput.parse(request.body);
    if (input.projectId && !db.prepare("SELECT id FROM projects WHERE id=? AND archived_at IS NULL").get(input.projectId)) {
      return reply.code(400).send({ error: "Project not found or archived" });
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const count = (db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count;
    db.prepare("INSERT INTO tasks (id,title,note,estimate_pomos,sort_order,created_at,project_id) VALUES (?,?,?,?,?,?,?)")
      .run(id, input.title, input.note, input.estimatePomos, count, createdAt, input.projectId);
    reply.code(201);
    return readBootstrap(db).tasks.find((task) => task.id === id);
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const input = taskPatch.parse(request.body);
    const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: "Task not found" });
    const projectId = input.projectId === undefined ? current.project_id as string | null : input.projectId;
    if (projectId && !db.prepare("SELECT id FROM projects WHERE id=? AND archived_at IS NULL").get(projectId)) {
      return reply.code(400).send({ error: "Project not found or archived" });
    }
    const merged = {
      title: input.title ?? current.title as string,
      note: input.note ?? current.note as string,
      estimatePomos: input.estimatePomos ?? current.estimate_pomos as number,
      completedPomos: input.completedPomos ?? current.completed_pomos as number,
      completed: input.completed === undefined ? Boolean(current.completed) : input.completed,
      sortOrder: input.sortOrder ?? current.sort_order as number,
      projectId
    };
    db.prepare("UPDATE tasks SET title=?, note=?, estimate_pomos=?, completed_pomos=?, completed=?, sort_order=?, project_id=? WHERE id=?")
      .run(merged.title, merged.note, merged.estimatePomos, merged.completedPomos, Number(merged.completed), merged.sortOrder, merged.projectId, request.params.id);
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
    const parsed = timerInput.parse(request.body);
    const taskId = parsed.currentSessionTaskId === undefined ? parsed.activeTaskId : parsed.currentSessionTaskId;
    const task = taskId ? db.prepare("SELECT title, project_id AS projectId FROM tasks WHERE id=?").get(taskId) as { title: string; projectId: string | null } | undefined : undefined;
    const timer = {
      ...parsed,
      currentSessionTaskId: parsed.currentSessionTaskId === undefined ? taskId : parsed.currentSessionTaskId,
      currentSessionTaskTitle: parsed.currentSessionTaskTitle === undefined ? task?.title ?? null : parsed.currentSessionTaskTitle,
      currentSessionProjectId: parsed.currentSessionProjectId === undefined ? task?.projectId ?? null : parsed.currentSessionProjectId
    };
    writeTimer(db, timer);
    return timer;
  });

  app.post("/api/sessions", async (request, reply) => {
    const input = sessionInput.parse(request.body);
    const task = input.taskId ? db.prepare("SELECT title, project_id AS projectId FROM tasks WHERE id=?").get(input.taskId) as { title: string; projectId: string | null } | undefined : undefined;
    const projectId = input.projectId === undefined ? task?.projectId ?? null : input.projectId;
    if (projectId && !db.prepare("SELECT id FROM projects WHERE id=?").get(projectId)) return reply.code(400).send({ error: "Project not found" });
    const taskTitle = input.taskTitle === undefined ? task?.title ?? null : input.taskTitle;
    const insert = db.prepare("INSERT OR IGNORE INTO sessions (id,mode,started_at,ended_at,duration_seconds,task_id,task_title,project_id) VALUES (?,?,?,?,?,?,?,?)")
      .run(input.id, input.mode, input.startedAt, input.endedAt, input.durationSeconds, input.taskId ?? null, taskTitle, projectId);
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

  return app;
}

