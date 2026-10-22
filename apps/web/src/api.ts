import type { BootstrapData, DetailedSession, Profile, Project, RankingEntry, ReportData, ReportPeriod, Settings, Task, TaskTemplate, TimerState } from "@foucusly/contracts";

let activeProfileId = "";

async function request<T>(path: string, init?: RequestInit, profileScoped = true): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(profileScoped && activeProfileId ? { "x-profile-id": activeProfileId } : {}), ...init?.headers }
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
  deleteProfile: (id: string) => request<void>(`/profiles/${id}`, { method: "DELETE" }, false),
  bootstrap: () => request<BootstrapData>("/bootstrap"),
  saveSettings: (settings: Settings) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  saveTimer: (timer: TimerState) => request<TimerState>("/timer", { method: "PUT", body: JSON.stringify(timer) }),
  createTask: (task: Pick<Task, "title" | "note" | "estimatePomos" | "projectId">) => request<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  updateTask: (id: string, patch: Partial<Task>) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  taskAction: (action: "clear-finished" | "clear-all" | "clear-pomos" | "toggle-hidden") => request<BootstrapData>(`/tasks/actions/${action}`, { method: "POST" }),
  createTemplate: (template: Pick<TaskTemplate, "name" | "title" | "note" | "estimatePomos">) => request<TaskTemplate>("/templates", { method: "POST", body: JSON.stringify(template) }),
  useTemplate: (id: string) => request<Task>(`/templates/${id}/use`, { method: "POST" }),
  deleteTemplate: (id: string) => request<void>(`/templates/${id}`, { method: "DELETE" }),
  createProject: (name: string) => request<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  renameProject: (id: string, name: string) => request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  archiveProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  completeSession: (session: { id: string; mode: TimerState["mode"]; startedAt: string; endedAt: string; durationSeconds: number; taskId: string | null; taskTitle: string | null; projectId: string | null }) => request<{ saved: true; duplicate: boolean }>("/sessions", { method: "POST", body: JSON.stringify(session) }),
  report: (period: ReportPeriod, date: string) => request<ReportData>(`/reports?period=${period}&date=${date}`),
  reportDetail: (period: ReportPeriod, date: string) => request<{ sessions: DetailedSession[] }>(`/reports/detail?period=${period}&date=${date}`),
  reportRanking: (period: ReportPeriod, date: string, by: "project" | "task") => request<{ by: "project" | "task"; entries: RankingEntry[] }>(`/reports/ranking?period=${period}&date=${date}&by=${by}`)
};

