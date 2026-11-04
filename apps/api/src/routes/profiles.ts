import type { FastifyPluginAsync } from "fastify";
import { type AppDatabase, deleteProfile, findProfile } from "../db.js";

interface ProfileRoutesOptions {
  db: AppDatabase;
}

const profileRateLimit = { max: 10, timeWindow: "1 minute" };

// Profiles are never listed publicly. Accounts are created via POST /api/auth/register.
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (app, { db }) => {
  app.get("/api/profiles/me", async (request) => findProfile(db, request.profileId));

  app.delete<{ Params: { id: string } }>(
    "/api/profiles/:id",
    { config: { rateLimit: profileRateLimit } },
    async (request, reply) => {
      const { id } = request.params;
      if (id !== request.profileId) return reply.code(403).send({ error: "You can only delete your own account" });
      deleteProfile(db, id);
      reply.code(204);
      return;
    },
  );
};
