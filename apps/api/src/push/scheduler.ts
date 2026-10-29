import type { AppDatabase } from "../db.js";
import {
  countRunningTimers,
  deletePushSubscription,
  listPushSubscriptions,
  markReminderSent,
  reminderSeen,
} from "../db.js";
import { buildPushPayload, type PushPayload } from "./payload.js";
import type { PushSender } from "./sender.js";

export interface DueReminder {
  profileId: string;
  endsAt: number;
  mode: string;
  payload: PushPayload;
}

export function collectDueReminders(db: AppDatabase, now: number): DueReminder[] {
  const running = countRunningTimers(db);
  const due: DueReminder[] = [];
  for (const timer of running) {
    if (timer.endsAt > now) continue;
    if (reminderSeen(db, timer.profileId, timer.endsAt)) continue;
    const row = db.prepare("SELECT value FROM timer WHERE profile_id = ?").get(timer.profileId) as
      | { value: string }
      | undefined;
    let taskTitle: string | null = null;
    try {
      taskTitle =
        (JSON.parse(row?.value ?? "{}") as { currentSessionTaskTitle?: string }).currentSessionTaskTitle ?? null;
    } catch {
      taskTitle = null;
    }
    due.push({
      profileId: timer.profileId,
      endsAt: timer.endsAt,
      mode: timer.mode,
      payload: buildPushPayload(timer.mode, taskTitle),
    });
  }
  return due;
}

export interface ReminderResult {
  profileId: string;
  sent: number;
  removed: number;
}

export async function dispatchReminder(db: AppDatabase, due: DueReminder, sender: PushSender): Promise<ReminderResult> {
  const subscriptions = listPushSubscriptions(db, due.profileId);
  let sent = 0;
  let removed = 0;
  for (const item of subscriptions) {
    const result = await sender.send(item.subscription, due.payload);
    if (result.ok) sent += 1;
    if (result.expired && deletePushSubscription(db, item.endpoint)) removed += 1;
  }
  markReminderSent(db, due.profileId, due.endsAt);
  return { profileId: due.profileId, sent, removed };
}

export async function startPushScheduler(
  db: AppDatabase,
  sender: PushSender,
  intervalMs: number,
  logger = console,
): Promise<() => void> {
  const tick = async () => {
    try {
      const due = collectDueReminders(db, Date.now());
      for (const reminder of due) await dispatchReminder(db, reminder, sender);
    } catch (error) {
      logger.error("[push-scheduler]", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(handle);
}
