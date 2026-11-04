import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppDatabase, createDatabase } from "../../src/db.js";
import type { SignupOptions } from "../../src/routes/auth.js";
import { buildServer, resolveTrustProxy } from "../../src/server.js";
import { TEST_AUTH_SECRET } from "../auth-helper.js";

let db: AppDatabase;
let app: FastifyInstance;

function setup(signup: Partial<SignupOptions> = {}) {
  db = createDatabase(":memory:");
  app = buildServer(db, {
    authSecret: TEST_AUTH_SECRET,
    signup: { limitPerIp: 1, windowHours: 24, turnstileSecret: "", ...signup },
  });
}

const register = (username: string, remoteAddress = "203.0.113.1", extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress,
    headers: { "content-type": "application/json" },
    payload: { username, password: "correct horse", ...extra },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("signup limit per IP", () => {
  it("allows one account per IP per window, other IPs unaffected", async () => {
    setup();
    expect((await register("alice")).statusCode).toBe(201);
    const second = await register("bob");
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "Too many accounts created from this network. Try again later." });
    expect((await register("bob", "198.51.100.7")).statusCode).toBe(201);
  });

  it("stores only hashed IPs and does not count failed registrations", async () => {
    setup();
    expect((await register("x")).statusCode).toBe(400);
    expect((await register("alice")).statusCode).toBe(201);
    const rows = db.prepare("SELECT ip_hash AS ipHash FROM signup_ips").all() as { ipHash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].ipHash).not.toContain("203.0.113.1");
  });

  it("allows a new account after the window and prunes old rows", async () => {
    setup();
    expect((await register("alice")).statusCode).toBe(201);
    db.prepare("UPDATE signup_ips SET created_at = ?").run(new Date(Date.now() - 25 * 3_600_000).toISOString());
    expect((await register("bob")).statusCode).toBe(201);
    expect((db.prepare("SELECT COUNT(*) AS n FROM signup_ips").get() as { n: number }).n).toBe(1);
  });

  it("rate-limits register attempts to 3 per hour per IP", async () => {
    setup({ limitPerIp: 0 });
    for (const name of ["a1", "a2", "a3"]) expect((await register(name)).statusCode).toBe(201);
    expect((await register("a4")).statusCode).toBe(429);
  });
});

describe("turnstile", () => {
  it("requires and verifies a token when configured", async () => {
    setup({ turnstileSecret: "test-turnstile-secret" });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      return new Response(JSON.stringify({ success: body.get("response") === "good-token" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const missing = await register("alice");
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: "Captcha verification failed" });
    expect((await register("alice", "203.0.113.1", { turnstileToken: "bad" })).statusCode).toBe(400);
    expect((await register("alice", "203.0.113.1", { turnstileToken: "good-token" })).statusCode).toBe(201);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect((init.body as URLSearchParams).get("remoteip")).toBe("203.0.113.1");
  });

  it("fails closed when the verification request errors", async () => {
    setup({ turnstileSecret: "test-turnstile-secret" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    expect((await register("alice", "203.0.113.1", { turnstileToken: "t" })).statusCode).toBe(400);
  });

  it("is skipped when not configured", async () => {
    setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await register("alice")).statusCode).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trust proxy", () => {
  it("defaults to true in production and parses TRUST_PROXY", () => {
    expect(resolveTrustProxy(undefined, "production")).toBe(true);
    expect(resolveTrustProxy(undefined, "development")).toBe(false);
    expect(resolveTrustProxy("false", "production")).toBe(false);
    expect(resolveTrustProxy("10.0.0.0/8", "production")).toBe("10.0.0.0/8");
  });

  it("uses X-Forwarded-For as client IP when trusted", async () => {
    db = createDatabase(":memory:");
    app = buildServer(db, {
      authSecret: TEST_AUTH_SECRET,
      trustProxy: true,
      signup: { limitPerIp: 1, turnstileSecret: "" },
    });
    const viaProxy = (username: string, ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/register",
        remoteAddress: "10.0.0.2",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        payload: { username, password: "correct horse" },
      });
    expect((await viaProxy("alice", "203.0.113.9")).statusCode).toBe(201);
    expect((await viaProxy("bob", "198.51.100.9")).statusCode).toBe(201);
    expect((await viaProxy("carol", "203.0.113.9")).statusCode).toBe(429);
  });
});
