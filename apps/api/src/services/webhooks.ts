/**
 * Outbound webhooks.
 *
 * Auth: when `webhookSecret` is non-empty, each POST includes
 * `X-Foucusly-Signature: sha256=<hex>`. The hex is HMAC-SHA256 of the exact
 * raw JSON body (UTF-8) using the secret as the key. When `webhookToken` is
 * non-empty, `Authorization: Bearer <token>` is sent as well. Compare the header to an HMAC of the received bytes.
 * Zapier Catch Hook ignores the header, so the secret can stay empty there.
 *
 * SSRF: HTTPS is required. HTTP is allowed only for loopback (`localhost`,
 * `::1`, and `127.0.0.0/8`) so a local receiver can be tested. Literal and
 * resolved addresses in private, shared (CGNAT / `100.64.0.0/10`), link-local,
 * loopback, multicast, reserved, benchmark (`198.18.0.0/15`), and IETF protocol
 * (`192.0.0.0/24`) ranges are rejected. Hostnames are resolved before the POST
 * and rejected when any answer is non-public. Redirects are not followed.
 * The TCP connection is not pinned to the looked-up address, so a DNS
 * rebinding race between this check and `fetch` is still possible.
 *
 * A failed delivery is logged and stored on `webhookLastError`. It does not
 * throw back to the session or task write that triggered it. The timeout is
 * 4 seconds, with one retry on timeout, network error, or HTTP 5xx.
 */
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type {
  SessionFinishedWebhookData,
  TaskCompletedWebhookData,
  WebhookEnvelope,
  WebhookEvent,
  WebhookEventName,
  WebhookPingData,
  WebhookTestResult
} from "@foucusly/contracts";
import { readSettings, writeSettings, type AppDatabase } from "../db.js";

export const WEBHOOK_SIGNATURE_HEADER = "X-Foucusly-Signature";
export const WEBHOOK_EVENT_HEADER = "X-Foucusly-Event";
export const WEBHOOK_TIMEOUT_MS = 4_000;

export type WebhookLookup = (hostname: string) => Promise<string[]>;

export interface WebhookTransport {
  fetchImpl?: typeof fetch;
  lookup?: WebhookLookup;
}

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export type OutboundWebhook =
  | { event: "session.finished"; data: SessionFinishedWebhookData }
  | { event: "task.completed"; data: TaskCompletedWebhookData };

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

const nonPublicAddresses = new BlockList();
nonPublicAddresses.addSubnet("0.0.0.0", 8, "ipv4");
nonPublicAddresses.addSubnet("10.0.0.0", 8, "ipv4");
nonPublicAddresses.addSubnet("100.64.0.0", 10, "ipv4");
nonPublicAddresses.addSubnet("127.0.0.0", 8, "ipv4");
nonPublicAddresses.addSubnet("169.254.0.0", 16, "ipv4");
nonPublicAddresses.addSubnet("172.16.0.0", 12, "ipv4");
nonPublicAddresses.addSubnet("192.0.0.0", 24, "ipv4");
nonPublicAddresses.addSubnet("192.168.0.0", 16, "ipv4");
nonPublicAddresses.addSubnet("198.18.0.0", 15, "ipv4");
nonPublicAddresses.addSubnet("224.0.0.0", 4, "ipv4");
nonPublicAddresses.addSubnet("240.0.0.0", 4, "ipv4");
nonPublicAddresses.addAddress("::", "ipv6");
nonPublicAddresses.addAddress("::1", "ipv6");
nonPublicAddresses.addSubnet("fc00::", 7, "ipv6");
nonPublicAddresses.addSubnet("fe80::", 10, "ipv6");
nonPublicAddresses.addSubnet("ff00::", 8, "ipv6");

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function bareHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

function isExplicitLoopback(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  return isIP(host) === 4 && host.startsWith("127.");
}

function isNonPublicAddress(ip: string): boolean {
  try {
    const kind = isIP(ip);
    if (kind === 4) return nonPublicAddresses.check(ip, "ipv4");
    if (kind === 6) return nonPublicAddresses.check(ip, "ipv6");
    return true;
  } catch {
    return true;
  }
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function validateWebhookUrl(raw: string, lookupHost: WebhookLookup = defaultLookup): Promise<WebhookUrlCheck> {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "Webhook URL is empty" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Webhook URL is invalid" };
  }
  if (url.username || url.password) return { ok: false, reason: "Webhook URL cannot include credentials" };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Webhook URL is invalid" };
  const host = bareHostname(url.hostname);
  if (!host) return { ok: false, reason: "Webhook URL is invalid" };
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "Webhook URL must not target a private, loopback, or link-local address" };
  if (isExplicitLoopback(host)) return { ok: true, url };
  if (url.protocol === "http:") return { ok: false, reason: "Webhook URL must use https, or http on localhost, ::1, or 127.0.0.1" };
  if (isIP(host)) {
    if (isNonPublicAddress(host)) return { ok: false, reason: "Webhook URL must not target a private, loopback, or link-local address" };
    return { ok: true, url };
  }
  let addresses: string[] = [];
  try {
    addresses = await lookupHost(host);
  } catch {
    return { ok: false, reason: "Webhook host could not be resolved" };
  }
  if (!addresses.length) return { ok: false, reason: "Webhook host could not be resolved" };
  if (addresses.some((address) => isNonPublicAddress(address))) {
    return { ok: false, reason: "Webhook host resolves to a private, loopback, or link-local address" };
  }
  return { ok: true, url };
}

function envelope<TData>(profileId: string, event: WebhookEventName, data: TData): WebhookEnvelope<TData> {
  return {
    event,
    timestamp: new Date().toISOString(),
    profileId,
    data
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function deliverWebhook(input: {
  url: string;
  secret: string;
  token?: string;
  payload: WebhookEnvelope<unknown>;
  fetchImpl?: typeof fetch;
  lookup?: WebhookLookup;
}): Promise<WebhookTestResult> {
  const check = await validateWebhookUrl(input.url, input.lookup ?? defaultLookup);
  if (!check.ok) return { ok: false, status: null, error: check.reason, attempts: 0 };
  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Foucusly-Webhooks/1",
    [WEBHOOK_EVENT_HEADER]: input.payload.event
  };
  if (input.secret.length > 0) headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookBody(input.secret, body);
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  const once = async (): Promise<{ status: number | null; error: string | null; retryable: boolean }> => {
    try {
      const response = await fetchImpl(check.url.href, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
      });
      if (response.body) {
        try { await response.body.cancel(); } catch { /* unread response body */ }
      }
      if (response.status >= 200 && response.status < 300) return { status: response.status, error: null, retryable: false };
      if (response.status >= 300 && response.status < 400) {
        return { status: response.status, error: `Webhook redirect was not followed (${response.status})`, retryable: false };
      }
      if (response.status >= 500) return { status: response.status, error: `Webhook responded ${response.status}`, retryable: true };
      return { status: response.status, error: `Webhook responded ${response.status}`, retryable: false };
    } catch (error) {
      return { status: null, error: isTimeout(error) ? "Webhook timed out" : "Webhook request failed", retryable: true };
    }
  };

  let last = await once();
  let attempts = 1;
  if (last.retryable) {
    last = await once();
    attempts = 2;
  }
  return { ok: last.error === null, status: last.status, error: last.error, attempts };
}

function rememberWebhookError(db: AppDatabase, profileId: string, error: string | null): void {
  const message = (error ?? "").slice(0, 500);
  try {
    const latest = readSettings(db, profileId);
    if (latest.webhookLastError === message) return;
    writeSettings(db, profileId, { ...latest, webhookLastError: message });
  } catch (cause) {
    console.error("[webhooks] could not store the last delivery error", cause instanceof Error ? cause.message : cause);
  }
}

async function emitOne(db: AppDatabase, profileId: string, event: WebhookEvent, data: SessionFinishedWebhookData | TaskCompletedWebhookData): Promise<void> {
  const settings = readSettings(db, profileId);
  if (!settings.webhookEnabled || settings.webhookUrl.trim() === "" || !settings.webhookEvents.includes(event)) return;
  const result = await deliverWebhook({
    url: settings.webhookUrl,
    secret: settings.webhookSecret,
    token: settings.webhookToken,
    payload: envelope(profileId, event, data)
  });
  if (!result.ok) console.error(`[webhooks] ${event} failed: ${result.error ?? "unknown error"}`);
  rememberWebhookError(db, profileId, result.ok ? null : result.error);
}

async function deliverProfileEvents(db: AppDatabase, profileId: string, events: OutboundWebhook[]): Promise<void> {
  try {
    for (const item of events) await emitOne(db, profileId, item.event, item.data);
  } catch (error) {
    console.error("[webhooks] unexpected emitter failure", error instanceof Error ? error.message : error);
  }
}

/** Fire-and-forget. Domain writes must already be committed; this never rejects. */
export function scheduleProfileWebhooks(db: AppDatabase, profileId: string, events: OutboundWebhook[]): void {
  if (!events.length) return;
  void deliverProfileEvents(db, profileId, events).catch((error: unknown) => {
    console.error("[webhooks] unexpected emitter failure", error instanceof Error ? error.message : error);
  });
}

/** 1-based count of focus sessions this profile finished on the same UTC day, up to this one. */
export function focusRoundFor(db: AppDatabase, profileId: string, endedAt: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE profile_id = ? AND mode = 'pomodoro' AND substr(ended_at,1,10) = substr(?,1,10) AND ended_at <= ?")
    .get(profileId, endedAt, endedAt) as { n: number };
  return Math.max(1, row.n);
}

export function lookupProjectName(db: AppDatabase, profileId: string, projectId: string | null): string | null {
  if (!projectId) return null;
  const row = db.prepare("SELECT name FROM projects WHERE id = ? AND profile_id = ?").get(projectId, profileId) as { name: string } | undefined;
  return row?.name ?? null;
}

/** Explicit ping. It does not require webhookEnabled or a listed event; it does require a valid URL. */
export async function runWebhookTest(
  db: AppDatabase,
  profileId: string,
  input: { webhookUrl?: string; webhookSecret?: string; webhookToken?: string } = {}
): Promise<{ statusCode: number; body: WebhookTestResult | { error: string } }> {
  const settings = readSettings(db, profileId);
  const url = input.webhookUrl !== undefined ? input.webhookUrl : settings.webhookUrl;
  const secret = input.webhookSecret !== undefined ? input.webhookSecret : settings.webhookSecret;
  const token = input.webhookToken !== undefined ? input.webhookToken : settings.webhookToken;
  if (!url.trim()) {
    const error = "Add a webhook URL before testing";
    rememberWebhookError(db, profileId, error);
    return { statusCode: 400, body: { error } };
  }
  const payload: WebhookEnvelope<WebhookPingData> = envelope(profileId, "ping", { message: "ping" });
  const result = await deliverWebhook({ url, secret, token, payload });
  rememberWebhookError(db, profileId, result.ok ? null : result.error);
  if (result.attempts === 0) return { statusCode: 400, body: { error: result.error ?? "Webhook URL is invalid" } };
  return { statusCode: 200, body: result };
}
