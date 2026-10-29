import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, parseCorsOrigins } from "../../src/server.js";
import { createDatabase } from "../../src/db.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe("CORS", () => {
  it("parses comma-separated origins", () => {
    expect(parseCorsOrigins(" https://a.dev/, https://b.dev ,,")).toEqual(["https://a.dev", "https://b.dev"]);
    expect(parseCorsOrigins(undefined)).toEqual([]);
  });

  it("sends no CORS headers when no origins are configured", async () => {
    app = buildServer(createDatabase(":memory:"), { corsOrigins: [] });
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://daviixs.github.io" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers preflight for an allowed origin with the expected headers and methods", async () => {
    app = buildServer(createDatabase(":memory:"), { corsOrigins: ["https://daviixs.github.io"] });
    const response = await app.inject({
      method: "OPTIONS", url: "/api/tasks",
      headers: { origin: "https://daviixs.github.io", "access-control-request-method": "PATCH", "access-control-request-headers": "content-type,x-profile-id" }
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://daviixs.github.io");
    expect(String(response.headers["access-control-allow-methods"])).toContain("PATCH");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("x-profile-id");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
  });

  it("does not allow an unknown origin", async () => {
    app = buildServer(createDatabase(":memory:"), { corsOrigins: ["https://daviixs.github.io"] });
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
