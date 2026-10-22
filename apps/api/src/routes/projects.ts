import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../db.js";

interface ProjectRoutesOptions { db: AppDatabase; }
const projectColors = ["#e5b19f", "#f2c14e", "#b6cfb6", "#9ad0ec", "#b8b5ff", "#c9a7eb", "#e5989b", "#94a7b7"] as const;
const createProjectInput = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null) });
const updateProjectInput = z.object({ name: z.string().trim().min(1).max(80).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() });

const projectRateLimit = { max: 60, timeWindow: "1 minute" };

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, { db }) => {
  app.get("/api/projects", async (request) => db.prepare(`SELECT id, name, created_at AS createdAt, archived_at AS archivedAt, color
    FROM projects WHERE profile_id=? AND archived_at IS NULL ORDER BY name COLLATE NOCASE`).all(request.headers["x-profile-id"]));

  app.get("/api/projects/archived", async (request) => db.prepare(`SELECT id, name, created_at AS createdAt, archived_at AS archivedAt, color
    FROM projects WHERE profile_id=? AND archived_at IS NOT NULL ORDER BY archived_at DESC`).all(request.headers["x-profile-id"]));

  app.post("/api/projects", { config: { rateLimit: projectRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = createProjectInput.parse(request.body);
    const duplicate = db.prepare("SELECT id FROM projects WHERE profile_id=? AND archived_at IS NULL AND name = ? COLLATE NOCASE").get(owner, input.name);
    if (duplicate) return reply.code(409).send({ error: "A project with this name already exists" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, name, created_at, color, profile_id) VALUES (?, ?, ?, ?, ?)").run(id, input.name, createdAt, input.color, owner);
    reply.code(201);
    return { id, name: input.name, createdAt, archivedAt: null, color: input.color };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", { config: { rateLimit: projectRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = updateProjectInput.parse(request.body);
    const current = db.prepare("SELECT * FROM projects WHERE id=? AND profile_id=? AND archived_at IS NULL").get(request.params.id, owner) as Record<string, unknown> | undefined;
    if (!current) return reply.code(404).send({ error: "Project not found" });
    const name = input.name ?? current.name as string;
    const color = input.color === undefined ? current.color as string | null : input.color;
    const duplicate = db.prepare("SELECT id FROM projects WHERE profile_id=? AND archived_at IS NULL AND name = ? COLLATE NOCASE AND id != ?").get(owner, name, request.params.id);
    if (duplicate) return reply.code(409).send({ error: "A project with this name already exists" });
    db.prepare("UPDATE projects SET name=?, color=? WHERE id=? AND profile_id=?").run(name, color, request.params.id, owner);
    return db.prepare("SELECT id, name, created_at AS createdAt, archived_at AS archivedAt, color FROM projects WHERE id=? AND profile_id=?").get(request.params.id, owner);
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/restore", { config: { rateLimit: projectRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const current = db.prepare("SELECT id, name FROM projects WHERE id=? AND profile_id=? AND archived_at IS NOT NULL").get(request.params.id, owner) as { id: string; name: string } | undefined;
    if (!current) return reply.code(404).send({ error: "Archived project not found" });
    const duplicate = db.prepare("SELECT id FROM projects WHERE profile_id=? AND archived_at IS NULL AND name = ? COLLATE NOCASE AND id != ?").get(owner, current.name, request.params.id);
    if (duplicate) return reply.code(409).send({ error: "A project with this name already exists" });
    const restored = db.prepare("UPDATE projects SET archived_at=NULL WHERE id=? AND profile_id=? AND archived_at IS NOT NULL").run(request.params.id, owner);
    if (!restored.changes) return reply.code(404).send({ error: "Archived project not found" });
    return db.prepare("SELECT id, name, created_at AS createdAt, archived_at AS archivedAt, color FROM projects WHERE id=? AND profile_id=?").get(request.params.id, owner);
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", { config: { rateLimit: projectRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const archivedAt = new Date().toISOString();
    const archive = db.transaction(() => {
      const result = db.prepare("UPDATE projects SET archived_at=? WHERE id=? AND profile_id=? AND archived_at IS NULL").run(archivedAt, request.params.id, owner);
      if (!result.changes) return false;
      db.prepare("UPDATE tasks SET project_id=NULL WHERE project_id=? AND profile_id=?").run(request.params.id, owner);
      return true;
    });
    if (!archive()) return reply.code(404).send({ error: "Project not found" });
    return reply.code(204).send();
  });
};

export { projectColors };
