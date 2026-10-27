export type TimerMode = "pomodoro" | "shortBreak" | "longBreak";
export type ThemeColor = "red" | "teal" | "blue" | "green" | "purple";
export type ReportPeriod = "day" | "week" | "month" | "year";

export interface Task {
  id: string;
  title: string;
  note: string;
  estimatePomos: number;
  completedPomos: number;
  completed: boolean;
  sortOrder: number;
  createdAt: string;
  projectId: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  color: string | null;
}

export interface Profile {
  id: string;
  username: string;
  createdAt: string;
}

export const TASK_BULK_ACTIONS = ["clear-finished", "clear-pomos", "clear-all"] as const;
export type TaskBulkAction = typeof TASK_BULK_ACTIONS[number];

export interface Settings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartPomodoros: boolean;
  autoCheckTasks: boolean;
  checkToBottom: boolean;
  alarmSound: string;
  alarmVolume: number;
  alarmRepeat: number;
  focusSound: string;
  focusVolume: number;
  themeColor: ThemeColor;
  hourFormat: "12-hour" | "24-hour";
  darkModeWhenRunning: boolean;
  autoDarkAtNight: boolean;
  notificationReminderMinutes: number;
  weekStartsOn: 0 | 1;
}

export interface TimerState {
  mode: TimerMode;
  remainingSeconds: number;
  running: boolean;
  endsAt: number | null;
  cyclePomos: number;
  activeTaskId: string | null;
  currentSessionId: string | null;
  sessionStartedAt: string | null;
  currentSessionTaskId: string | null;
  currentSessionTaskTitle: string | null;
  currentSessionProjectId: string | null;
}

export interface SessionRecord {
  id: string;
  mode: TimerMode;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
}

export interface BootstrapData {
  profile: Profile;
  tasks: Task[];
  projects: Project[];
  settings: Settings;
  timer: TimerState;
}

export interface ReportBucket {
  key: string;
  label: string;
  focusSeconds: number;
  sessions: number;
}

export interface ReportData {
  period: ReportPeriod;
  startDate: string;
  endDate: string;
  focusSeconds: number;
  focusSessions: number;
  activeDays: number;
  currentStreak: number;
  timeline: ReportBucket[];
  projects: ProjectReport[];
}

export interface ProjectReport {
  projectId: string | null;
  projectName: string;
  focusSeconds: number;
  sessions: number;
}

export interface DetailedSession extends SessionRecord {
  projectName: string;
}

export interface RankingEntry {
  rank: number;
  id: string | null;
  name: string;
  projectId: string | null;
  focusSeconds: number;
  sessions: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartPomodoros: false,
  autoCheckTasks: false,
  checkToBottom: false,
  alarmSound: "Kitchen",
  alarmVolume: 50,
  alarmRepeat: 1,
  focusSound: "None",
  focusVolume: 50,
  themeColor: "red",
  hourFormat: "24-hour",
  darkModeWhenRunning: false,
  autoDarkAtNight: false,
  notificationReminderMinutes: 0,
  weekStartsOn: 1
};

export function durationForMode(settings: Settings, mode: TimerMode): number {
  const minutes = mode === "pomodoro"
    ? settings.pomodoroMinutes
    : mode === "shortBreak"
      ? settings.shortBreakMinutes
      : settings.longBreakMinutes;
  return Math.max(1, minutes) * 60;
}

/** Skip the advance reminder this close to endsAt; the completion alert covers that moment. */
export const ADVANCE_REMINDER_MIN_REMAINING_MS = 15_000;

export function advanceReminderCopy(mode: TimerMode | string, remainingMs: number, taskTitle?: string | null): { title: string; body: string } {
  const stage: TimerMode = mode === "shortBreak" || mode === "longBreak" ? mode : "pomodoro";
  const title = stage === "pomodoro" ? "Focus ending soon" : stage === "shortBreak" ? "Short break ending soon" : "Long break ending soon";
  const remaining = Math.max(0, remainingMs);
  const lead = remaining >= 60_000 ? `${Math.ceil(remaining / 60_000)} min left` : "Less than a minute left";
  const body = stage === "pomodoro" && taskTitle ? `${lead} on ${taskTitle}.` : `${lead}.`;
  return { title, body };
}

export const NIGHT_STARTS_AT_HOUR = 18;
export const NIGHT_ENDS_AT_HOUR = 6;

/** Night is evaluated in the browser's local time zone. */
export function isNightTime(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_STARTS_AT_HOUR || hour < NIGHT_ENDS_AT_HOUR;
}
