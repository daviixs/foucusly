import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChartLineUp, Folder, ListChecks, Trophy, X } from "@phosphor-icons/react";
import type { DetailedSession, RankingEntry, ReportData, ReportPeriod } from "@foucusly/contracts";
import { api } from "../api";

interface Props { onClose: () => void; }
type ReportView = "Summary" | "Detail" | "Ranking";
const periods: Array<{ key: ReportPeriod; label: string }> = [
  { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }
];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const durationText = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

function periodLabel(period: ReportPeriod, date: string, report: ReportData | null) {
  const selected = new Date(`${date}T12:00:00`);
  if (period === "day") return selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    Promise.all([api.report(period, date), api.reportDetail(period, date), api.reportRanking(period, date, rankingBy)])
      .then(([summary, detail, ranked]) => {
        if (!alive) return;
        setReport(summary); setSessions(detail.sessions); setRanking(ranked.entries);
      })
      .catch((reason: Error) => { if (alive) setError(reason.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, date, rankingBy]);

  const max = Math.max(1, ...(report?.timeline.map((item) => item.focusSeconds) ?? [0]));
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <header className="dialog-header"><div><span className="dialog-eyebrow">YOUR PROGRESS</span><h2 id="report-title">Report</h2></div><button className="dialog-close" aria-label="Close report" onClick={onClose}><X size={20} /></button></header>
      <div className="report-top-tabs" role="tablist" aria-label="Report view">
        {(["Summary", "Detail", "Ranking"] as ReportView[]).map((item) => <button role="tab" aria-selected={view === item} key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
      </div>
      <div className="report-content">
        <div className="report-period-row"><div className="report-period-tabs">{periods.map((item) => <button key={item.key} className={period === item.key ? "selected" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
          <div className="date-arrows"><button aria-label="Previous period" onClick={() => setDate(shiftPeriod(date, period, -1))}><ArrowLeft size={16} /></button><span>{periodLabel(period, date, report)}</span><button aria-label="Next period" onClick={() => setDate(shiftPeriod(date, period, 1))}><ArrowRight size={16} /></button></div>
        </div>
        {error ? <div className="report-error" role="alert">{error}</div> : loading ? <div className="report-loading">Loading report…</div> : <>
          {view === "Summary" && report && <>
            <div className="report-stats"><article><span>Hours focused</span><strong>{durationText(report.focusSeconds)}</strong></article><article><span>Days accessed</span><strong>{report.activeDays}</strong></article><article><span>Day streak</span><strong>{report.currentStreak}</strong></article></div>
            <div className={`report-chart report-chart-${period}`} aria-label="Focus time chart">{report.timeline.map((item) => <div className="chart-column" key={item.key} title={`${item.label}: ${durationText(item.focusSeconds)}`}><span className="chart-value">{item.focusSeconds ? `${Math.round(item.focusSeconds / 60)}m` : ""}</span><div className="chart-track"><i style={{ height: `${Math.max(item.focusSeconds ? 4 : 0, (item.focusSeconds / max) * 100)}%` }} /></div><small>{item.label}</small></div>)}</div>
            <div className="report-projects"><div><span>PROJECT</span><span>TIME (HH:MM)</span></div>{report.projects.length ? report.projects.map((project) => <p key={project.projectId ?? "unassigned"}><span>{project.projectName}</span><strong>{durationText(project.focusSeconds)}</strong></p>) : <p><span>No focus sessions in this period.</span><strong>0h 0m</strong></p>}</div>
          </>}
          {view === "Detail" && <div className="report-detail"><h3>Focus sessions</h3>{sessions.length ? sessions.map((session) => <div className="session-row session-detail-row" key={session.id}><span><ChartLineUp size={15} /><span><b>{session.taskTitle ?? "Focus session"}</b><small>{new Date(session.endedAt).toLocaleString()} · {session.projectName}</small></span></span><strong>{durationText(session.durationSeconds)}</strong></div>) : <p>No completed focus sessions in this period.</p>}</div>}
          {view === "Ranking" && <div className="report-ranking"><div className="report-ranking-tabs" role="tablist" aria-label="Rank by"><button role="tab" aria-selected={rankingBy === "project"} className={rankingBy === "project" ? "active" : ""} onClick={() => setRankingBy("project")}><Folder size={14} /> Projects</button><button role="tab" aria-selected={rankingBy === "task"} className={rankingBy === "task" ? "active" : ""} onClick={() => setRankingBy("task")}><ListChecks size={14} /> Tasks</button></div>
            {ranking.length ? <ol>{ranking.map((entry) => <li key={`${entry.id ?? "none"}-${entry.projectId ?? "none"}`}><span className="ranking-position"><Trophy size={14} /> {entry.rank}</span><span className="ranking-name">{entry.name}{rankingBy === "task" && entry.projectId && report?.projects.find((item) => item.projectId === entry.projectId) && <small>{report.projects.find((item) => item.projectId === entry.projectId)?.projectName}</small>}</span><strong>{durationText(entry.focusSeconds)}</strong></li>)}</ol> : <p className="report-empty">No completed focus sessions in this period.</p>}
          </div>}
        </>}
        <p className="report-note">Your report is stored on this device and available without signing in.</p>
      </div>
    </section>
  </div>;
}
