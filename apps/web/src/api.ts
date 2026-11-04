import type { BootstrapData, DetailedSession, Profile, Project, RankingBy, RankingEntry, ReportData, ReportPeriod, Settings, Task, TaskBulkAction, TimerState, WebhookTestResult } from "@foucusly/contracts";

const TOKEN_KEY = "focusly-token";
let authToken: string | null = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
let onUnauthorized: (() => void) | null = null;

export function getAuthToken(): string | null { return authToken; }
export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}
/** Called when the API answers 401 for an authenticated request (expired/invalid token). */
export function setUnauthorizedHandler(handler: (() => void) | null): void { onUnauthorized = handler; }

export interface AuthResult { token: string; profile: Profile }
/** Base URL of the API. Empty string = same origin (dev uses the Vite proxy for /api). */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

/** Builds an absolute or same-origin URL for an API path such as "/tasks". */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}/api${path.startsWith("/") ? path : `/${path}`}`;
}

const NETWORK_RETRY_DELAYS_MS = [500, 1500, 3000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** fetch() that retries idempotent GETs on network failures (TypeError); HTTP errors are never retried. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const retries = method === "GET" ? NETWORK_RETRY_DELAYS_MS : [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= retries.length) throw error;
      await sleep(retries[attempt]);
    }
  }
}

async function request<T>(path: string, init?: RequestInit, authenticated = true): Promise<T> {
  const response = await fetchWithRetry(apiUrl(path), {
    ...init,
    // Fastify rejects an empty body declared as JSON, so bodiless POST/DELETE calls must omit the header.
    headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...(authenticated && authToken ? { authorization: `Bearer ${authToken}` } : {}), ...init?.headers }
  });
  if (response.status === 401 && authenticated) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) => request<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, false),
  register: (username: string, password: string) => request<AuthResult>("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }, false),
  deleteProfile: (id: string) => request<void>(`/profiles/${id}`, { method: "DELETE" }),
  bootstrap: () => request<BootstrapData>("/bootstrap"),
  saveSettings: (settings: Settings) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  saveTimer: (timer: TimerState) => request<TimerState>("/timer", { method: "PUT", body: JSON.stringify(timer) }),
  createTask: (task: Pick<Task, "title" | "note" | "estimatePomos" | "projectId">) => request<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  updateTask: (id: string, patch: Partial<Task>) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  reorderTasks: (order: string[]) => request<BootstrapData>("/tasks/reorder", { method: "PUT", body: JSON.stringify({ order }) }),
  taskAction: (action: TaskBulkAction) => request<BootstrapData>(`/tasks/actions/${action}`, { method: "POST" }),
  createProject: (name: string, color: string | null = null) => request<Project>("/projects", { method: "POST", body: JSON.stringify({ name, color }) }),
  updateProject: (id: string, patch: Pick<Project, "color">) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  archivedProjects: () => request<Project[]>("/projects/archived"),
  restoreProject: (id: string) => request<Project>(`/projects/${id}/restore`, { method: "POST" }),
  renameProject: (id: string, name: string) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  archiveProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  addManualSession: (session: { mode?: "pomodoro" | "shortBreak" | "longBreak"; startedAt: string; endedAt: string; taskId?: string | null; taskTitle?: string | null; projectId?: string | null }) => request<{ saved: boolean; session: DetailedSession }>("/sessions/manual", { method: "POST", body: JSON.stringify(session) }),
  updateSession: (id: string, patch: { taskTitle?: string | null; startedAt?: string; endedAt?: string; taskId?: string | null; projectId?: string | null }) => request<DetailedSession>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: "DELETE" }),
  pushPublicKey: () => request<{ publicKey: string }>("/push/public-key"),
  subscribePush: (subscription: string) => request<{ endpoint: string }>("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  unsubscribePush: (endpoint: string) => request<void>("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  testPush: () => request<{ ok: boolean; delivered: number; total: number }>("/push/test", { method: "POST" }),
  testWebhook: (input: { webhookUrl?: string; webhookSecret?: string; webhookToken?: string } = {}) => request<WebhookTestResult>("/webhooks/test", { method: "POST", body: JSON.stringify(input) }),
  completeSession: (session: { id: string; mode: TimerState["mode"]; startedAt: string; endedAt: string; durationSeconds: number; taskId: string | null; taskTitle: string | null; projectId: string | null }) => request<{ saved: true; duplicate: boolean }>("/sessions", { method: "POST", body: JSON.stringify(session) }),
  report: (period: ReportPeriod, date: string) => request<ReportData>(`/reports?period=${period}&date=${date}`),
  reportDetail: (period: ReportPeriod, date: string) => request<{ sessions: DetailedSession[] }>(`/reports/detail?period=${period}&date=${date}`),
  reportRanking: (period: ReportPeriod, date: string, by: RankingBy) => request<{ by: RankingBy; entries: RankingEntry[] }>(`/reports/ranking?period=${period}&date=${date}&by=${by}`)
};

