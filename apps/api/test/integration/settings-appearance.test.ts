import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDatabase, createDatabase, createProfile, readSettings } from "../../src/db.js";
import { buildServer } from "../../src/server.js";

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;

function put(body: unknown) {
  return app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { "x-profile-id": owner, "content-type": "application/json" },
    payload: body as Record<string, unknown>,
  });
}

describe("PUT /api/settings appearance", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    app = buildServer(db);
    owner = createProfile(db, "appearance-owner").id;
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("saves dark and light", async () => {
    expect((await put({ ...readSettings(db, owner), appearance: "dark" })).statusCode).toBe(200);
    expect(readSettings(db, owner).appearance).toBe("dark");
    expect((await put({ ...readSettings(db, owner), appearance: "light" })).statusCode).toBe(200);
    expect(readSettings(db, owner).appearance).toBe("light");
  });

  it("rejects unknown appearance values", async () => {
    const response = await put({ ...readSettings(db, owner), appearance: "purple" });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(readSettings(db, owner).appearance).toBe("light");
  });

  it("accepts legacy clients that still send themeColor without appearance", async () => {
    const { appearance: _appearance, ...legacy } = readSettings(db, owner);
    await put({ ...readSettings(db, owner), appearance: "dark" });
    const response = await put({ ...legacy, themeColor: "teal" });
    expect(response.statusCode).toBe(200);
    const saved = readSettings(db, owner);
    expect(saved.appearance).toBe("dark");
    expect(saved).not.toHaveProperty("themeColor");
  });
});
