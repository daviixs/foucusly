import type { Project, Task } from "@foucusly/contracts";

export type TaskDraft = Pick<Task, "title" | "note" | "estimatePomos" | "projectId">;
export type OpenProjectManager = (onCreated?: (project: Project) => void) => void;
