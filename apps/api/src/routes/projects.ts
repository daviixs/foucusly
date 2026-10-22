import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../db.js";

interface ProjectRoutesOptions { db: AppDatabase; }
const createProjectInput = z.object({ name: z.string().trim().min(1).max(80) });
const updateProjectInput = createProjectInput;

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, { db }) => {
  app.get("/api/projects", async (request) => db.prepare(`SELECT id, name, created_at AS createdAt, archived_at AS archivedAt
    FROM projects WHERE profile_id=? AND archived_at IS NULL ORDER BY name COLLATE NOCASE`).all(request.headers["x-profile-id"]));

  app.post("/api/projects", async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = createProjectInput.parse(request.body);
    const duplicate = db.prepare("SELECT id FROM projects WHERE profile_id=? AND archived_at IS NULL AND name = ? COLLATE NOCASE").get(owner, input.name);
    if (duplicate) return reply.code(409).send({ error: "A project with this name already exists" });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, name, created_at, profile_id) VALUES (?, ?, ?, ?)").run(id, input.name, createdAt, owner);
    reply.code(201);
    return { id, name: input.name, createdAt, archivedAt: null };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = updateProjectInput.parse(request.body);
    const current = db.prepare("SELECT id FROM projects WHERE id=? AND profile_id=? AND archived_at IS NULL").get(request.params.id, owner);
    if (!current) return reply.code(404).send({ error: "Project not found" });
    const duplicate = db.prepare("SELECT id FROM projects WHERE profile_id=? AND archived_at IS NULL AND name = ? COLLATE NOCASE AND id != ?").get(owner, input.name, request.params.id);
    if (duplicate) return reply.code(409).send({ error: "A project with this name already exists" });
    db.prepare("UPDATE projects SET name=? WHERE id=? AND profile_id=?").run(input.name, request.params.id, owner);
    return db.prepare("SELECT id, name, created_at AS createdAt, archived_at AS archivedAt FROM projects WHERE id=? AND profile_id=?").get(request.params.id, owner);
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
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
