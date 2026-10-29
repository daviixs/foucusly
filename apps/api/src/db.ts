import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_SETTINGS,
  durationForMode,
  type BootstrapData,
  type Profile,
  type Project,
  type Settings,
  type TimerState,
} from "@foucusly/contracts";

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
  currentSessionProjectId: null,
});

function ensureColumn(db: DatabaseType, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateSingletonTable(db: DatabaseType, table: "settings" | "timer") {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.length || columns.some((item) => item.name === "profile_id")) return;
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy;
    CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT UNIQUE, value TEXT NOT NULL);
    INSERT INTO ${table} (id, value) SELECT id, value FROM ${table}_legacy;
    DROP TABLE ${table}_legacy;`);
}

export function createDatabase(path = process.env.DATABASE_PATH ?? "data/foucusly.sqlite"): DatabaseType {
  const resolved = path === ":memory:" ? path : resolve(path);
  mkdirSync(resolved === path ? "." : dirname(resolved), { recursive: true });
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
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
  migrateSingletonTable(db, "settings");
  migrateSingletonTable(db, "timer");
  for (const table of ["projects", "tasks", "sessions", "settings", "timer"] as const) {
    ensureColumn(db, table, "profile_id", "TEXT");
  }
  ensureColumn(db, "tasks", "project_id", "TEXT");
  ensureColumn(db, "sessions", "task_title", "TEXT");
  ensureColumn(db, "sessions", "project_id", "TEXT");
  ensureColumn(db, "projects", "color", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_reminders (
      profile_id TEXT NOT NULL,
      ends_at INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, ends_at)
    );
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.exec("CREATE INDEX IF NOT EXISTS sessions_period_idx ON sessions(mode, ended_at)");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id, ended_at)");
  db.exec("CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS tasks_profile_idx ON tasks(profile_id, sort_order, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS projects_profile_idx ON projects(profile_id, archived_at, name)");
  // Task templates were removed from the product; drop the table left behind by older databases.
  db.exec("DROP INDEX IF EXISTS templates_profile_idx; DROP TABLE IF EXISTS templates");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_profile_idx ON sessions(profile_id, mode, ended_at)");

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

export function listProfiles(db: AppDatabase): Profile[] {
  return db
    .prepare("SELECT id, username, created_at AS createdAt FROM profiles ORDER BY created_at, username COLLATE NOCASE")
    .all() as Profile[];
}

export function createProfile(db: AppDatabase, username: string): Profile {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const create = db.transaction(() => {
    const existing = db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number };
    db.prepare("INSERT INTO profiles (id, username, created_at) VALUES (?, ?, ?)").run(id, username, createdAt);
    if (existing.count === 0) {
      for (const table of ["projects", "tasks", "sessions", "settings", "timer"] as const) {
        db.prepare(`UPDATE ${table} SET profile_id = ? WHERE profile_id IS NULL`).run(id);
      }
    } else {
      db.prepare("INSERT INTO settings (profile_id, value) VALUES (?, ?)").run(id, JSON.stringify(DEFAULT_SETTINGS));
      db.prepare("INSERT INTO timer (profile_id, value) VALUES (?, ?)").run(
        id,
        JSON.stringify(defaultTimer(DEFAULT_SETTINGS)),
      );
    }
  });
  create();
  return { id, username, createdAt };
}

export function findProfile(db: AppDatabase, id: string): Profile | undefined {
  return db.prepare("SELECT id, username, created_at AS createdAt FROM profiles WHERE id = ?").get(id) as
    | Profile
    | undefined;
}

export function deleteProfile(db: AppDatabase, profileId: string): void {
  const del = db.transaction(() => {
    db.prepare("DELETE FROM tasks WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM projects WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM settings WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM timer WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
  });
  del();
}

export function readSettings(db: AppDatabase, profileId: string): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE profile_id = ?").get(profileId) as { value: string };
  // tasksVisible belonged to the removed "Hide tasks" option; drop it so stored settings cannot hide tasks.
  const { tasksVisible: _removed, ...stored } = JSON.parse(row.value) as Partial<Settings> & { tasksVisible?: boolean };
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function writeSettings(db: AppDatabase, profileId: string, settings: Settings) {
  db.prepare(
    "INSERT INTO settings (profile_id, value) VALUES (?, ?) ON CONFLICT(profile_id) DO UPDATE SET value = excluded.value",
  ).run(profileId, JSON.stringify(settings));
}

export function readTimer(db: AppDatabase, profileId: string): TimerState {
  const row = db.prepare("SELECT value FROM timer WHERE profile_id = ?").get(profileId) as { value: string };
  const stored = JSON.parse(row.value) as Partial<TimerState>;
  return {
    ...defaultTimer(readSettings(db, profileId)),
    ...stored,
    currentSessionTaskId: stored.currentSessionTaskId ?? stored.activeTaskId ?? null,
    currentSessionTaskTitle: stored.currentSessionTaskTitle ?? null,
    currentSessionProjectId: stored.currentSessionProjectId ?? null,
  };
}

export function writeTimer(db: AppDatabase, profileId: string, timer: TimerState) {
  db.prepare(
    "INSERT INTO timer (profile_id, value) VALUES (?, ?) ON CONFLICT(profile_id) DO UPDATE SET value = excluded.value",
  ).run(profileId, JSON.stringify(timer));
}

export interface StoredPushSubscription {
  endpoint: string;
  profileId: string;
  subscription: unknown;
  createdAt: string;
}

export function upsertPushSubscription(
  db: AppDatabase,
  profileId: string,
  endpoint: string,
  subscription: string,
): StoredPushSubscription {
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO push_subscriptions (endpoint, profile_id, value, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET profile_id = excluded.profile_id, value = excluded.value",
  ).run(endpoint, profileId, subscription, createdAt);
  return { endpoint, profileId, subscription: JSON.parse(subscription) as unknown, createdAt };
}

export function deletePushSubscription(db: AppDatabase, endpoint: string): boolean {
  return db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes > 0;
}

export function listPushSubscriptions(db: AppDatabase, profileId?: string): StoredPushSubscription[] {
  const rows = profileId
    ? db
        .prepare(
          "SELECT endpoint, profile_id AS profileId, value, created_at AS createdAt FROM push_subscriptions WHERE profile_id = ?",
        )
        .all(profileId)
    : db
        .prepare("SELECT endpoint, profile_id AS profileId, value, created_at AS createdAt FROM push_subscriptions")
        .all();
  return (rows as Array<Omit<StoredPushSubscription, "subscription"> & { value: string }>).map((row) => ({
    endpoint: row.endpoint,
    profileId: row.profileId,
    createdAt: row.createdAt,
    subscription: JSON.parse(row.value) as unknown,
  }));
}

export function countRunningTimers(db: AppDatabase): Array<{ profileId: string; endsAt: number; mode: string }> {
  const rows = db
    .prepare("SELECT profile_id, value FROM timer WHERE value NOT LIKE '%\"running\":false%'")
    .all() as Array<{ profile_id: string; value: string }>;
  const due: Array<{ profileId: string; endsAt: number; mode: string }> = [];
  for (const row of rows) {
    try {
      const timer = JSON.parse(row.value) as { running: boolean; endsAt: number | null; mode: string };
      if (timer.running && typeof timer.endsAt === "number")
        due.push({ profileId: row.profile_id, endsAt: timer.endsAt, mode: timer.mode });
    } catch {
      continue;
    }
  }
  return due;
}

export function reminderSeen(db: AppDatabase, profileId: string, endsAt: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM push_reminders WHERE profile_id = ? AND ends_at = ?").get(profileId, endsAt),
  );
}

export function markReminderSent(db: AppDatabase, profileId: string, endsAt: number): void {
  db.prepare("INSERT OR IGNORE INTO push_reminders (profile_id, ends_at, sent_at) VALUES (?, ?, ?)").run(
    profileId,
    endsAt,
    new Date().toISOString(),
  );
}

export function getConfigValue(db: AppDatabase, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function putConfigValue(db: AppDatabase, key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function readBootstrap(db: AppDatabase, profileId: string): BootstrapData {
  const tasks = db
    .prepare(
      "SELECT id, title, note, estimate_pomos AS estimatePomos, completed_pomos AS completedPomos, completed, sort_order AS sortOrder, created_at AS createdAt, project_id AS projectId FROM tasks WHERE profile_id = ? ORDER BY sort_order, created_at",
    )
    .all(profileId) as Array<Omit<BootstrapData["tasks"][number], "completed"> & { completed: number }>;
  const projects = db
    .prepare(
      "SELECT id, name, created_at AS createdAt, archived_at AS archivedAt, color FROM projects WHERE profile_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .all(profileId) as Project[];
  return {
    profile: findProfile(db, profileId)!,
    tasks: tasks.map((task) => ({ ...task, completed: Boolean(task.completed) })),
    projects,
    settings: readSettings(db, profileId),
    timer: readTimer(db, profileId),
  };
}
