import type { AppDatabase } from "../db.js";
import { readSettings } from "../db.js";
import type { DetailedSession, ProjectReport, RankingEntry, ReportBucket, ReportData, ReportPeriod, SessionRecord } from "@foucusly/contracts";

export interface ReportQuery { period: ReportPeriod; date: string; }
export type RankingBy = "project" | "task";

interface Bounds { startDate: string; endDate: string; dayCount: number; startUtc: string; endUtc: string; }

const timeZone = () => process.env.APP_TIME_ZONE ?? "America/Sao_Paulo";
const dateFromParts = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const shiftDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const zonedParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: timeZone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
}).formatToParts(date).filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)])) as Record<string, number>;

function zonedMidnightUtc(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = zonedParts(new Date(guess));
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour);
    const adjustment = target - represented;
    if (!adjustment) break;
    guess += adjustment;
  }
  return new Date(guess).toISOString();
}

function boundsFor(db: AppDatabase, { period, date }: ReportQuery): Bounds {
  const [year, month, day] = date.split("-").map(Number);
  const selected = dateFromParts(year, month, day);
  let start = selected;
  let dayCount = 1;
  if (period === "week") {
    const weekStartsOn = readSettings(db).weekStartsOn;
    start = shiftDays(selected, -((selected.getUTCDay() - weekStartsOn + 7) % 7));
    dayCount = 7;
  } else if (period === "month") {
    start = dateFromParts(year, month, 1);
    dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  } else if (period === "year") {
    start = dateFromParts(year, 1, 1);
    dayCount = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  }
  const end = shiftDays(start, dayCount - 1);
  return {
    startDate: dateKey(start), endDate: dateKey(end), dayCount,
    startUtc: zonedMidnightUtc(dateKey(start)),
    endUtc: zonedMidnightUtc(dateKey(shiftDays(end, 1)))
  };
}

function readSessions(db: AppDatabase, bounds: Bounds): SessionRecord[] {
  return db.prepare(`SELECT id, mode, started_at AS startedAt, ended_at AS endedAt,
      duration_seconds AS durationSeconds, task_id AS taskId, task_title AS taskTitle,
      project_id AS projectId
    FROM sessions WHERE mode = 'pomodoro' AND ended_at >= ? AND ended_at < ? ORDER BY ended_at DESC`)
    .all(bounds.startUtc, bounds.endUtc) as SessionRecord[];
}

function localDay(timestamp: string) {
  const parts = zonedParts(new Date(timestamp));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function reportBuckets(period: ReportPeriod, bounds: Bounds): ReportBucket[] {
  if (period === "day") return Array.from({ length: 24 }, (_, hour) => ({
    key: `${bounds.startDate}T${String(hour).padStart(2, "0")}`,
    label: `${String(hour).padStart(2, "0")}:00`, focusSeconds: 0, sessions: 0
  }));
  if (period === "year") return Array.from({ length: 12 }, (_, month) => ({
    key: `${bounds.startDate.slice(0, 4)}-${String(month + 1).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month, 1))),
    focusSeconds: 0, sessions: 0
  }));
  const [startYear, startMonth, startDay] = bounds.startDate.split("-").map(Number);
  const firstDay = dateFromParts(startYear, startMonth, startDay);
  return Array.from({ length: bounds.dayCount }, (_, offset) => {
    const date = dateKey(shiftDays(firstDay, offset));
    const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    return { key: date, label: period === "month" ? String(Number(date.slice(-2))) : weekday, focusSeconds: 0, sessions: 0 };
  });
}

function bucketKey(period: ReportPeriod, timestamp: string) {
  const parts = zonedParts(new Date(timestamp));
  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (period === "day") return `${date}T${String(parts.hour).padStart(2, "0")}`;
  if (period === "year") return date.slice(0, 7);
  return date;
}

function streakDays(db: AppDatabase) {
  const rows = db.prepare("SELECT ended_at AS endedAt FROM sessions WHERE mode='pomodoro'").all() as Array<{ endedAt: string }>;
  const days = new Set(rows.map(({ endedAt }) => localDay(endedAt)));
  const todayParts = zonedParts(new Date());
  let cursor = dateFromParts(todayParts.year, todayParts.month, todayParts.day);
  let streak = 0;
  while (days.has(dateKey(cursor))) { streak++; cursor = shiftDays(cursor, -1); }
  return streak;
}

export function getReportSummary(db: AppDatabase, query: ReportQuery): ReportData {
  const bounds = boundsFor(db, query);
  const sessions = readSessions(db, bounds);
  const timeline = reportBuckets(query.period, bounds);
  const timelineByKey = new Map(timeline.map((bucket) => [bucket.key, bucket]));
  const projects = new Map<string, ProjectReport>();
  for (const session of sessions) {
    const bucket = timelineByKey.get(bucketKey(query.period, session.endedAt));
    if (bucket) { bucket.focusSeconds += session.durationSeconds; bucket.sessions++; }
    const key = session.projectId ?? "__unassigned__";
    const project = projects.get(key) ?? {
      projectId: session.projectId, projectName: session.projectId ? "Archived project" : "No project", focusSeconds: 0, sessions: 0
    };
    project.focusSeconds += session.durationSeconds;
    project.sessions++;
    projects.set(key, project);
  }
  const projectRows = db.prepare("SELECT id, name FROM projects").all() as Array<{ id: string; name: string }>;
  const projectNames = new Map(projectRows.map(({ id, name }) => [id, name]));
  for (const item of projects.values()) if (item.projectId) item.projectName = projectNames.get(item.projectId) ?? item.projectName;
  const focusSeconds = sessions.reduce((sum, item) => sum + item.durationSeconds, 0);
  return {
    period: query.period, startDate: bounds.startDate, endDate: bounds.endDate,
    focusSeconds, focusSessions: sessions.length,
    activeDays: new Set(sessions.map((session) => localDay(session.endedAt))).size,
    currentStreak: streakDays(db), timeline,
    projects: [...projects.values()].sort((a, b) => b.focusSeconds - a.focusSeconds || a.projectName.localeCompare(b.projectName))
  };
}

export function getReportDetail(db: AppDatabase, query: ReportQuery): DetailedSession[] {
  const bounds = boundsFor(db, query);
  return db.prepare(`SELECT s.id, s.mode, s.started_at AS startedAt, s.ended_at AS endedAt,
      s.duration_seconds AS durationSeconds, s.task_id AS taskId,
      COALESCE(s.task_title, t.title) AS taskTitle, s.project_id AS projectId,
      COALESCE(p.name, CASE WHEN s.project_id IS NULL THEN 'No project' ELSE 'Archived project' END) AS projectName
    FROM sessions s LEFT JOIN tasks t ON t.id=s.task_id LEFT JOIN projects p ON p.id=s.project_id
    WHERE s.mode='pomodoro' AND s.ended_at >= ? AND s.ended_at < ? ORDER BY s.ended_at DESC`)
    .all(bounds.startUtc, bounds.endUtc) as DetailedSession[];
}

export function getReportRanking(db: AppDatabase, query: ReportQuery, by: RankingBy): RankingEntry[] {
  const sessions = readSessions(db, boundsFor(db, query));
  const projectNames = new Map((db.prepare("SELECT id, name FROM projects").all() as Array<{ id: string; name: string }>).map(({ id, name }) => [id, name]));
  const grouped = new Map<string, RankingEntry>();
  for (const session of sessions) {
    if (by === "task" && !session.taskId) continue;
    const id = by === "project" ? session.projectId : session.taskId;
    const key = id ?? "__unassigned__";
    const name = by === "project"
      ? (id ? projectNames.get(id) ?? "Archived project" : "No project")
      : session.taskTitle ?? "Untitled task";
    const entry = grouped.get(key) ?? { rank: 0, id, name, projectId: by === "task" ? session.projectId : null, focusSeconds: 0, sessions: 0 };
    entry.focusSeconds += session.durationSeconds;
    entry.sessions++;
    grouped.set(key, entry);
  }
  return [...grouped.values()]
    .sort((a, b) => b.focusSeconds - a.focusSeconds || a.name.localeCompare(b.name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

