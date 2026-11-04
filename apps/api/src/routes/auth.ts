import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashPassword, signToken, verifyPassword } from "../auth/index.js";
import { type AppDatabase, createProfile, findProfile } from "../db.js";

interface AuthRoutesOptions {
  db: AppDatabase;
  secret: string;
}
const credentials = z.object({ username: z.string().trim().min(2).max(30), password: z.string().min(8).max(200) });
const loginInput = z.object({ username: z.string().trim().min(1).max(30), password: z.string().min(1).max(200) });
// Light per-IP limit (in-memory, via @fastify/rate-limit) to slow down password guessing.
const authRateLimit = { max: 10, timeWindow: "1 minute" };
const INVALID = "Invalid username or password";

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { db, secret }) => {
  app.post("/api/auth/register", { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const { username, password } = credentials.parse(request.body);
    if (db.prepare("SELECT id FROM profiles WHERE username = ? COLLATE NOCASE").get(username)) {
      return reply.code(409).send({ error: "This username is not available" });
    }
    const passwordHash = await hashPassword(password);
    try {
      const profile = createProfile(db, username, passwordHash);
      reply.code(201);
      return { token: signToken(profile.id, secret), profile };
    } catch (error) {
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
