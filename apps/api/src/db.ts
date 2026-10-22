import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_SETTINGS, durationForMode, type BootstrapData, type Project, type Settings, type TimerState } from "@foucusly/contracts";

const defaultTimer = (settings: Settings): TimerState => ({
  mode: "pomodoro",
  remainingSeconds: durationForMode(settings, "pomodoro"),
  running: false,
  endsAt: null,
  cyclePomos: 0,
  activeTaskId: null,
  currentSessionId: null,
  sessionStartedAt: null,
  currentSessionTaskId: null,
  currentSessionTaskTitle: null,
  currentSessionProjectId: null
});

function ensureColumn(db: DatabaseType, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function createDatabase(path = process.env.DATABASE_PATH ?? "data/foucusly.sqlite"): DatabaseType {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timer (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      estimate_pomos INTEGER NOT NULL DEFAULT 1,
      completed_pomos INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      project_id TEXT
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      estimate_pomos INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      task_id TEXT,
      task_title TEXT,
      project_id TEXT
    );
  `);
  ensureColumn(db, "tasks", "project_id", "TEXT");
  ensureColumn(db, "sessions", "task_title", "TEXT");
  ensureColumn(db, "sessions", "project_id", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_period_idx ON sessions(mode, ended_at)");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id, ended_at)");
  db.exec("CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id)");

  const settingsRow = db.prepare("SELECT value FROM settings WHERE id = 1").get() as { value: string } | undefined;
  if (!settingsRow) db.prepare("INSERT INTO settings (id, value) VALUES (1, ?)").run(JSON.stringify(DEFAULT_SETTINGS));
  const timerRow = db.prepare("SELECT value FROM timer WHERE id = 1").get() as { value: string } | undefined;
  if (!timerRow) {
    const timer = defaultTimer(DEFAULT_SETTINGS);
    db.prepare("INSERT INTO timer (id, value) VALUES (1, ?)").run(JSON.stringify(timer));
  }
  return db;
}

export type AppDatabase = ReturnType<typeof createDatabase>;

export function readSettings(db: AppDatabase): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE id = 1").get() as { value: string };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } as Settings;
}

export function writeSettings(db: AppDatabase, settings: Settings) {
  db.prepare("INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(settings));
}

export function readTimer(db: AppDatabase): TimerState {
  const row = db.prepare("SELECT value FROM timer WHERE id = 1").get() as { value: string };
  const stored = JSON.parse(row.value) as Partial<TimerState>;
  return {
    ...defaultTimer(readSettings(db)),
    ...stored,
    currentSessionTaskId: stored.currentSessionTaskId ?? stored.activeTaskId ?? null,
    currentSessionTaskTitle: stored.currentSessionTaskTitle ?? null,
    currentSessionProjectId: stored.currentSessionProjectId ?? null
  };
}

export function writeTimer(db: AppDatabase, timer: TimerState) {
  db.prepare("INSERT INTO timer (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(timer));
}

export function readBootstrap(db: AppDatabase): BootstrapData {
  const tasks = db.prepare("SELECT id, title, note, estimate_pomos AS estimatePomos, completed_pomos AS completedPomos, completed, sort_order AS sortOrder, created_at AS createdAt, project_id AS projectId FROM tasks ORDER BY sort_order, created_at")
    .all() as Array<Omit<BootstrapData["tasks"][number], "completed"> & { completed: number }>;
  const projects = db.prepare("SELECT id, name, created_at AS createdAt, archived_at AS archivedAt FROM projects WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE")
    .all() as Project[];
  const templates = db.prepare("SELECT id, name, title, note, estimate_pomos AS estimatePomos, created_at AS createdAt FROM templates ORDER BY created_at")
    .all() as BootstrapData["templates"];
  return {
    tasks: tasks.map((task) => ({ ...task, completed: Boolean(task.completed) })),
    projects,
    templates,
    settings: readSettings(db),
    timer: readTimer(db)
  };
}

