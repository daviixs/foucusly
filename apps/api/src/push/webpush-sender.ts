import webpush, { type WebPushError } from "web-push";
import type { PushPayload } from "./payload.js";
import type { PushSender } from "./sender.js";

export function createWebPushSender(vapid: { publicKey: string; privateKey: string }): PushSender {
  return {
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(subscription as Parameters<typeof webpush.sendNotification>[0], JSON.stringify(payload));
        return { ok: true, expired: false };
      } catch (error) {
        const failure = error as Partial<WebPushError>;
        const expirationStatusCodes = new Set([404, 410]);
        return {
          ok: false,
          expired: typeof failure.statusCode === "number" && expirationStatusCodes.has(failure.statusCode),
          reason: failure instanceof Error ? failure.message : "Unknown web push error"
        };
      }
    }
  };
}
