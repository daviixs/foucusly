import { describe, expect, it } from "vitest";
import { createDatabase, putConfigValue, getConfigValue, type AppDatabase } from "../../src/db.js";
import { getVapidKeys } from "../../src/push/vapid.js";

function memoryDb(): AppDatabase {
  return createDatabase(":memory:");
}

describe("getVapidKeys", () => {
  it("generates and persists keys on first use", () => {
    const db = memoryDb();
    const keys = getVapidKeys(db);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(getConfigValue(db, "web_push_vapid")).toBeTruthy();
  });

  it("reuses the persisted keys across calls", () => {
    const db = memoryDb();
    const first = getVapidKeys(db);
    const second = getVapidKeys(db);
    expect(second).toEqual(first);
  });

  it("survives a corrupted stored payload by regenerating", () => {
    const db = memoryDb();
    getVapidKeys(db);
    putConfigValue(db, "web_push_vapid", "not json");
    const regenerated = getVapidKeys(db);
    expect(regenerated.publicKey).toBeTruthy();
  });

  it("prefers environment configuration and does not persist it", () => {
    const db = memoryDb();
    process.env.VAPID_PUBLIC_KEY = "env-public-_key";
    process.env.VAPID_PRIVATE_KEY = "env-private-key";
    try {
      const keys = getVapidKeys(db);
      expect(keys.publicKey).toBe("env-public-_key");
      expect(getConfigValue(db, "web_push_vapid")).toBeUndefined();
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
  });
});
