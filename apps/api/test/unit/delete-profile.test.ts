import { describe, expect, it } from "vitest";
import { createDatabase, createProfile, deleteProfile, listPushSubscriptions, markReminderSent, upsertPushSubscription } from "../../src/db.js";

describe("deleteProfile", () => {
  it("removes that profile's push subscriptions and reminders", () => {
    const db = createDatabase(":memory:");
    const owner = createProfile(db, "gone").id;
    const other = createProfile(db, "stays").id;
    upsertPushSubscription(db, owner, "https://push.example/owner", JSON.stringify({ endpoint: "https://push.example/owner" }));
    upsertPushSubscription(db, other, "https://push.example/other", JSON.stringify({ endpoint: "https://push.example/other" }));
    markReminderSent(db, owner, 10);
    markReminderSent(db, other, 20);

    deleteProfile(db, owner);

    expect(listPushSubscriptions(db).map((item) => item.endpoint)).toEqual(["https://push.example/other"]);
    const ownerReminders = db.prepare("SELECT COUNT(*) AS count FROM push_reminders WHERE profile_id = ?").get(owner) as { count: number };
    const otherReminders = db.prepare("SELECT COUNT(*) AS count FROM push_reminders WHERE profile_id = ?").get(other) as { count: number };
    expect(ownerReminders.count).toBe(0);
    expect(otherReminders.count).toBe(1);
    expect(db.prepare("SELECT id FROM profiles WHERE id = ?").get(other)).toMatchObject({ id: other });
  });
});
