import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, type AppDatabase } from "../../src/db.js";
import type { FastifyInstance } from "fastify";

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;
let other: string;

function send(method: string, path: string, body?: unknown, profileId = owner) {
  const headers: Record<string, string> = { "x-profile-id": profileId };
  const init: Parameters<FastifyInstance["inject"]>[0] = { method, url: path, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.payload = body; }
  return app.inject(init);
}

describe("archived project listing, restore and visual attributes", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "project-owner").id;
  });

  it("creates a project with a color and returns it", async () => {
    const response = await send("POST", "/api/projects", { name: "Thesis", color: "#9ad0ec" });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Thesis", color: "#9ad0ec", archivedAt: null });
  });

  it("rejects invalid color values", async () => {
    const response = await send("POST", "/api/projects", { name: "Paint", color: "red" });
    expect(response.statusCode).toBe(400);
  });

  it("updates the color of a project", async () => {
    const created = (await (await send("POST", "/api/projects", { name: "Album" })).json()) as { id: string };
    const patched = await send("PATCH", `/api/projects/${created.id}`, { color: "#f2c14e" });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { color: string }).color).toBe("#f2c14e");
  });

  it("lists archived projects after archiving, excluding active ones", async () => {
    const archived = (await (await send("POST", "/api/projects", { name: "Old job" })).json()) as { id: string };
    const active = (await (await send("POST", "/api/projects", { name: "New job" })).json()) as { id: string };
    expect((await send("DELETE", `/api/projects/${archived.id}`)).statusCode).toBe(204);
    const archivedList = (await (await send("GET", "/api/projects/archived")).json()) as Array<{ id: string }>;
    expect(archivedList.map((project) => project.id)).toEqual([archived.id]);
    const activeList = (await (await send("GET", "/api/projects")).json()) as Array<{ id: string }>;
    expect(activeList.map((project) => project.id)).toEqual([active.id]);
  });

  it("archiving detaches tasks but keeps focus history", async () => {
    const project = (await (await send("POST", "/api/projects", { name: "Side quest" })).json()) as { id: string };
    const task = (await (await send("POST", "/api/tasks", { title: "Pick up", projectId: project.id })).json()) as { id: string };
    await send("POST", "/api/sessions/manual", { startedAt: new Date(Date.now() - 900_000).toISOString(), endedAt: new Date().toISOString(), projectId: project.id, taskTitle: "Focus" });
    await send("DELETE", `/api/projects/${project.id}`);
    const bootstrap = (await (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-profile-id": owner } })).json()) as { tasks: Array<{ projectId: string | null }> };
    expect(bootstrap.tasks.find((row) => row.id === task.id)?.projectId).toBeNull();
    const detail = await app.inject({ method: "GET", url: "/api/reports/detail?period=week&date=" + new Date().toISOString().slice(0, 10), headers: { "x-profile-id": owner } });
    const sessions = (detail.json() as { sessions: Array<{ projectId: string | null }> }).sessions;
    expect(sessions[0]?.projectId).toBe(project.id);
  });

  it("restores an archived project", async () => {
    const project = (await (await send("POST", "/api/projects", { name: "Comeback", color: "#b8b5ff" })).json()) as { id: string };
    await send("DELETE", `/api/projects/${project.id}`);
    const restored = await send("POST", `/api/projects/${project.id}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: project.id, archivedAt: null, color: "#b8b5ff" });
  });

  it("refuses to restore when an active project holds the same name", async () => {
    const first = (await (await send("POST", "/api/projects", { name: "Mirror" })).json()) as { id: string };
    const second = (await (await send("POST", "/api/projects", { name: "Shadow" })).json()) as { id: string };
    await send("DELETE", `/api/projects/${first.id}`);
    await send("PATCH", `/api/projects/${second.id}`, { name: "Mirror" });
    const restored = await send("POST", `/api/projects/${first.id}/restore`);
    expect(restored.statusCode).toBe(409);
  });

  it("does not restore projects that are not archived or from another profile", async () => {
    const project = (await (await send("POST", "/api/projects", { name: "Still listed" })).json()) as { id: string };
    other = createProfile(db, "stranger").id;
    expect((await send("POST", `/api/projects/${project.id}/restore`)).statusCode).toBe(404);
    expect((await send("POST", `/api/projects/${project.id}/restore`, undefined, other)).statusCode).toBe(404);
  });
});
