import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { createDatabase, createProfile, listPushSubscriptions, type AppDatabase } from "../../src/db.js";
import type { FastifyInstance } from "fastify";
import type { PushSender } from "../../src/push/sender.js";

function recordingSender(delivered = true): PushSender & { received: Array<unknown> } {
  const received: Array<unknown> = [];
  return {
    received,
    async send(subscription) {
      received.push(subscription);
      return { ok: delivered, expired: false };
    }
  };
}

let db: AppDatabase;
let app: FastifyInstance;
let owner: string;

function send(method: string, path: string, body?: unknown, profileId = owner) {
  const headers: Record<string, string> = { "x-profile-id": profileId };
  const init: Parameters<FastifyInstance["inject"]>[0] = { method, url: path, headers };
  if (body !== undefined) { headers["content-type"] = "application/json"; init.payload = body; }
  return app.inject(init);
}

const validSubscription = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { auth: "auth-key", p256dh: "dh-key" }
});

describe("web push subscriptions and test notifications", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    owner = createProfile(db, "push-owner").id;
  });

  it("exposes a base64url VAPID public key", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    const response = await send("GET", "/api/push/public-key");
    expect(response.statusCode).toBe(200);
    const { publicKey } = response.json() as { publicKey: string };
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{60,100}$/);
  });

  it("stores a subscription for the active profile", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    const response = await send("POST", "/api/push/subscribe", { subscription: validSubscription });
    expect(response.statusCode).toBe(200);
    const stored = listPushSubscriptions(db, owner);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ endpoint: "https://fcm.googleapis.com/fcm/send/abc123", profileId: owner });
  });

  it("upserts when the same device subscribes again", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    await send("POST", "/api/push/subscribe", { subscription: validSubscription });
    await send("POST", "/api/push/subscribe", { subscription: JSON.parse(validSubscription) });
    expect(listPushSubscriptions(db, owner)).toHaveLength(1);
    expect(listPushSubscriptions(db, owner)[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
  });

  it("subscribes from an object subscription body too", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    const response = await send("POST", "/api/push/subscribe", { subscription: JSON.parse(validSubscription) });
    expect(response.statusCode).toBe(200);
  });

  it("rejects subscriptions without a usable endpoint", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    expect((await send("POST", "/api/push/subscribe", { subscription: "{}" })).statusCode).toBe(400);
    expect((await send("POST", "/api/push/subscribe", { subscription: "{oops" })).statusCode).toBe(400);
  });

  it("sends a test reminder only for the owning profile", async () => {
    const sender = recordingSender();
    app = buildServer(db, { pushSender: sender });
    await send("POST", "/api/push/subscribe", { subscription: validSubscription });
    const stranger = createProfile(db, "push-stranger").id;
    const foreign = await send("POST", "/api/push/test", undefined, stranger);
    expect(foreign.statusCode).toBe(409);
    const response = await send("POST", "/api/push/test");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, delivered: 1, total: 1 });
    expect(sender.received).toHaveLength(1);
  });

  it("unsubscribes an endpoint, 404 for unknown ones", async () => {
    app = buildServer(db, { pushSender: recordingSender() });
    await send("POST", "/api/push/subscribe", { subscription: validSubscription });
    const removed = await send("DELETE", "/api/push/subscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc123" });
    expect(removed.statusCode).toBe(204);
    expect(listPushSubscriptions(db, owner)).toHaveLength(0);
    const repeat = await send("DELETE", "/api/push/subscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc123" });
    expect(repeat.statusCode).toBe(404);
  });

  it("keeps a no-op sender server build without configured push", async () => {
    app = buildServer(db);
    const response = await send("GET", "/api/push/public-key");
    expect(response.statusCode).toBe(200);
    const test = await send("POST", "/api/push/test");
    expect(test.statusCode).toBe(409);
  });
});
