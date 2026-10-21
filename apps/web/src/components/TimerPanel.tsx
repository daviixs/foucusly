import { Pause, Play } from "@phosphor-icons/react";
import type { TimerMode } from "@pomofocus/contracts";

const modes: Array<{ key: TimerMode; label: string }> = [
  { key: "pomodoro", label: "Pomodoro" },
  { key: "shortBreak", label: "Short Break" },
  { key: "longBreak", label: "Long Break" }
];

interface TimerPanelProps {
  mode: TimerMode;
  seconds: number;
  running: boolean;
  taskTitle?: string;
  cyclePomos: number;
  onMode: (mode: TimerMode) => void;
  onToggle: () => void;
}

export function TimerPanel({ mode, seconds, running, taskTitle, cyclePomos, onMode, onToggle }: TimerPanelProps) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.max(0, seconds % 60).toString().padStart(2, "0");
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
      <div className="timer-readout" aria-live="off">{minutes}:{remainder}</div>
      <div className="timer-controls">
        <button className="timer-primary" onClick={onToggle}>
          {running ? <><Pause size={18} weight="fill" /> PAUSE</> : <><Play size={18} weight="fill" /> START</>}
        </button>
      </div>
    </section>
      <div className="timer-footer"><span>#{(cyclePomos % 4) + 1}</span><span>{taskTitle ? `${greeting} · ${taskTitle}` : greeting}</span></div>
  </>;
}
