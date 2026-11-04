import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, signToken, verifyPassword, verifyToken } from "../../src/auth/index.js";
import { type AppDatabase, createDatabase, createProfile } from "../../src/db.js";
import { buildServer } from "../../src/server.js";
import { authHeader, TEST_AUTH_SECRET } from "../auth-helper.js";

let db: AppDatabase;
let app: FastifyInstance;

const post = (url: string, payload: unknown) =>
  app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    payload: payload as Record<string, unknown>,
  });

beforeEach(() => {
  db = createDatabase(":memory:");
  app = buildServer(db, { authSecret: TEST_AUTH_SECRET });
});

describe("auth", () => {
  it("does not expose a profile list", async () => {
    createProfile(db, "alice");
    const anon = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(anon.statusCode).toBe(401);
    expect(anon.body).not.toContain("alice");
    const me = createProfile(db, "bob").id;
    const authed = await app.inject({
      method: "GET",
      url: "/api/profiles",
      headers: { authorization: authHeader(me) },
    });
    expect(authed.statusCode).toBe(404);
  });

  it("rejects requests without a token, with a bad token, or with only x-profile-id", async () => {
    const id = createProfile(db, "carol").id;
    expect((await app.inject({ method: "GET", url: "/api/bootstrap" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-profile-id": id } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { authorization: "Bearer nope" } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/bootstrap",
          headers: { authorization: `Bearer ${signToken(id, "wrong-secret")}` },
        })
      ).statusCode,
    ).toBe(401);
    const expired = signToken(id, TEST_AUTH_SECRET, Math.floor(Date.now() / 1000) - 31 * 86400);
    expect(
      (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { authorization: `Bearer ${expired}` } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

  it("registers, logs in, and rejects wrong passwords with a generic message", async () => {
    const reg = await post("/api/auth/register", { username: "dave", password: "correct horse" });
    expect(reg.statusCode).toBe(201);
    const { token } = reg.json() as { token: string };
    expect(
      (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(200);
    expect((await post("/api/auth/register", { username: "DAVE", password: "another pass" })).statusCode).toBe(409);
    expect((await post("/api/auth/register", { username: "erin", password: "short" })).statusCode).toBe(400);
    const wrong = await post("/api/auth/login", { username: "dave", password: "wrong password" });
    expect(wrong.statusCode).toBe(401);
    const unknown = await post("/api/auth/login", { username: "nobody", password: "wrong password" });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    const ok = await post("/api/auth/login", { username: "dave", password: "correct horse" });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { profile: { username: string } }).profile.username).toBe("dave");
    expect(JSON.stringify(ok.json())).not.toContain("scrypt");
  });

  it("lets a legacy profile without password be claimed on first login, then requires that password", async () => {
    const legacy = createProfile(db, "legacy");
    const first = await post("/api/auth/login", { username: "legacy", password: "new password 1" });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { profile: { id: string } }).profile.id).toBe(legacy.id);
    expect((await post("/api/auth/login", { username: "legacy", password: "someone else" })).statusCode).toBe(401);
    expect((await post("/api/auth/login", { username: "legacy", password: "new password 1" })).statusCode).toBe(200);
  });

  it("prevents user A from reading or changing user B's data", async () => {
    const a = createProfile(db, "usera").id;
    const b = createProfile(db, "userb").id;
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: authHeader(b), "content-type": "application/json" },
      payload: { title: "B secret", note: "", estimatePomos: 1 },
    });
    expect(created.statusCode).toBeLessThan(300);
    const taskId = (created.json() as { id: string }).id;
    const aBoot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { authorization: authHeader(a), "x-profile-id": b },
    });
    expect(aBoot.body).not.toContain("B secret");
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: { authorization: authHeader(a), "content-type": "application/json" },
      payload: { title: "hijack" },
    });
    expect(patch.statusCode).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/profiles/${b}`, headers: { authorization: authHeader(a) } }))
        .statusCode,
    ).toBe(403);
  });

  it("hashes and signs correctly", async () => {
    const hash = await hashPassword("pw-12345678");
    expect(await verifyPassword("pw-12345678", hash)).toBe(true);
    expect(await verifyPassword("pw-12345679", hash)).toBe(false);
    expect(verifyToken(signToken("x", "s"), "s")).toBe("x");
  });
});
