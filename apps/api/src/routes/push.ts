import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../db.js";
import { deletePushSubscription, listPushSubscriptions, upsertPushSubscription } from "../db.js";
import { getVapidKeys } from "../push/vapid.js";
import { buildPushPayload } from "../push/payload.js";
import type { PushSender } from "../push/sender.js";

interface PushRoutesOptions { db: AppDatabase; sender: PushSender; }

const subscribeInput = z.object({
  subscription: z.union([z.string(), z.object({}).passthrough()]),
  alarmType: z.string().max(40).default("timer")
});

const pushRateLimit = { max: 30, timeWindow: "1 minute" };

function extractEndpoint(subscription: unknown): string | null {
  if (typeof subscription === "string") {
    try { subscription = JSON.parse(subscription); } catch { return null; }
  }
  if (typeof subscription !== "object" || subscription === null) return null;
  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  return typeof endpoint === "string" && endpoint.startsWith("https://") ? endpoint : null;
}

export const pushRoutes: FastifyPluginAsync<PushRoutesOptions> = async (app, { db, sender }) => {
  app.get("/api/push/public-key", async () => ({ publicKey: getVapidKeys(db).publicKey }));

  app.post("/api/push/subscribe", { config: { rateLimit: pushRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const input = subscribeInput.parse(request.body);
    const subscription = typeof input.subscription === "string" ? input.subscription : JSON.stringify(input.subscription);
    const endpoint = extractEndpoint(input.subscription);
    if (!endpoint) return reply.code(400).send({ error: "Subscription endpoint is missing" });
    const stored = upsertPushSubscription(db, owner, endpoint, subscription);
    void sender; // sender is only used by the scheduler and the test endpoint
    return { endpoint: stored.endpoint, createdAt: stored.createdAt };
  });

  app.delete("/api/push/subscribe", { config: { rateLimit: pushRateLimit } }, async (request, reply) => {
    const input = z.object({ endpoint: z.string().min(1).max(1000) }).parse(request.body);
    if (typeof input.endpoint === "string" && !extractEndpoint(input.endpoint) && !input.endpoint.startsWith("https://")) return reply.code(400).send({ error: "Subscription endpoint is missing" });
    if (!deletePushSubscription(db, input.endpoint)) return reply.code(404).send({ error: "Subscription not found" });
    return reply.code(204).send();
  });

  app.get("/api/push/subscriptions", async (request) => {
    const rows = listPushSubscriptions(db, request.headers["x-profile-id"] as string);
    return rows.map(({ endpoint, createdAt }) => ({ endpoint, createdAt }));
  });

  app.post("/api/push/test", { config: { rateLimit: pushRateLimit } }, async (request, reply) => {
    const owner = request.headers["x-profile-id"] as string;
    const rows = listPushSubscriptions(db, owner);
    if (!rows.length) return reply.code(409).send({ error: "No device is subscribed to push notifications" });
    let delivered = 0;
    for (const row of rows) {
      const result = await sender.send(row.subscription, buildPushPayload("pomodoro"));
      if (result.ok) delivered += 1;
    }
    return { ok: delivered > 0, delivered, total: rows.length };
  });
};
