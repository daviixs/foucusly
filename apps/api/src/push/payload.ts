import { advanceReminderCopy, type TimerMode } from "@foucusly/contracts";

export interface PushPayload {
  title: string;
  body: string;
  mode: TimerMode;
  url: string;
}

const stageLabels: Record<TimerMode, { title: string; body: string }> = {
  pomodoro: { title: "Pomodoro finished", body: "Time for a break. Take your eyes off the screen." },
  shortBreak: { title: "Short break finished", body: "Break is over. Ready for another Pomodoro?" },
  longBreak: { title: "Long break finished", body: "Break is over. Ready for another Pomodoro?" }
};

export function buildPushPayload(mode: string, taskTitle?: string | null): PushPayload {
  const stage = mode in stageLabels ? (mode as TimerMode) : "pomodoro";
  const base = stageLabels[stage];
  const body = stage === "pomodoro" && taskTitle ? `${base.body} ${taskTitle} is done.` : base.body;
  return { ...base, body, url: "/app", mode: stage };
}

export function buildAdvancePushPayload(mode: string, remainingMs: number, taskTitle?: string | null): PushPayload {
  const stage = mode in stageLabels ? (mode as TimerMode) : "pomodoro";
  return { ...advanceReminderCopy(stage, remainingMs, taskTitle), url: "/app", mode: stage };
}
