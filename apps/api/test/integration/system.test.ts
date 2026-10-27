import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { createDatabase } from "../../src/db.js";

describe("public system endpoints", () => {
  it("returns health and version without requiring a profile", async () => {
    const app = buildServer(createDatabase(":memory:"));

    const health = await app.inject({ method: "GET", url: "/api/health" });
    const version = await app.inject({ method: "GET", url: "/api/version" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toEqual({ commit: "unknown" });

    await app.close();
  });
});
