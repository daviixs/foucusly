import type { StoredPushSubscription } from "../db.js";
import type { PushPayload } from "./payload.js";

export interface SendResult {
  endpoint: string;
  delivered: boolean;
  expired: boolean;
  error?: string;
}

export interface PushSender {
  send(subscription: unknown, payload: PushPayload): Promise<{ ok: boolean; expired: boolean }>;
}

export interface PushFailure {
  subscription: StoredPushSubscription;
  reason: string;
  expired: boolean;
}
