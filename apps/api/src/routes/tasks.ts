import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../db.js";
import { readBootstrap, readSettings, writeSettings } from "../db.js";

interface TaskRoutesOptions { db: AppDatabase; }

const taskRateLimit = { max: 60, timeWindow: "1 minute" };

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
const reorderInput = z.object({ order: z.array(z.string().uuid()).min(1).max(500) });

function taskBelongsToOwner(db: AppDatabase, projectId: string, owner: string): boolean {
  return Boolean(db.prepare("SELECT id FROM projects WHERE id=? AND profile_id=? AND archived_at IS NULL").get(projectId, owner));
}

export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (app, { db }) => {
  app.post("/api/tasks", { config: { rateLimit: taskRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = taskInput.parse(request.body);
    if (input.projectId && !taskBelongsToOwner(db, input.projectId, owner)) {
      return reply.code(400).send({ error: "Project not found or archived" });
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const count = (db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE profile_id=?").get(owner) as { count: number }).count;
    db.prepare("INSERT INTO tasks (id,title,note,estimate_pomos,sort_order,created_at,project_id,profile_id) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, input.title, input.note, input.estimatePomos, count, createdAt, input.projectId, owner);
    reply.code(201);
    return readBootstrap(db, owner).tasks.find((task) => task.id === id);
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", { config: { rateLimit: taskRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = taskPatch.parse(request.body);
    const current = db.prepare("SELECT * FROM tasks WHERE id = ? AND profile_id=?").get(request.params.id, owner) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: "Task not found" });
    const projectId = input.projectId === undefined ? current.project_id as string | null : input.projectId;
    if (projectId && !taskBelongsToOwner(db, projectId, owner)) {
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
    db.prepare("UPDATE tasks SET title=?, note=?, estimate_pomos=?, completed_pomos=?, completed=?, sort_order=?, project_id=? WHERE id=? AND profile_id=?")
      .run(merged.title, merged.note, merged.estimatePomos, merged.completedPomos, Number(merged.completed), merged.sortOrder, merged.projectId, request.params.id, owner);
    return readBootstrap(db, owner).tasks.find((task) => task.id === request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", { config: { rateLimit: taskRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const result = db.prepare("DELETE FROM tasks WHERE id=? AND profile_id=?").run(request.params.id, owner);
    if (!result.changes) return reply.code(404).send({ error: "Task not found" });
    return reply.code(204).send();
  });

  app.put("/api/tasks/reorder", { config: { rateLimit: taskRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const { order } = reorderInput.parse(request.body);
    const owned = new Set((db.prepare("SELECT id FROM tasks WHERE profile_id=?").all(owner) as Array<{ id: string }>).map((row) => row.id));
    const unique = [...new Set(order)].filter((id) => owned.has(id));
    if (!unique.length) return reply.code(400).send({ error: "No valid task ids in reorder payload" });
    const persist = db.transaction(() => {
      for (let index = 0; index < unique.length; index++) {
        db.prepare("UPDATE tasks SET sort_order=? WHERE id=? AND profile_id=?").run(index, unique[index], owner);
      }
    });
    persist();
    return readBootstrap(db, owner);
  });

  app.post<{ Params: { action: string } }>("/api/tasks/actions/:action", { config: { rateLimit: taskRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const action = request.params.action;
    if (action === "clear-finished") db.prepare("DELETE FROM tasks WHERE completed=1 AND profile_id=?").run(owner);
    else if (action === "clear-all") db.prepare("DELETE FROM tasks WHERE profile_id=?").run(owner);
    else if (action === "clear-pomos") db.prepare("UPDATE tasks SET completed_pomos=0 WHERE profile_id=?").run(owner);
    else if (action === "toggle-hidden") {
      const settings = readSettings(db, owner);
      writeSettings(db, owner, { ...settings, tasksVisible: !settings.tasksVisible });
    } else return reply.code(400).send({ error: "Unknown task action" });
    return readBootstrap(db, owner);
  });
};
