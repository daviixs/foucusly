import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { webhookSessionType } from "@foucusly/contracts";
import type { AppDatabase } from "../db.js";
import { readSettings } from "../db.js";
import { focusRoundFor, lookupProjectName, scheduleProfileWebhooks, type OutboundWebhook } from "../services/webhooks.js";

interface SessionRoutesOptions { db: AppDatabase; }

const sessionRateLimit = { max: 60, timeWindow: "1 minute" };

const sessionInput = z.object({
  id: z.string().uuid(), mode: z.enum(["pomodoro", "shortBreak", "longBreak"]),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), durationSeconds: z.number().int().min(1).max(10800),
  taskId: z.string().nullable().optional(), taskTitle: z.string().nullable().optional(), projectId: z.string().uuid().nullable().optional()
});

const manualSessionInput = z.object({
  mode: z.enum(["pomodoro", "shortBreak", "longBreak"]).default("pomodoro"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  taskId: z.string().uuid().nullable().optional(),
  taskTitle: z.string().trim().max(200).nullable().optional(),
  projectId: z.string().uuid().nullable().optional()
});

const sessionPatchInput = manualSessionInput.partial().omit({ mode: true }).extend({
  mode: z.enum(["pomodoro", "shortBreak", "longBreak"]).optional(),
  durationSeconds: z.number().int().min(1).max(10800).optional()
});

function resolveTaskContext(db: AppDatabase, owner: string, taskId?: string | null) {
  const task = taskId ? db.prepare("SELECT title, project_id AS projectId FROM tasks WHERE id=? AND profile_id=?").get(taskId, owner) as { title: string; projectId: string | null } | undefined : undefined;
  return task;
}

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (app, { db }) => {
  app.post("/api/sessions", { config: { rateLimit: sessionRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = sessionInput.parse(request.body);
    const task = resolveTaskContext(db, owner, input.taskId);
    const projectId = input.projectId === undefined ? task?.projectId ?? null : input.projectId;
    if (projectId && !db.prepare("SELECT id FROM projects WHERE id=? AND profile_id=?").get(projectId, owner)) return reply.code(400).send({ error: "Project not found" });
    const taskTitle = input.taskTitle === undefined ? task?.title ?? null : input.taskTitle;
    const insert = db.prepare("INSERT OR IGNORE INTO sessions (id,mode,started_at,ended_at,duration_seconds,task_id,task_title,project_id,profile_id) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(input.id, input.mode, input.startedAt, input.endedAt, input.durationSeconds, input.taskId ?? null, taskTitle, projectId, owner);
    if (insert.changes) {
      const deliveries: OutboundWebhook[] = [];
      if (input.mode === "pomodoro" && input.taskId) {
        const settings = readSettings(db, owner);
        const taskRow = db.prepare("SELECT title, completed_pomos, estimate_pomos, completed, project_id FROM tasks WHERE id=? AND profile_id=?").get(input.taskId, owner) as { title: string; completed_pomos: number; estimate_pomos: number; completed: number; project_id: string | null } | undefined;
        if (taskRow) {
          const completedPomos = taskRow.completed_pomos + 1;
          const nowCompleted = settings.autoCheckTasks && completedPomos >= taskRow.estimate_pomos;
          db.prepare("UPDATE tasks SET completed_pomos=?, completed=? WHERE id=? AND profile_id=?")
            .run(completedPomos, Number(nowCompleted), input.taskId, owner);
          if (settings.checkToBottom && completedPomos >= taskRow.estimate_pomos) {
            const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM tasks WHERE profile_id=?").get(owner) as { next: number }).next;
            db.prepare("UPDATE tasks SET sort_order=? WHERE id=? AND profile_id=?").run(max, input.taskId, owner);
          }
          if (!taskRow.completed && nowCompleted) {
            deliveries.push({
              event: "task.completed",
              data: {
                task_id: input.taskId,
                task_title: taskRow.title,
                project_id: taskRow.project_id,
                project_name: lookupProjectName(db, owner, taskRow.project_id),
                estimated_pomos: taskRow.estimate_pomos,
                completed_pomos: completedPomos
              }
            });
          }
        }
      }
      deliveries.unshift({
        event: "session.finished",
        data: {
          type: webhookSessionType(input.mode),
          round: focusRoundFor(db, owner, input.endedAt),
          task: taskTitle,
          project: lookupProjectName(db, owner, projectId),
          session_start: input.startedAt,
          session_end: input.endedAt,
          seconds: input.durationSeconds,
          session_id: input.id,
          task_id: input.taskId ?? null,
          project_id: projectId
        }
      });
      scheduleProfileWebhooks(db, owner, deliveries);
    }
    reply.code(insert.changes ? 201 : 200);
    return { saved: true, duplicate: !insert.changes };
  });

  app.post("/api/sessions/manual", { config: { rateLimit: sessionRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = manualSessionInput.parse(request.body);
    const started = Date.parse(input.startedAt);
    const ended = Date.parse(input.endedAt);
    if (Number.isNaN(started) || Number.isNaN(ended) || ended <= started) return reply.code(400).send({ error: "endedAt must be after startedAt" });
    if (ended > Date.now() + 60_000) return reply.code(400).send({ error: "Manual sessions cannot end in the future" });
    const task = resolveTaskContext(db, owner, input.taskId === undefined ? null : input.taskId);
    const projectId = input.projectId === undefined ? task?.projectId ?? null : input.projectId;
    if (projectId && !db.prepare("SELECT id FROM projects WHERE id=? AND profile_id=?").get(projectId, owner)) return reply.code(400).send({ error: "Project not found" });
    const taskTitle = input.taskTitle === undefined ? task?.title ?? null : input.taskTitle;
    const durationSeconds = Math.min(10800, Math.max(1, Math.round((ended - started) / 1000)));
    const id = randomUUID();
    db.prepare("INSERT INTO sessions (id,mode,started_at,ended_at,duration_seconds,task_id,task_title,project_id,profile_id) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, input.mode, input.startedAt, input.endedAt, durationSeconds, input.taskId ?? null, taskTitle, projectId, owner);
    reply.code(201);
    const created = db.prepare("SELECT id, mode, started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds, task_id AS taskId, task_title AS taskTitle, project_id AS projectId FROM sessions WHERE id = ?").get(id);
    return { saved: true, session: created };
  });

  app.patch<{ Params: { id: string } }>("/api/sessions/:id", { config: { rateLimit: sessionRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = sessionPatchInput.parse(request.body);
    const current = db.prepare("SELECT * FROM sessions WHERE id=? AND profile_id=?").get(request.params.id, owner) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: "Session not found" });
    const taskId = input.taskId === undefined ? current.task_id as string | null : input.taskId;
    const task = resolveTaskContext(db, owner, taskId);
    if (taskId && !task) return reply.code(400).send({ error: "Task not found" });
    const projectId = input.projectId === undefined ? current.project_id as string | null : input.projectId;
    if (projectId && !db.prepare("SELECT id FROM projects WHERE id=? AND profile_id=?").get(projectId, owner)) return reply.code(400).send({ error: "Project not found" });
    const taskTitle = input.taskTitle === undefined ? current.task_title as string | null : input.taskTitle;
    const startedAt = input.startedAt ?? current.started_at as string;
    const endedAt = input.endedAt ?? current.ended_at as string;
    const started = Date.parse(startedAt);
    const ended = Date.parse(endedAt);
    if (Number.isNaN(started) || Number.isNaN(ended) || ended <= started) return reply.code(400).send({ error: "endedAt must be after startedAt" });
    const durationSeconds = Math.min(10800, Math.max(1, input.durationSeconds ?? Math.round((ended - started) / 1000)));
    const mode = input.mode ?? current.mode as string;
    db.prepare("UPDATE sessions SET mode=?, started_at=?, ended_at=?, duration_seconds=?, task_id=?, task_title=?, project_id=? WHERE id=? AND profile_id=?")
      .run(mode, startedAt, endedAt, durationSeconds, taskId, taskTitle, projectId, request.params.id, owner);
    return db.prepare("SELECT id, mode, started_at AS startedAt, ended_at AS endedAt, duration_seconds AS durationSeconds, task_id AS taskId, task_title AS taskTitle, project_id AS projectId FROM sessions WHERE id = ?").get(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", { config: { rateLimit: sessionRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const result = db.prepare("DELETE FROM sessions WHERE id=? AND profile_id=?").run(request.params.id, owner);
    if (!result.changes) return reply.code(404).send({ error: "Session not found" });
    return reply.code(204).send();
  });
};
