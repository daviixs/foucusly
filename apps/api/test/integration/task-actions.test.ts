import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, readSettings, type AppDatabase } from "../../src/db.js";
import type { FastifyInstance } from "fastify";

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;
let other: string;

interface TaskSummary { id: string; title: string; completed: boolean; completedPomos: number; sortOrder: number; }

function send(method: string, path: string, body?: unknown, profileId = owner) {
  const headers: Record<string, string> = { "x-profile-id": profileId };
  const init: Parameters<FastifyInstance["inject"]>[0] = { method, url: path, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.payload = body; }
  return app.inject(init);
}

async function createTask(title: string, patch: Record<string, unknown> = {}, profileId = owner): Promise<string> {
  const task = (await (await send("POST", "/api/tasks", { title, estimatePomos: 4 }, profileId)).json()) as { id: string };
  if (Object.keys(patch).length) await send("PATCH", `/api/tasks/${task.id}`, patch, profileId);
  return task.id;
}

async function tasksOf(profileId = owner): Promise<TaskSummary[]> {
  const bootstrap = (await (await send("GET", "/api/bootstrap", undefined, profileId)).json()) as { tasks: TaskSummary[] };
  return bootstrap.tasks;
}

describe("task bulk actions", () => {
  beforeEach(async () => {
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "actions-owner").id;
    other = createProfile(db, "actions-other").id;
    await createTask("Done first", { completed: true, completedPomos: 2 });
    await createTask("Open", { completedPomos: 3 });
    await createTask("Done last", { completed: true });
    await createTask("Foreign done", { completed: true, completedPomos: 1 }, other);
  });

  it("clears only finished tasks and compacts the remaining order", async () => {
    const response = await send("POST", "/api/tasks/actions/clear-finished");
    expect(response.statusCode).toBe(200);
    const tasks = (response.json() as { tasks: TaskSummary[] }).tasks;
    expect(tasks.map((task) => [task.title, task.sortOrder])).toEqual([["Open", 0]]);
    expect(await tasksOf(other)).toHaveLength(1);
  });

  it("resets completed pomodoros without deleting tasks", async () => {
    const response = await send("POST", "/api/tasks/actions/clear-pomos");
    expect(response.statusCode).toBe(200);
    const tasks = await tasksOf();
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.completedPomos === 0)).toBe(true);
    expect((await tasksOf(other))[0].completedPomos).toBe(1);
  });

  it("clears all tasks for the active profile only", async () => {
    const response = await send("POST", "/api/tasks/actions/clear-all");
    expect(response.statusCode).toBe(200);
    expect(await tasksOf()).toHaveLength(0);
    expect(await tasksOf(other)).toHaveLength(1);
  });

  it("rejects unknown and removed actions", async () => {
    expect((await send("POST", "/api/tasks/actions/toggle-hidden")).statusCode).toBe(400);
    expect((await send("POST", "/api/tasks/actions/drop-table")).statusCode).toBe(400);
    expect(await tasksOf()).toHaveLength(3);
  });
});

describe("removed task features", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "removed-owner").id;
  });

  it("no longer exposes task templates", async () => {
    const bootstrap = (await (await send("GET", "/api/bootstrap")).json()) as Record<string, unknown>;
    expect(bootstrap).not.toHaveProperty("templates");
    expect((await send("POST", "/api/templates", { name: "Daily", title: "Review" })).statusCode).toBe(404);
  });

  it("ignores a stored hidden-tasks setting from older databases", () => {
    db.prepare("UPDATE settings SET value=? WHERE profile_id=?").run(JSON.stringify({ tasksVisible: false, pomodoroMinutes: 30 }), owner);
    const settings = readSettings(db, owner);
    expect(settings).not.toHaveProperty("tasksVisible");
    expect(settings.pomodoroMinutes).toBe(30);
  });
});
