import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../db.js";
import { runWebhookTest } from "../services/webhooks.js";

interface WebhookRoutesOptions { db: AppDatabase }

const testInput = z.object({
  webhookUrl: z.string().trim().max(2000).optional(),
  webhookSecret: z.string().trim().max(256).optional(),
  webhookToken: z.string().trim().max(512).optional()
});

const webhookRateLimit = { max: 30, timeWindow: "1 minute" };

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, { db }) => {
  app.post("/api/webhooks/test", { config: { rateLimit: webhookRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = testInput.parse(request.body ?? {});
    const outcome = await runWebhookTest(db, owner, input);
    return reply.code(outcome.statusCode).send(outcome.body);
  });
};
