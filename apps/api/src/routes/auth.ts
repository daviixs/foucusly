import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword } from "../auth/index.js";
import { type AppDatabase, createProfile, findProfile } from "../db.js";

export interface SignupOptions {
  /** Max successful registrations per IP within the window (SIGNUP_LIMIT_PER_IP, default 1; 0 disables). */
  limitPerIp: number;
  /** Window in hours (SIGNUP_WINDOW_HOURS, default 24). */
  windowHours: number;
  /** Salt for hashing IPs (SIGNUP_IP_SALT, falls back to AUTH_SECRET). Raw IPs are never stored. */
  ipSalt: string;
  /** Cloudflare Turnstile secret (TURNSTILE_SECRET_KEY). Empty = captcha disabled. */
  turnstileSecret: string;
}

interface AuthRoutesOptions {
  db: AppDatabase;
  secret: string;
  signup: SignupOptions;
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return value?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveSignupOptions(authSecret: string, env: NodeJS.ProcessEnv = process.env): SignupOptions {
  return {
    limitPerIp: Math.floor(intEnv(env.SIGNUP_LIMIT_PER_IP, 1)),
    windowHours: intEnv(env.SIGNUP_WINDOW_HOURS, 24) || 24,
    ipSalt: env.SIGNUP_IP_SALT?.trim() || authSecret,
    turnstileSecret: env.TURNSTILE_SECRET_KEY?.trim() ?? "",
  };
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  try {
    const response = await fetch(TURNSTILE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false; // fail closed: network errors/timeouts reject the registration
  }
}

const credentials = z.object({
  username: z.string().trim().min(2).max(30),
  password: z.string().min(8).max(200),
  turnstileToken: z.string().max(4096).optional(),
});
const loginInput = z.object({ username: z.string().trim().min(1).max(30), password: z.string().min(1).max(200) });
// Light per-IP limit (in-memory, via @fastify/rate-limit) to slow down password guessing.
const authRateLimit = { max: 10, timeWindow: "1 minute" };
// Registration attempts (successful or not) per IP; the persistent per-IP account limit is enforced separately.
const registerRateLimit = { max: 3, timeWindow: "1 hour" };
const INVALID = "Invalid username or password";
const SIGNUP_LIMITED = "Too many accounts created from this network. Try again later.";
const CAPTCHA_FAILED = "Captcha verification failed";

class SignupLimitError extends Error {}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { db, secret, signup }) => {
  const windowMs = signup.windowHours * 3_600_000;
  const countRecent = db.prepare("SELECT COUNT(*) AS n FROM signup_ips WHERE ip_hash = ? AND created_at > ?");
  const insertSignup = db.prepare("INSERT INTO signup_ips (ip_hash, created_at) VALUES (?, ?)");
  const pruneSignups = db.prepare("DELETE FROM signup_ips WHERE created_at <= ?");
  const limitReached = (ipHash: string, since: string) =>
    signup.limitPerIp > 0 && (countRecent.get(ipHash, since) as { n: number }).n >= signup.limitPerIp;

  app.post("/api/auth/register", { config: { rateLimit: registerRateLimit } }, async (request, reply) => {
    const { username, password, turnstileToken } = credentials.parse(request.body);
    if (signup.turnstileSecret) {
      if (!turnstileToken || !(await verifyTurnstile(signup.turnstileSecret, turnstileToken, request.ip)))
        return reply.code(400).send({ error: CAPTCHA_FAILED });
    }
    if (db.prepare("SELECT id FROM profiles WHERE username = ? COLLATE NOCASE").get(username)) {
      return reply.code(409).send({ error: "This username is not available" });
    }
    const ipHash = hashIp(request.ip, signup.ipSalt);
    const since = () => new Date(Date.now() - windowMs).toISOString();
    pruneSignups.run(since()); // opportunistic cleanup of rows outside the window
    if (limitReached(ipHash, since())) return reply.code(429).send({ error: SIGNUP_LIMITED });
    const passwordHash = await hashPassword(password);
    try {
      // Re-check and record inside one transaction so concurrent requests can't exceed the limit.
      const profile = db.transaction(() => {
        if (limitReached(ipHash, since())) throw new SignupLimitError();
        const created = createProfile(db, username, passwordHash);
        insertSignup.run(ipHash, new Date().toISOString());
        return created;
      })();
      reply.code(201);
      return { token: signToken(profile.id, secret), profile };
    } catch (error) {
      if (error instanceof SignupLimitError) return reply.code(429).send({ error: SIGNUP_LIMITED });
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed"))
        return reply.code(409).send({ error: "This username is not available" });
      throw error;
    }
  });

  app.post("/api/auth/login", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const { username, password } = loginInput.parse(request.body);
    const row = db
      .prepare("SELECT id, password_hash AS passwordHash FROM profiles WHERE username = ? COLLATE NOCASE")
      .get(username) as { id: string; passwordHash: string | null } | undefined;
    if (!row) return reply.code(401).send({ error: INVALID });
    if (row.passwordHash === null) {
      // Legacy profile created before passwords existed: the first successful login claims it.
      if (password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters" });
      const passwordHash = await hashPassword(password);
      const claimed = db
        .prepare("UPDATE profiles SET password_hash = ? WHERE id = ? AND password_hash IS NULL")
        .run(passwordHash, row.id);
      if (claimed.changes !== 1) return reply.code(401).send({ error: INVALID });
    } else if (!(await verifyPassword(password, row.passwordHash))) {
      return reply.code(401).send({ error: INVALID });
    }
    return { token: signToken(row.id, secret), profile: findProfile(db, row.id) };
  });
};
