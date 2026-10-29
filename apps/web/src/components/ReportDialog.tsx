import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChartLineUp,
  Folder,
  ListChecks,
  NotePencil,
  PlusCircle,
  Trash,
  Trophy,
  X,
} from "@phosphor-icons/react";
import type { DetailedSession, RankingEntry, ReportData, ReportPeriod } from "@foucusly/contracts";
import { api } from "../api";

interface Props {
  onClose: () => void;
}
type ReportView = "Summary" | "Detail" | "Ranking";
const periods: Array<{ key: ReportPeriod; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const durationText = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

function periodLabel(period: ReportPeriod, date: string, report: ReportData | null) {
  const selected = new Date(`${date}T12:00:00`);
  if (period === "day")
    return selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (period === "month") return selected.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (period === "year") return String(selected.getFullYear());
  return report ? `${report.startDate} — ${report.endDate}` : "Selected week";
}

function shiftPeriod(date: string, period: ReportPeriod, amount: number) {
  const result = new Date(`${date}T12:00:00`);
  if (period === "day") result.setDate(result.getDate() + amount);
  else if (period === "week") result.setDate(result.getDate() + amount * 7);
  else {
    const preferredDay = result.getDate();
    result.setDate(1);
    if (period === "month") result.setMonth(result.getMonth() + amount);
    else result.setFullYear(result.getFullYear() + amount);
    result.setDate(Math.min(preferredDay, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  }
  return dateKey(result);
}

function ManualSessionForm({ onDone, onError }: { onDone: () => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dateKey(new Date()));
  const [start, setStart] = useState("09:00");
  const [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const startedAt = new Date(`${date}T${start}`).toISOString();
      const endedAt = new Date(new Date(`${date}T${start}`).getTime() + Math.max(1, minutes) * 60_000).toISOString();
      await api.addManualSession({ mode: "pomodoro", startedAt, endedAt, taskTitle: title.trim() || null });
      onDone();
    } catch (reason) {
      onError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="manual-session-form" onSubmit={submit}>
      <button type="button" className="dialog-close" aria-label="Close" onClick={onDone}>
        <X size={18} />
      </button>
      <h3>Add focus time</h3>
      <p className="manual-hint">Studied or worked offline? Register a past Pomodoro session.</p>
      <div className="manual-grid">
        <label>
          Title
          <input
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Focus session (optional)"
          />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Start
          <input type="time" value={start} onChange={(event) => setStart(event.target.value)} required />
        </label>
        <label>
          Minutes
          <input
            type="number"
            min={1}
            max={180}
            value={minutes}
            onChange={(event) => setMinutes(Math.min(180, Math.max(1, Number(event.target.value) || 1)))}
          />
        </label>
      </div>
      <button type="submit" className="button-dark" disabled={busy}>
        {busy ? "Saving…" : "Save session"}
      </button>
    </form>
  );
}

export function ReportDialog({ onClose }: Props) {
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [date, setDate] = useState(dateKey(new Date()));
  const [view, setView] = useState<ReportView>("Summary");
  const [rankingBy, setRankingBy] = useState<"project" | "task">("project");
  const [report, setReport] = useState<ReportData | null>(null);
  const [sessions, setSessions] = useState<DetailedSession[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMinutes, setEditMinutes] = useState(25);
  const [manualOpen, setManualOpen] = useState(false);
  const [rowError, setRowError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([api.report(period, date), api.reportDetail(period, date), api.reportRanking(period, date, rankingBy)])
      .then(([summary, detail, ranked]) => {
        if (!alive) return;
        setReport(summary);
        setSessions(detail.sessions);
        setRanking(ranked.entries);
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [period, date, rankingBy, reload]);

  const startEdit = (session: DetailedSession) => {
    setEditingId(session.id);
    setEditTitle(session.taskTitle ?? "");
    setEditMinutes(Math.max(1, Math.round(session.durationSeconds / 60)));
    setRowError("");
  };

  const saveEdit = async (session: DetailedSession) => {
    try {
      const durationSeconds = Math.min(10800, Math.max(60, editMinutes * 60));
      const startedAt = new Date(new Date(session.endedAt).getTime() - durationSeconds * 1000).toISOString();
      await api.updateSession(session.id, { taskTitle: editTitle.trim() || null, startedAt });
      setEditingId(null);
      setReload((value) => value + 1);
    } catch (reason) {
      setRowError((reason as Error).message);
    }
  };

  const removeSession = async (session: DetailedSession) => {
    try {
      await api.deleteSession(session.id);
      setReload((value) => value + 1);
    } catch (reason) {
      setRowError((reason as Error).message);
    }
  };

  const max = Math.max(1, ...(report?.timeline.map((item) => item.focusSeconds) ?? [0]));
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="report-dialog section-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        aria-describedby="report-description"
      >
        <header className="section-dialog-header">
          <button className="dialog-close" aria-label="Close report" onClick={onClose}>
            <X size={20} />
          </button>
          <span className="section-dialog-icon">
            <ChartLineUp size={25} weight="duotone" />
          </span>
          <span className="dialog-eyebrow">YOUR PROGRESS</span>
          <h2 id="report-title">Report</h2>
          <p id="report-description">See how your focus time adds up.</p>
        </header>
        <div className="report-top-tabs" role="tablist" aria-label="Report view">
          {(["Summary", "Detail", "Ranking"] as ReportView[]).map((item) => (
            <button
              role="tab"
              aria-selected={view === item}
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="report-content">
          <div className="report-period-row">
            <div className="report-period-tabs">
              {periods.map((item) => (
                <button
                  key={item.key}
                  className={period === item.key ? "selected" : ""}
                  onClick={() => setPeriod(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="date-arrows">
              <button aria-label="Previous period" onClick={() => setDate(shiftPeriod(date, period, -1))}>
                <ArrowLeft size={16} />
              </button>
              <span>{periodLabel(period, date, report)}</span>
              <button aria-label="Next period" onClick={() => setDate(shiftPeriod(date, period, 1))}>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          {error ? (
            <div className="report-error" role="alert">
              {error}
            </div>
          ) : loading ? (
            <div className="report-loading">Loading report…</div>
          ) : (
            <>
              {view === "Summary" && report && (
                <>
                  <div className="report-stats">
                    <article>
                      <span>Hours focused</span>
                      <strong>{durationText(report.focusSeconds)}</strong>
                    </article>
                    <article>
                      <span>Days accessed</span>
                      <strong>{report.activeDays}</strong>
                    </article>
                    <article>
                      <span>Day streak</span>
                      <strong>{report.currentStreak}</strong>
                    </article>
                  </div>
                  <div className={`report-chart report-chart-${period}`} aria-label="Focus time chart">
                    {report.timeline.map((item) => (
                      <div
                        className="chart-column"
                        key={item.key}
                        title={`${item.label}: ${durationText(item.focusSeconds)}`}
                      >
                        <span className="chart-value">
                          {item.focusSeconds ? `${Math.round(item.focusSeconds / 60)}m` : ""}
                        </span>
                        <div className="chart-track">
                          <i
                            style={{
                              height: `${Math.max(item.focusSeconds ? 4 : 0, (item.focusSeconds / max) * 100)}%`,
                            }}
                          />
                        </div>
                        <small>{item.label}</small>
                      </div>
                    ))}
                  </div>
                  <div className="report-projects">
                    <div>
                      <span>PROJECT</span>
                      <span>TIME (HH:MM)</span>
                    </div>
                    {report.projects.length ? (
                      report.projects.map((project) => (
                        <p key={project.projectId ?? "unassigned"}>
                          <span>{project.projectName}</span>
                          <strong>{durationText(project.focusSeconds)}</strong>
                        </p>
                      ))
                    ) : (
                      <p>
                        <span>No focus sessions in this period.</span>
                        <strong>0h 0m</strong>
                      </p>
                    )}
                  </div>
                </>
              )}
              {view === "Detail" && (
                <>
                  <div className="report-detail-head">
                    <h3>Focus sessions</h3>
                    {manualOpen ? null : (
                      <button
                        className="manual-add-button"
                        onClick={() => {
                          setManualOpen(true);
                          setRowError("");
                        }}
                      >
                        <PlusCircle size={16} /> Add focus time
                      </button>
                    )}
                  </div>
                  {manualOpen && (
                    <ManualSessionForm
                      onDone={() => {
                        setManualOpen(false);
                        setReload((value) => value + 1);
                      }}
                      onError={setRowError}
                    />
                  )}
                  {rowError && (
                    <div className="report-error" role="alert">
                      {rowError}
                    </div>
                  )}
                  <div className="report-detail">
                    {sessions.length ? (
                      sessions.map((session) =>
                        editingId === session.id ? (
                          <form
                            className="session-row session-edit-row"
                            key={session.id}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveEdit(session);
                            }}
                          >
                            <input
                              aria-label={`Edit title of session ${session.id}`}
                              maxLength={200}
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                              placeholder="Focus session (optional)"
                            />
                            <input
                              aria-label="Edit duration in minutes"
                              type="number"
                              min={1}
                              max={180}
                              value={editMinutes}
                              onChange={(event) =>
                                setEditMinutes(Math.min(180, Math.max(1, Number(event.target.value) || 1)))
                              }
                            />
                            <button
                              type="submit"
                              className="button-dark"
                              aria-label={`Save edits to session ${session.id}`}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel edits to session {session.id}"
                              onClick={() => setEditingId(null)}
                            >
                              <X size={15} />
                            </button>
                          </form>
                        ) : (
                          <div className="session-row session-detail-row" key={session.id}>
                            <span>
                              <ChartLineUp size={15} />
                              <span>
                                <b>{session.taskTitle ?? "Focus session"}</b>
                                <small>
                                  {new Date(session.endedAt).toLocaleString()} · {session.projectName}
                                </small>
                              </span>
                            </span>
                            <span className="session-detail-actions">
                              <strong>{durationText(session.durationSeconds)}</strong>
                              <button
                                aria-label={`Edit session ${session.id}`}
                                title="Edit session"
                                onClick={() => startEdit(session)}
                              >
                                <NotePencil size={14} />
                              </button>
                              <button
                                aria-label={`Delete session ${session.id}`}
                                title="Delete session"
                                onClick={() => {
                                  void removeSession(session);
                                }}
                              >
                                <Trash size={14} />
                              </button>
                            </span>
                          </div>
                        ),
                      )
                    ) : (
                      <p>No completed focus sessions in this period.</p>
                    )}
                  </div>
                </>
              )}
              {view === "Ranking" && (
                <div className="report-ranking">
                  <div className="report-ranking-tabs" role="tablist" aria-label="Rank by">
                    <button
                      role="tab"
                      aria-selected={rankingBy === "project"}
                      className={rankingBy === "project" ? "active" : ""}
                      onClick={() => setRankingBy("project")}
                    >
                      <Folder size={14} /> Projects
                    </button>
                    <button
                      role="tab"
                      aria-selected={rankingBy === "task"}
                      className={rankingBy === "task" ? "active" : ""}
                      onClick={() => setRankingBy("task")}
                    >
                      <ListChecks size={14} /> Tasks
                    </button>
                  </div>
                  {ranking.length ? (
                    <ol>
                      {ranking.map((entry) => (
                        <li key={`${entry.id ?? "none"}-${entry.projectId ?? "none"}`}>
                          <span className="ranking-position">
                            <Trophy size={14} /> {entry.rank}
                          </span>
                          <span className="ranking-name">
                            {entry.name}
                            {rankingBy === "task" &&
                              entry.projectId &&
                              report?.projects.find((item) => item.projectId === entry.projectId) && (
                                <small>
                                  {report.projects.find((item) => item.projectId === entry.projectId)?.projectName}
                                </small>
                              )}
                          </span>
                          <strong>{durationText(entry.focusSeconds)}</strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="report-empty">No completed focus sessions in this period.</p>
                  )}
                </div>
              )}
            </>
          )}
          <p className="report-note">Your report is stored on this device and available without signing in.</p>
        </div>
      </section>
    </div>
  );
}
