import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, isAllowedWebhookUrl, normalizeSettings, webhookSessionType } from "@foucusly/contracts";
import { deliverWebhook, signWebhookBody, validateWebhookUrl, type WebhookLookup } from "../../src/services/webhooks.js";

const publicLookup: WebhookLookup = async () => ["1.1.1.1"];
const privateLookup: WebhookLookup = async () => ["10.1.2.3"];
const mixedLookup: WebhookLookup = async () => ["1.1.1.1", "192.168.0.5"];
const failingLookup: WebhookLookup = async () => { throw new Error("ENOTFOUND"); };

describe("normalizeSettings", () => {
  it("fills safe webhook defaults and drops the removed tasksVisible flag", () => {
    const settings = normalizeSettings({ pomodoroMinutes: 30, tasksVisible: false });
    expect(settings.pomodoroMinutes).toBe(30);
    expect(settings.webhookEnabled).toBe(false);
    expect(settings.webhookUrl).toBe("");
    expect(settings.webhookSecret).toBe("");
    expect(settings.webhookEvents).toEqual([]);
    expect(settings.webhookLastError).toBe("");
    expect(settings).not.toHaveProperty("tasksVisible");
  });

  it("keeps known events once and ignores anything else", () => {
    const settings = normalizeSettings({
      webhookEnabled: true,
      webhookEvents: ["task.completed", "session.started", "session.finished", "task.completed"] as never
    });
    expect(settings.webhookEnabled).toBe(true);
    expect(settings.webhookEvents).toEqual(["task.completed", "session.finished"]);
  });

  it("does not treat a non-boolean enabled flag as on", () => {
    expect(normalizeSettings({ webhookEnabled: "yes" as never }).webhookEnabled).toBe(false);
  });

  it("does not share the default events array", () => {
    const first = normalizeSettings({});
    first.webhookEvents.push("session.finished");
    expect(normalizeSettings({}).webhookEvents).toEqual([]);
    expect(DEFAULT_SETTINGS.webhookEvents).toEqual([]);
  });
});

describe("validateWebhookUrl", () => {
  it("allows https public hosts and loopback http", async () => {
    await expect(validateWebhookUrl("https://hooks.example/catch", publicLookup)).resolves.toMatchObject({ ok: true });
    await expect(validateWebhookUrl("https://1.1.1.1/hook", failingLookup)).resolves.toMatchObject({ ok: true });
    await expect(validateWebhookUrl("http://127.0.0.1:9/hook")).resolves.toMatchObject({ ok: true });
    await expect(validateWebhookUrl("http://localhost/hook")).resolves.toMatchObject({ ok: true });
    await expect(validateWebhookUrl("http://[::1]:8080/hook")).resolves.toMatchObject({ ok: true });
    await expect(validateWebhookUrl("https://127.0.0.2/hook")).resolves.toMatchObject({ ok: true });
  });

  it("rejects empty, credentialed, non-https, and non-public targets", async () => {
    await expect(validateWebhookUrl("  ")).resolves.toMatchObject({ ok: false, reason: "Webhook URL is empty" });
    await expect(validateWebhookUrl("not a url")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("ftp://127.0.0.1/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://user:pass@1.1.1.1/hook")).resolves.toMatchObject({ ok: false, reason: "Webhook URL cannot include credentials" });
    await expect(validateWebhookUrl("http://1.1.1.1/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("http://example.com/hook", publicLookup)).resolves.toMatchObject({ ok: false });
    for (const target of ["https://10.1.2.3/hook", "https://192.168.1.20/hook", "https://172.16.0.4/hook", "https://169.254.169.254/latest", "https://100.64.0.1/hook", "https://127.0.0.1.example/hook"]) {
      const result = await validateWebhookUrl(target, failingLookup);
      expect(result.ok, target).toBe(false);
    }
    await expect(validateWebhookUrl("https://[fe80::1]/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://[fc00::1]/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://[::ffff:169.254.169.254]/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://224.0.0.1/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://255.255.255.255/hook")).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://metadata.google.internal/computeMetadata/v1/", failingLookup)).resolves.toMatchObject({ ok: false });
  });

  it("rejects hostnames that resolve to a non-public address and unresolved names", async () => {
    await expect(validateWebhookUrl("https://hooks.example/catch", privateLookup)).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://hooks.example/catch", mixedLookup)).resolves.toMatchObject({ ok: false });
    await expect(validateWebhookUrl("https://hooks.example/catch", failingLookup)).resolves.toMatchObject({ ok: false, reason: "Webhook host could not be resolved" });
    await expect(validateWebhookUrl("https://hooks.example/catch", async () => [])).resolves.toMatchObject({ ok: false, reason: "Webhook host could not be resolved" });
  });
});

describe("signWebhookBody", () => {
  it("prefixes the hex HMAC-SHA256 of the raw body", () => {
    const expected = createHmac("sha256", "topsecret").update("hello").digest("hex");
    expect(signWebhookBody("topsecret", "hello")).toBe(`sha256=${expected}`);
    expect(signWebhookBody("topsecret", "hello")).toBe("sha256=ed76fd36523b8becda5a3b36d0e3737e8ae5111f55e26c7c3a455a3ce29636d2");
  });
});

describe("deliverWebhook", () => {
  const payload = {
    event: "ping" as const,
    timestamp: "2026-10-27T22:00:00.000Z",
    profileId: "profile-1",
    data: { message: "ping" as const }
  };
  const raw = JSON.stringify(payload);

  function mockFetch(status: number | Error, thenStatus?: number) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const step = calls.length === 1 ? status : thenStatus ?? status;
      if (step instanceof Error) throw step;
      return new Response("ok", { status: step });
    });
    return { calls, fetchImpl };
  }

  it("signs the exact body and does not retry a 2xx", async () => {
    const { calls, fetchImpl } = mockFetch(200);
    const result = await deliverWebhook({ url: "http://127.0.0.1:9/hook", secret: "topsecret", payload, fetchImpl });
    expect(result).toEqual({ ok: true, status: 200, error: null, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.body).toBe(raw);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-foucusly-event")).toBe("ping");
    expect(headers.get("x-foucusly-signature")).toBe(signWebhookBody("topsecret", raw));
    expect(headers.get("authorization")).toBeNull();
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  it("sends a Bearer token when configured", async () => {
    const { calls, fetchImpl } = mockFetch(200);
    await deliverWebhook({ url: "http://localhost/hook", secret: "", token: "tok123", payload, fetchImpl });
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer tok123");
  });

  it("omits the signature when the secret is empty", async () => {
    const { calls, fetchImpl } = mockFetch(200);
    await deliverWebhook({ url: "http://localhost/hook", secret: "", payload, fetchImpl });
    expect(new Headers(calls[0]?.init.headers).get("x-foucusly-signature")).toBeNull();
  });

  it("retries once on 5xx or timeout and not on 4xx or redirects", async () => {
    const serverError = mockFetch(503, 200);
    await expect(deliverWebhook({ url: "http://127.0.0.1/hook", secret: "", payload, fetchImpl: serverError.fetchImpl })).resolves.toMatchObject({ ok: true, status: 200, attempts: 2 });
    expect(serverError.calls).toHaveLength(2);

    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const timed = mockFetch(timeout, 200);
    await expect(deliverWebhook({ url: "http://127.0.0.1/hook", secret: "", payload, fetchImpl: timed.fetchImpl })).resolves.toMatchObject({ ok: true, error: null, attempts: 2 });

    const clientError = mockFetch(404);
    await expect(deliverWebhook({ url: "http://127.0.0.1/hook", secret: "", payload, fetchImpl: clientError.fetchImpl })).resolves.toMatchObject({ ok: false, status: 404, attempts: 1 });
    expect(clientError.calls).toHaveLength(1);

    const redirect = mockFetch(302);
    await expect(deliverWebhook({ url: "http://127.0.0.1/hook", secret: "", payload, fetchImpl: redirect.fetchImpl })).resolves.toMatchObject({ ok: false, status: 302, attempts: 1 });
  });

  it("does not call fetch when the URL is rejected", async () => {
    const fetchImpl = vi.fn();
    const result = await deliverWebhook({ url: "https://10.0.0.8/hook", secret: "x", payload, fetchImpl });
    expect(result.attempts).toBe(0);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("contracts helpers", () => {
  it("isAllowedWebhookUrl accepts https and loopback http only", () => {
    expect(isAllowedWebhookUrl("https://hooks.zapier.com/x")).toBe(true);
    expect(isAllowedWebhookUrl("http://localhost:3000/x")).toBe(true);
    expect(isAllowedWebhookUrl("http://127.0.0.1/x")).toBe(true);
    expect(isAllowedWebhookUrl("http://[::1]/x")).toBe(true);
    expect(isAllowedWebhookUrl("http://example.com/x")).toBe(false);
    expect(isAllowedWebhookUrl("ftp://localhost/x")).toBe(false);
    expect(isAllowedWebhookUrl("nope")).toBe(false);
  });
  it("maps timer modes to Pomofocus-like session types", () => {
    expect(webhookSessionType("pomodoro")).toBe("focus");
    expect(webhookSessionType("shortBreak")).toBe("short-break");
    expect(webhookSessionType("longBreak")).toBe("long-break");
  });
});
