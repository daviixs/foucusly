import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Settings, WebhookEvent } from "@foucusly/contracts";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, readSettings, writeSettings, type AppDatabase } from "../../src/db.js";

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;
const calls: Array<{ url: string; body: string; headers: Headers }> = [];

const UUID = (seed: string) => `${seed}-0000-4000-8000-000000000000`.slice(0, 36);

function iso(secondsAgo: number) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

function send(method: string, path: string, body?: unknown, profileId = owner) {
  const headers: Record<string, string> = { "x-profile-id": profileId };
  const init: Parameters<FastifyInstance["inject"]>[0] = { method, url: path, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.payload = body; }
  return app.inject(init);
}

function enableWebhooks(events: WebhookEvent[] = ["session.finished", "task.completed"], patch: Partial<Settings> = {}) {
  writeSettings(db, owner, {
    ...readSettings(db, owner),
    webhookEnabled: true,
    webhookUrl: "http://127.0.0.1:9/hook",
    webhookSecret: "topsecret",
    webhookEvents: events,
    webhookLastError: "",
    ...patch
  });
}

async function settled() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("outbound webhooks", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
      return new Response("ok", { status: 200 });
    }));
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "webhook-owner").id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await app.close();
    db.close();
  });

  it("emits session.finished for a new session and not for the duplicate", async () => {
    enableWebhooks(["session.finished"]);
    const project = (await send("POST", "/api/projects", { name: "Deep work", color: null })).json() as { id: string };
    const task = (await send("POST", "/api/tasks", { title: "Chapter", note: "", estimatePomos: 4, projectId: project.id })).json() as { id: string };
    const session = { id: UUID("11111111"), mode: "pomodoro", startedAt: iso(1500), endedAt: iso(0), durationSeconds: 1500, taskId: task.id };
    const first = await send("POST", "/api/sessions", session);
    const second = await send("POST", "/api/sessions", session);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await settled();
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0]!.body) as { event: string; timestamp: string; profileId: string; data: Record<string, unknown> };
    expect(payload).toMatchObject({
      event: "session.finished",
      profileId: owner,
      data: {
        type: "focus",
        round: 1,
        task: "Chapter",
        project: "Deep work",
        session_start: session.startedAt,
        session_end: session.endedAt,
        seconds: 1500,
        session_id: session.id,
        task_id: task.id,
        project_id: project.id
      }
    });
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    expect(calls[0]!.headers.get("x-foucusly-signature")).toMatch(/^sha256=[0-9a-f]{64}$/);
    const bootstrap = await send("GET", "/api/bootstrap");
    expect((bootstrap.json() as { tasks: Array<{ completedPomos: number }> }).tasks[0]?.completedPomos).toBe(1);
  });

  it("does not emit when webhooks are disabled or the event is not selected", async () => {
    enableWebhooks(["task.completed"], { webhookEnabled: false });
    await send("POST", "/api/sessions", { id: UUID("22222222"), mode: "pomodoro", startedAt: iso(60), endedAt: iso(0), durationSeconds: 60 });
    await settled();
    expect(calls).toHaveLength(0);

    enableWebhooks(["task.completed"]);
    await send("POST", "/api/sessions", { id: UUID("33333333"), mode: "shortBreak", startedAt: iso(60), endedAt: iso(0), durationSeconds: 60 });
    await settled();
    expect(calls).toHaveLength(0);
  });

  it("emits task.completed from auto-check and from a manual transition only once", async () => {
    enableWebhooks();
    writeSettings(db, owner, { ...readSettings(db, owner), autoCheckTasks: true });
    const task = (await send("POST", "/api/tasks", { title: "Finish", note: "", estimatePomos: 1, projectId: null })).json() as { id: string };
    const created = await send("POST", "/api/sessions", { id: UUID("44444444"), mode: "pomodoro", startedAt: iso(60), endedAt: iso(0), durationSeconds: 60, taskId: task.id });
    expect(created.statusCode).toBe(201);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const events = calls.map((call) => (JSON.parse(call.body) as { event: string }).event);
    expect(events).toEqual(["session.finished", "task.completed"]);
    const taskPayload = JSON.parse(calls[1]!.body) as { data: { task_title: string; estimated_pomos: number; completed_pomos: number } };
    expect(taskPayload.data).toMatchObject({ task_title: "Finish", estimated_pomos: 1, completed_pomos: 1 });

    calls.length = 0;
    const again = await send("PATCH", `/api/tasks/${task.id}`, { completed: true });
    expect(again.statusCode).toBe(200);
    await settled();
    expect(calls).toHaveLength(0);

    const manual = (await send("POST", "/api/tasks", { title: "Manual", note: "", estimatePomos: 2, projectId: null })).json() as { id: string };
    const checked = await send("PATCH", `/api/tasks/${manual.id}`, { completed: true });
    expect(checked.statusCode).toBe(200);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ event: "task.completed", data: { task_id: manual.id, task_title: "Manual" } });
  });

  it("keeps the session when delivery fails and records the last error", async () => {
    enableWebhooks(["session.finished"]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const response = await send("POST", "/api/sessions", { id: UUID("55555555"), mode: "pomodoro", startedAt: iso(60), endedAt: iso(0), durationSeconds: 60 });
    expect(response.statusCode).toBe(201);
    await vi.waitFor(() => expect(readSettings(db, owner).webhookLastError).toBe("Webhook request failed"));
    const detail = await send("GET", "/api/reports/detail?period=day");
    expect((detail.json() as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("does not emit session.finished for a manual session", async () => {
    enableWebhooks();
    const response = await send("POST", "/api/sessions/manual", { startedAt: iso(120), endedAt: iso(0), taskTitle: "Offline" });
    expect(response.statusCode).toBe(201);
    await settled();
    expect(calls).toHaveLength(0);
  });

  it("saves a loopback URL, rejects a private URL, and keeps omitted webhook fields", async () => {
    const saved = await send("PUT", "/api/settings", { ...readSettings(db, owner), webhookEnabled: true, webhookUrl: "http://127.0.0.1:9/hook", webhookSecret: "topsecret", webhookToken: "tok", webhookEvents: ["session.finished"] });
    expect(saved.statusCode).toBe(200);
    expect(readSettings(db, owner).webhookUrl).toBe("http://127.0.0.1:9/hook");

    const rejected = await send("PUT", "/api/settings", { ...readSettings(db, owner), webhookUrl: "https://10.0.0.8/hook" });
    expect(rejected.statusCode).toBe(400);
    expect(readSettings(db, owner).webhookUrl).toBe("http://127.0.0.1:9/hook");

    const current = readSettings(db, owner);
    const { webhookUrl: _url, webhookSecret: _secret, webhookEnabled: _enabled, webhookEvents: _events, webhookLastError: _error, ...rest } = current;
    const preserved = await send("PUT", "/api/settings", rest);
    expect(preserved.statusCode).toBe(200);
    expect(readSettings(db, owner).webhookUrl).toBe("http://127.0.0.1:9/hook");
    expect(readSettings(db, owner).webhookSecret).toBe("topsecret");
    expect(readSettings(db, owner).webhookToken).toBe("tok");
  });

  it("returns ping delivery status from the test endpoint", async () => {
    enableWebhooks(["session.finished"]);
    const ok = await send("POST", "/api/webhooks/test", { webhookUrl: "http://127.0.0.1:9/hook", webhookSecret: "topsecret" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, status: 200, attempts: 1 });
    const payload = JSON.parse(calls[0]!.body) as { event: string; data: { message: string } };
    expect(payload).toMatchObject({ event: "ping", profileId: owner, data: { message: "ping" } });

    const missing = await send("POST", "/api/webhooks/test", { webhookUrl: "" });
    expect(missing.statusCode).toBe(400);
    const blocked = await send("POST", "/api/webhooks/test", { webhookUrl: "http://10.1.1.1/hook" });
    expect(blocked.statusCode).toBe(400);
  });
});
