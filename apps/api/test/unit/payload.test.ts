import { describe, expect, it } from "vitest";
import { buildPushPayload } from "../../src/push/payload.js";

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
});
