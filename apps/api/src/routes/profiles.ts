import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createProfile, deleteProfile, findProfile, listProfiles, type AppDatabase } from "../db.js";

interface ProfileRoutesOptions { db: AppDatabase; }
const profileInput = z.object({ username: z.string().trim().min(2).max(30) });

const profileRateLimit = { max: 10, timeWindow: "1 minute" };

export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (app, { db }) => {
  app.get("/api/profiles", async () => listProfiles(db));

  app.post("/api/profiles", { config: { rateLimit: profileRateLimit } }, async (request, reply) => {
    const { username } = profileInput.parse(request.body);
    if (db.prepare("SELECT id FROM profiles WHERE username = ? COLLATE NOCASE").get(username)) {
      return reply.code(409).send({ error: "This username is already in use" });
    }
    try {
      const profile = createProfile(db, username);
      reply.code(201);
      return profile;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ error: "This username is already in use" });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", { config: { rateLimit: profileRateLimit } }, async (request, reply) => {
    const { id } = request.params;
    const caller = request.headers["x-profile-id"];
    if (typeof caller !== "string" || caller !== id) {
      return reply.code(401).send({ error: "Deleting a profile requires the matching x-profile-id header" });
    }
    const existing = findProfile(db, id);
    if (!existing) {
      return reply.code(404).send({ error: "Profile not found" });
    }
    deleteProfile(db, id);
    reply.code(204);
    return;
  });
};
