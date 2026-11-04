import { authHeader } from "../auth-helper.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RankingEntry } from "@foucusly/contracts";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, type AppDatabase } from "../../src/db.js";

let db: AppDatabase;
let app: FastifyInstance;
const UUID = (seed: string) => `${seed}-0000-4000-8000-000000000000`.slice(0, 36);
const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: process.env.APP_TIME_ZONE ?? "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function focus(profileId: string, id: string, seconds: number, projectId: string | null = null) {
  const response = await app.inject({ method: "POST", url: "/api/sessions", headers: { authorization: authHeader(profileId), "content-type": "application/json" },
    payload: { id: UUID(id), mode: "pomodoro", startedAt: iso(seconds + 5), endedAt: iso(5), durationSeconds: seconds, taskId: null, projectId } });
  expect(response.statusCode).toBe(201);
}

async function ranking(profileId: string, by?: string) {
  const response = await app.inject({ method: "GET", url: `/api/reports/ranking?period=year&date=${today()}${by ? `&by=${by}` : ""}`, headers: { authorization: authHeader(profileId) } });
  expect(response.statusCode).toBe(200);
  return response.json() as { by: string; entries: RankingEntry[] };
}

describe("report ranking", () => {
  beforeEach(() => { db = createDatabase(":memory:"); app = buildServer(db); });
  afterEach(async () => { await app.close(); db.close(); });

  it("ranks local profiles by focus time by default", async () => {
    const ana = createProfile(db, "ana").id;
    const bruno = createProfile(db, "bruno").id;
    createProfile(db, "idle");
    await focus(ana, "11111111", 1500);
    await focus(bruno, "22222222", 1500);
    await focus(bruno, "33333333", 1500);
    const body = await ranking(ana);
    expect(body.by).toBe("user");
    expect(body.entries.map((e) => [e.rank, e.name, e.focusSeconds, e.sessions, e.isCurrentUser])).toEqual([
      [1, "bruno", 3000, 2, false],
      [2, "ana", 1500, 1, true]
    ]);
    expect(body.entries[0].id).toBe(bruno);
  });

  it("still supports ranking the current profile's projects", async () => {
    const ana = createProfile(db, "ana").id;
    const other = createProfile(db, "other").id;
    await focus(ana, "44444444", 1500);
    await focus(other, "55555555", 3000);
    const body = await ranking(ana, "project");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ name: "No project", focusSeconds: 1500, sessions: 1 });
  });
});
