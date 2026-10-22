import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, type AppDatabase } from "../../src/db.js";
import type { FastifyInstance } from "fastify";

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;
let other: string;
const UUID = (seed: string) => `${seed}-0000-4000-8000-000000000000`.slice(0, 36);

function post(path: string, body: unknown, profileId = owner, method = "POST") {
  const headers: Record<string, string> = { "x-profile-id": profileId };
  const init: Parameters<FastifyInstance["inject"]>[0] = { method, url: path, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.payload = body; }
  return app.inject(init);
}

function iso(secondsAgo: number) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

describe("session history management", () => {  beforeEach(() => {
    db = createDatabase(":memory:");
    app = buildServer(db);
  });

  it("creates a manual focus session for offline work", async () => {
    owner = createProfile(db, "manual-owner").id;
    const response = await post("/api/sessions/manual", { startedAt: iso(90 * 60), endedAt: iso(65 * 60), taskTitle: "Offline study" });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { saved: boolean; session: { durationSeconds: number; taskTitle: string; profileless?: never } };
    expect(body.saved).toBe(true);
    expect(body.session.taskTitle).toBe("Offline study");
    expect(body.session.durationSeconds).toBe(25 * 60);
  });

  it("rejects manual sessions that end in the future or are inverted", async () => {
    owner = createProfile(db, "future-owner").id;
    const inverted = await post("/api/sessions/manual", { startedAt: iso(60), endedAt: iso(3600) });
    expect(inverted.statusCode).toBe(400);
    const future = await post("/api/sessions/manual", { startedAt: iso(3600), endedAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(future.statusCode).toBe(400);
  });

  it("completes a timer session once (idempotent) without double counting", async () => {
    owner = createProfile(db, "timer-owner").id;
    const task = (await post("/api/tasks", { title: "Deep work", note: "", estimatePomos: 4, projectId: null })).json() as { id: string };
    const session = { id: UUID("11111111"), mode: "pomodoro", startedAt: iso(1500), endedAt: iso(0), durationSeconds: 1500, taskId: task.id };
    const first = await post("/api/sessions", session);
    const second = await post("/api/sessions", session);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-profile-id": owner } });
    const tasks = (bootstrap.json() as { tasks: Array<{ completedPomos: number }> }).tasks;
    expect(tasks[0].completedPomos).toBe(1);
  });

  it("edits an existing session title and duration", async () => {
    owner = createProfile(db, "edit-owner").id;
    const created = (await (await post("/api/sessions/manual", { startedAt: iso(3600), endedAt: iso(2400), taskTitle: "Draft" })).json()).session as { id: string };
    const patch = await post(`/api/sessions/${created.id}`, { taskTitle: "Rewrite", durationSeconds: 900 }, owner, "PATCH");
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as { taskTitle: string; durationSeconds: number };
    expect(body.taskTitle).toBe("Rewrite");
    expect(body.durationSeconds).toBe(900);
  });

  it("rejects edits with an endedAt before startedAt", async () => {
    owner = createProfile(db, "conflict-owner").id;
    const created = (await (await post("/api/sessions/manual", { startedAt: iso(3600), endedAt: iso(2400) })).json()).session as { id: string };
    const patch = await post(`/api/sessions/${created.id}`, { startedAt: iso(60), endedAt: iso(3600) }, owner, "PATCH");
    expect(patch.statusCode).toBe(400);
  });

  it("deletes a session and hides it from reports", async () => {
    owner = createProfile(db, "delete-owner").id;
    const created = (await (await post("/api/sessions/manual", { startedAt: iso(1200), endedAt: iso(0) })).json()).session as { id: string };
    const deleted = await post(`/api/sessions/${created.id}`, undefined, owner, "DELETE");
    expect(deleted.statusCode).toBe(204);
    const repeat = await post(`/api/sessions/${created.id}`, undefined, owner, "DELETE");
    expect(repeat.statusCode).toBe(404);
    const detail = await app.inject({ method: "GET", url: "/api/reports/detail?period=day&date=" + iso(0).slice(0, 10), headers: { "x-profile-id": owner } });
    expect((detail.json() as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it("scopes every read and write by profile ownership", async () => {
    owner = createProfile(db, "owner-a").id;
    other = createProfile(db, "owner-b").id;
    const response = await post("/api/sessions/manual", { startedAt: iso(1200), endedAt: iso(0) });
    const created = (response.json() as { session?: { id: string } }).session;
    const foreignGet = await app.inject({ method: "GET", url: "/api/reports/detail?period=day&date=" + iso(0).slice(0, 10), headers: { "x-profile-id": other } });
    expect((foreignGet.json() as { sessions: unknown[] }).sessions).toHaveLength(0);
    const foreignPatch = await app.inject({ method: "PATCH", url: `/api/sessions/${created?.id}`, headers: { "x-profile-id": other, "content-type": "application/json" }, payload: { taskTitle: "hijack" } });
    expect(foreignPatch.statusCode).toBe(404);
    const foreignDelete = await app.inject({ method: "DELETE", url: `/api/sessions/${created?.id}`, headers: { "x-profile-id": other } });
    expect(foreignDelete.statusCode).toBe(404);
  });

  it("requires the profile header", async () => {
    const anonymous = await app.inject({ method: "POST", url: "/api/sessions/manual", headers: { "content-type": "application/json" }, payload: { startedAt: iso(60), endedAt: iso(0) } });
    expect(anonymous.statusCode).toBe(401);
  });
});
