import { DEFAULT_SETTINGS, normalizeSettings } from "@foucusly/contracts";
import { describe, expect, it } from "vitest";

describe("appearance setting", () => {
  it("defaults to light", () => {
    expect(DEFAULT_SETTINGS.appearance).toBe("light");
    expect(normalizeSettings({}).appearance).toBe("light");
  });

  it("maps legacy color themes to light and drops themeColor", () => {
    for (const themeColor of ["red", "teal", "blue", "green", "purple"]) {
      const settings = normalizeSettings({ themeColor } as Parameters<typeof normalizeSettings>[0]);
      expect(settings.appearance).toBe("light");
      expect(settings).not.toHaveProperty("themeColor");
    }
  });

  it("keeps dark and rejects unknown values", () => {
    expect(normalizeSettings({ appearance: "dark" }).appearance).toBe("dark");
    expect(normalizeSettings({ appearance: "sepia" as never }).appearance).toBe("light");
  });
});
