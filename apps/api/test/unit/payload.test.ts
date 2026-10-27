import { describe, expect, it } from "vitest";
import { buildAdvancePushPayload, buildPushPayload } from "../../src/push/payload.js";

describe("buildPushPayload", () => {
  it("uses pomodoro copy for focus sessions", () => {
    const payload = buildPushPayload("pomodoro");
    expect(payload).toMatchObject({ title: "Pomodoro finished", mode: "pomodoro", url: "/app" });
    expect(payload.body).toContain("break");
  });

  it("uses break copy for short and long breaks", () => {
    expect(buildPushPayload("shortBreak").title).toBe("Short break finished");
    expect(buildPushPayload("longBreak").title).toBe("Long break finished");
  });

  it("falls back to pomodoro copy for unknown modes", () => {
    expect(buildPushPayload("mystery").title).toBe("Pomodoro finished");
  });

  it("mentions the completed task title", () => {
    const payload = buildPushPayload("pomodoro", "Write chapter");
    expect(payload.body).toContain("Write chapter is done.");
  });

  it("describes the time left before a timer ends", () => {
    const payload = buildAdvancePushPayload("pomodoro", 5 * 60_000, "Write chapter");
    expect(payload).toMatchObject({ title: "Focus ending soon", mode: "pomodoro", url: "/app" });
    expect(payload.body).toBe("5 min left on Write chapter.");
    expect(buildAdvancePushPayload("shortBreak", 20_000).body).toBe("Less than a minute left.");
    expect(buildAdvancePushPayload("longBreak", 2 * 60_000).title).toBe("Long break ending soon");
    expect(buildAdvancePushPayload("mystery", 60_000).mode).toBe("pomodoro");
  });
});
