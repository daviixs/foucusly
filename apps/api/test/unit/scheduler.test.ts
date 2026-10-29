import { describe, expect, it } from "vitest";
import {
  createDatabase,
  createProfile,
  markReminderSent,
  reminderSeen,
  upsertPushSubscription,
  writeTimer,
  type AppDatabase,
} from "../../src/db.js";
import { collectDueReminders, dispatchReminder } from "../../src/push/scheduler.js";
import type { PushSender } from "../../src/push/sender.js";

function memoryDb(): AppDatabase {
  return createDatabase(":memory:");
}

function newProfile(db: AppDatabase, name: string): string {
  return createProfile(db, name).id;
}

function endingAt(endsAt: number, mode: "pomodoro" | "shortBreak" | "longBreak", running: boolean) {
  return {
    mode,
    remainingSeconds: 10,
    running,
    endsAt,
    cyclePomos: 0,
    activeTaskId: null,
    currentSessionId: "00000000-0000-4000-8000-000000000001",
    sessionStartedAt: new Date(Date.now() - 60_000).toISOString(),
    currentSessionTaskId: null,
    currentSessionTaskTitle: "Deep work",
    currentSessionProjectId: null,
  };
}

function mockSender(results: Array<{ ok: boolean; expired?: boolean }>): PushSender {
  let index = 0;
  return {
    async send() {
      const next = results[index] ?? { ok: true };
      index += 1;
      return { ok: next.ok, expired: next.expired ?? false };
    },
  };
}

describe("collectDueReminders", () => {
  it("returns running timers whose endsAt has passed and not yet notified", () => {
    const db = memoryDb();
    const owner = newProfile(db, "timer-owner");
    const now = Date.now();
    writeTimer(db, owner, endingAt(now - 60_000, "pomodoro", true));
    const due = collectDueReminders(db, now);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ profileId: owner, mode: "pomodoro" });
  });

  it("skips timers that have not expired and ones already notified", () => {
    const db = memoryDb();
    const owner = newProfile(db, "ahead-owner");
    const other = newProfile(db, "notified-owner");
    const now = Date.now();
    writeTimer(db, owner, endingAt(now + 600_000, "pomodoro", true));
    writeTimer(db, other, endingAt(now - 60_000, "pomodoro", true));
    markReminderSent(db, other, now - 60_000);
    expect(collectDueReminders(db, now)).toHaveLength(0);
  });

  it("ignores paused and malformed timer states", () => {
    const db = memoryDb();
    const owner = newProfile(db, "paused-owner");
    const broken = newProfile(db, "broken-owner");
    const now = Date.now();
    writeTimer(db, owner, endingAt(now - 60_000, "pomodoro", false));
    db.prepare("UPDATE timer SET value = ? WHERE profile_id = ?").run("{broken json", broken);
    expect(collectDueReminders(db, now)).toHaveLength(0);
  });
});

describe("dispatchReminder", () => {
  it("sends to every subscription and records the reminder", async () => {
    const db = memoryDb();
    const owner = newProfile(db, "push-owner");
    upsertPushSubscription(db, owner, "https://push.example/a", JSON.stringify({ endpoint: "https://push.example/a" }));
    upsertPushSubscription(db, owner, "https://push.example/b", JSON.stringify({ endpoint: "https://push.example/b" }));
    const endsAt = Date.now() - 1;
    const outcome = await dispatchReminder(
      db,
      {
        profileId: owner,
        endsAt,
        mode: "pomodoro",
        payload: { title: "Pomodoro finished", body: "Break time", mode: "pomodoro", url: "/app" },
      },
      mockSender([{ ok: true }, { ok: true }]),
    );
    expect(outcome).toMatchObject({ sent: 2 });
    expect(reminderSeen(db, owner, endsAt)).toBe(true);
  });

  it("drops subscriptions the push service reports as expired", async () => {
    const db = memoryDb();
    const owner = newProfile(db, "expired-owner");
    upsertPushSubscription(
      db,
      owner,
      "https://push.example/gone",
      JSON.stringify({ endpoint: "https://push.example/gone" }),
    );
    const endsAt = Date.now() - 1;
    const outcome = await dispatchReminder(
      db,
      {
        profileId: owner,
        endsAt,
        mode: "pomodoro",
        payload: { title: "Pomodoro finished", body: "Break time", mode: "pomodoro", url: "/app" },
      },
      mockSender([{ ok: false, expired: true }]),
    );
    expect(outcome).toMatchObject({ sent: 0 });
    const rows = db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get() as { count: number };
    expect(rows.count).toBe(0);
  });
});

describe("reminder bookkeeping", () => {
  it("marks sends idempotently", () => {
    const db = memoryDb();
    const owner = newProfile(db, "idempotent-owner");
    markReminderSent(db, owner, 123);
    markReminderSent(db, owner, 123);
    const rows = db.prepare("SELECT COUNT(*) AS count FROM push_reminders").get() as { count: number };
    expect(rows.count).toBe(1);
    expect(reminderSeen(db, owner, 123)).toBe(true);
    expect(reminderSeen(db, owner, 456)).toBe(false);
  });
});
