import { ADVANCE_REMINDER_MIN_REMAINING_MS } from "@foucusly/contracts";
import type { AppDatabase } from "../db.js";
import { countRunningTimers, deletePushSubscription, listPushSubscriptions, markReminderSent, readSettings, reminderSeen } from "../db.js";
import { buildAdvancePushPayload, buildPushPayload, type PushPayload } from "./payload.js";
import type { PushSender } from "./sender.js";

export interface DueReminder {
  profileId: string;
  endsAt: number;
  mode: string;
  payload: PushPayload;
  /** Bookkeeping key. Completion reminders use endsAt; advance reminders use a distinct key. */
  dedupeAt?: number;
}

function sessionTaskTitle(db: AppDatabase, profileId: string): string | null {
  const row = db.prepare("SELECT value FROM timer WHERE profile_id = ?").get(profileId) as { value: string } | undefined;
  try { return (JSON.parse(row?.value ?? "{}") as { currentSessionTaskTitle?: string | null }).currentSessionTaskTitle ?? null; }
  catch { return null; }
}

export function collectDueReminders(db: AppDatabase, now: number): DueReminder[] {
  const running = countRunningTimers(db);
  const due: DueReminder[] = [];
  for (const timer of running) {
    if (timer.endsAt > now) continue;
    if (reminderSeen(db, timer.profileId, timer.endsAt)) continue;
    due.push({ profileId: timer.profileId, endsAt: timer.endsAt, mode: timer.mode, payload: buildPushPayload(timer.mode, sessionTaskTitle(db, timer.profileId)) });
  }
  return due;
}

/** Negative endsAt cannot collide with a completion reminder, which is keyed by endsAt itself. */
export function advanceReminderKey(endsAt: number): number {
  return -Math.abs(endsAt);
}

function reminderLeadMinutes(db: AppDatabase, profileId: string): number {
  try {
    const minutes = readSettings(db, profileId).notificationReminderMinutes;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return 0;
    return Math.min(120, Math.floor(minutes));
  } catch {
    return 0;
  }
}

export function collectAdvanceReminders(db: AppDatabase, now: number): DueReminder[] {
  const running = countRunningTimers(db);
  const due: DueReminder[] = [];
  for (const timer of running) {
    const remainingMs = timer.endsAt - now;
    if (remainingMs <= ADVANCE_REMINDER_MIN_REMAINING_MS) continue;
    const minutes = reminderLeadMinutes(db, timer.profileId);
    if (minutes <= 0 || now < timer.endsAt - minutes * 60_000) continue;
    const dedupeAt = advanceReminderKey(timer.endsAt);
    if (reminderSeen(db, timer.profileId, dedupeAt)) continue;
    due.push({
      profileId: timer.profileId,
      endsAt: timer.endsAt,
      dedupeAt,
      mode: timer.mode,
      payload: buildAdvancePushPayload(timer.mode, remainingMs, sessionTaskTitle(db, timer.profileId))
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
  markReminderSent(db, due.profileId, due.dedupeAt ?? due.endsAt);
  return { profileId: due.profileId, sent, removed };
}

export async function startPushScheduler(db: AppDatabase, sender: PushSender, intervalMs: number, logger = console): Promise<() => void> {
  const tick = async () => {
    try {
      const now = Date.now();
      const due = [...collectDueReminders(db, now), ...collectAdvanceReminders(db, now)];
      for (const reminder of due) await dispatchReminder(db, reminder, sender);
    } catch (error) {
      logger.error("[push-scheduler]", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(handle);
}
