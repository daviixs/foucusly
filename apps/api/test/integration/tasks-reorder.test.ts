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

async function createThreeTasks(): Promise<string[]> {
  const titles = ["First", "Second", "Third"];
  const ids: string[] = [];
  for (const title of titles) {
    ids.push(((await (await send("POST", "/api/tasks", { title })).json()) as { id: string }).id);
  }
  return ids;
}

async function orderedTitles(): Promise<string[]> {
  const bootstrap = (await (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-profile-id": owner } })).json()) as { tasks: Array<{ title: string; sortOrder: number }> };
  return bootstrap.tasks.sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.title);
}

describe("batch task reordering", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "reorder-owner").id;
  });

  it("reorders a batch of tasks with one call", async () => {
    const ids = await createThreeTasks();
    const response = await send("PUT", "/api/tasks/reorder", { order: [ids[2], ids[0], ids[1]] });
    expect(response.statusCode).toBe(200);
    expect(await orderedTitles()).toEqual(["Third", "First", "Second"]);
  });

  it("ignores unknown or foreign task ids and keeps the rest", async () => {
    const ids = await createThreeTasks();
    const response = await send("PUT", "/api/tasks/reorder", { order: [ids[1], ids[2], "00000000-0000-4000-8000-000000000009"] });
    expect(response.statusCode).toBe(200);
    await expect(await orderedTitles()).toEqual(["First", "Second", "Third"]);
  });

  it("rejects reorder payloads that contain only foreign ids", async () => {
    const ids = await createThreeTasks();
    other = createProfile(db, "reorder-stranger").id;
    const foreign = await send("PUT", "/api/tasks/reorder", { order: [ids[2], ids[1], ids[0]] }, other);
    expect(foreign.statusCode).toBe(400);
    expect(await orderedTitles()).toEqual(["First", "Second", "Third"]);
    const bootstrap = (await (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-profile-id": other } })).json()) as { tasks: unknown[] };
    expect(bootstrap.tasks).toHaveLength(0);
  });

  it("requires at least one valid id and a valid payload shape", async () => {
    await createThreeTasks();
    expect((await send("PUT", "/api/tasks/reorder", { order: [] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/tasks/reorder", { order: ["not-a-uuid"] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/tasks/reorder", {})).statusCode).toBe(400);
  });

  it("still preserves single-sortOrder updates through PATCH", async () => {
    const ids = await createThreeTasks();
    const patched = await send("PATCH", `/api/tasks/${ids[0]}`, { sortOrder: 99 });
    expect(patched.statusCode).toBe(200);
    expect(await orderedTitles()).toEqual(["Second", "Third", "First"]);
  });
});
