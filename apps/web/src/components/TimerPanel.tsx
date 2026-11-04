import { FastForward, Pause, Play } from "@phosphor-icons/react";
import type { TimerMode } from "@foucusly/contracts";
import { AmbientToggle } from "./AmbientSound";
import { useState } from "react";

const modes: Array<{ key: TimerMode; label: string }> = [
  { key: "pomodoro", label: "Pomodoro" },
  { key: "shortBreak", label: "Short Break" },
  { key: "longBreak", label: "Long Break" }
];

// Mirrors the settings validation in apps/api/src/server.ts.
const minuteLimits: Record<TimerMode, { min: number; max: number; label: string }> = {
  pomodoro: { min: 1, max: 180, label: "pomodoro" },
  shortBreak: { min: 1, max: 60, label: "short break" },
  longBreak: { min: 1, max: 90, label: "long break" }
};

interface TimerPanelProps {
  mode: TimerMode;
  seconds: number;
  running: boolean;
  taskTitle?: string;
  cyclePomos: number;
  longBreakInterval: number;
  onMode: (mode: TimerMode) => void;
  onToggle: () => void;
  onSkip: () => void;
  durationSeconds: number;
  onEditMinutes: (minutes: number) => void | Promise<void>;
}

export function TimerPanel({ mode, seconds, running, taskTitle, cyclePomos, longBreakInterval, onMode, onToggle, onSkip, durationSeconds, onEditMinutes }: TimerPanelProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.max(0, seconds % 60).toString().padStart(2, "0");
  const editable = !running && seconds === durationSeconds;
  const limits = minuteLimits[mode];
  const editing = editable && draft !== null;
  const commit = () => {
    if (draft === null) return;
    const value = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isNaN(value)) return;
    const clamped = Math.min(limits.max, Math.max(limits.min, value));
    if (clamped * 60 !== durationSeconds) void onEditMinutes(clamped);
  };
  const greeting = mode === "pomodoro" ? "Time to focus!" : "Time for a break!";
  return <>
    <section className="timer-card" aria-label="Pomodoro timer">
      <div className="mode-tabs" role="tablist" aria-label="Timer mode">
        {modes.map((item) => <button
          key={item.key}
          role="tab"
          aria-selected={mode === item.key}
          className={`mode-tab ${mode === item.key ? "selected" : ""}`}
          onClick={() => onMode(item.key)}
        >{item.label}</button>)}
      </div>
      <div className="timer-readout" aria-live="off">
        {editing
          ? <input
              className="timer-minutes-input"
              aria-label={`Edit ${limits.label} minutes`}
              inputMode="numeric"
              maxLength={3}
              // biome-ignore lint/a11y/noAutofocus: input only appears after the user asks to edit
              autoFocus
              value={draft}
              style={{ width: `${Math.max(2, draft.length)}ch` }}
              onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
              onFocus={(event) => event.target.select()}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); commit(); }
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); }
              }}
            />
          : editable
            ? <button type="button" className="timer-minutes-edit" aria-label={`Edit ${limits.label} minutes`} title={`Edit ${limits.label} minutes`} onClick={() => setDraft(String(durationSeconds / 60))}>{minutes}</button>
            : minutes}:{remainder}
      </div>
      <div className="timer-controls">
        <AmbientToggle />
        <button className="timer-primary" onClick={onToggle}>
          {running ? <><Pause size={18} weight="fill" /> PAUSE</> : <><Play size={18} weight="fill" /> START</>}
        </button>
        <button className="timer-skip" type="button" aria-label="Skip current interval" onClick={onSkip}><FastForward size={22} weight="fill" /></button>
      </div>
    </section>
      <div className="timer-footer"><span>#{(cyclePomos % Math.max(1, longBreakInterval)) + 1}</span><span>{taskTitle ? `${greeting} · ${taskTitle}` : greeting}</span></div>
  </>;
}
