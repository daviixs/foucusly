import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChartLineUp, LockKey, X } from "@phosphor-icons/react";
import type { ReportData, ReportPeriod } from "@pomofocus/contracts";
import { api } from "../api";

interface Props { onClose: () => void; onToast: (message: string) => void; }
const periods: Array<{ key: ReportPeriod; label: string }> = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const minutesText = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;

export function ReportDialog({ onClose, onToast }: Props) {
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [date, setDate] = useState(dateKey(new Date()));
  const [view, setView] = useState<"Summary" | "Detail">("Summary");
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; setError(""); api.report(period, date).then((data) => { if (alive) setReport(data); }).catch((reason: Error) => { if (alive) setError(reason.message); }); return () => { alive = false; }; }, [period, date]);
  const moveDate = (direction: number) => {
    const current = new Date(`${date}T12:00:00`);
    const step = period === "day" ? 1 : period === "week" ? 7 : period === "month" ? 30 : 365;
    current.setDate(current.getDate() + direction * step);
    setDate(dateKey(current));
  };
  const max = Math.max(1, ...(report?.daily.map((item) => item.focusSeconds) ?? [0]));
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <header className="dialog-header"><div><span className="dialog-eyebrow">YOUR PROGRESS</span><h2 id="report-title">Report</h2></div><button className="dialog-close" aria-label="Close report" onClick={onClose}><X size={20} /></button></header>
      <div className="report-top-tabs"><button className={view === "Summary" ? "active" : ""} onClick={() => setView("Summary")}>Summary</button><button className={view === "Detail" ? "active" : ""} onClick={() => setView("Detail")}>Detail</button></div>
      <div className="report-content">
        <div className="report-subtabs"><button className="active">Activity</button><button onClick={() => onToast("Ranking is available when signed in.")}>Ranking <LockKey size={12} /></button><span>Summary</span></div>
        <div className="report-stats"><article><span>Hours focused</span><strong>{report ? minutesText(report.focusSeconds) : "—"}</strong></article><article><span>Days accessed</span><strong>{report?.activeDays ?? "—"}</strong></article><article><span>Day streak</span><strong>{report?.currentStreak ?? "—"}</strong></article></div>
        <div className="report-period-row"><div className="report-period-tabs">{periods.map((item) => <button key={item.key} className={period === item.key ? "selected" : ""} disabled={item.key === "year"} onClick={() => setPeriod(item.key)}>{item.label}{item.key === "year" && <LockKey size={11} />}</button>)}</div>
          <div className="date-arrows"><button aria-label="Previous period" onClick={() => moveDate(-1)}><ArrowLeft size={16} /></button><span>{period === "day" ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : period === "month" ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : period === "week" && report ? `${report.startDate} — ${report.endDate}` : new Date(`${date}T12:00:00`).getFullYear()}</span><button aria-label="Next period" onClick={() => moveDate(1)}><ArrowRight size={16} /></button></div>
        </div>
        {error ? <div className="report-error">{error}</div> : <div className="report-chart" aria-label="Focus hours chart">{(report?.daily ?? []).map((item) => <div className="chart-column" key={item.date} title={`${item.date}: ${minutesText(item.focusSeconds)}`}><span className="chart-value">{item.focusSeconds ? `${Math.round(item.focusSeconds / 60)}m` : ""}</span><div className="chart-track"><i style={{ height: `${Math.max(item.focusSeconds ? 4 : 0, (item.focusSeconds / max) * 100)}%` }} /></div><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</small></div>)}</div>}
        {view === "Detail" ? <div className="report-detail"><h3>Focus sessions</h3>{report?.sessions.length ? report.sessions.map((session) => <div className="session-row" key={session.id}><span><ChartLineUp size={15} /> {new Date(session.endedAt).toLocaleString()}</span><strong>{minutesText(session.durationSeconds)}</strong></div>) : <p>No completed focus sessions in this period.</p>}</div> : <div className="report-projects"><div><span>PROJECT</span><span>TIME (HH:MM)</span></div><p>Total <strong>{report ? minutesText(report.focusSeconds) : "—"}</strong></p></div>}
        <p className="report-note">Your report is stored on this device and available without signing in.</p>
      </div>
    </section>
  </div>;
}
