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

