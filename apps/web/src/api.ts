import type { BootstrapData, DetailedSession, Profile, Project, RankingEntry, ReportData, ReportPeriod, Settings, Task, TaskBulkAction, TimerState, WebhookTestResult } from "@foucusly/contracts";

let activeProfileId = "";
/** Base URL of the API. Empty string = same origin (dev uses the Vite proxy for /api). */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

/** Builds an absolute or same-origin URL for an API path such as "/tasks". */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}/api${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(path: string, init?: RequestInit, profileScoped = true): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    // Fastify rejects an empty body declared as JSON, so bodiless POST/DELETE calls must omit the header.
    headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...(profileScoped && activeProfileId ? { "x-profile-id": activeProfileId } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  setActiveProfile: (id: string) => { activeProfileId = id; },
  profiles: () => request<Profile[]>("/profiles", undefined, false),
  createProfile: (username: string) => request<Profile>("/profiles", { method: "POST", body: JSON.stringify({ username }) }, false),
  deleteProfile: (id: string) => request<void>(`/profiles/${id}`, { method: "DELETE", headers: { "x-profile-id": id } }, false),
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
  reportRanking: (period: ReportPeriod, date: string, by: "project" | "task") => request<{ by: "project" | "task"; entries: RankingEntry[] }>(`/reports/ranking?period=${period}&date=${date}&by=${by}`)
};

