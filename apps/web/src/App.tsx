import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, X } from "@phosphor-icons/react";
import { DEFAULT_SETTINGS, durationForMode, type BootstrapData, type Settings, type Task, type TaskTemplate, type TimerMode, type TimerState } from "@pomofocus/contracts";
import { api } from "./api";
import { Header } from "./components/Header";
import { MarketingContent } from "./components/MarketingContent";
import { ReportDialog } from "./components/ReportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import CloudBackdrop from "./components/CloudBackdrop";
import { TasksPanel } from "./components/TasksPanel";
import { TimerPanel } from "./components/TimerPanel";

const freshTimer = (settings: Settings, mode: TimerMode, activeTaskId: string | null, cyclePomos: number): TimerState => ({
  mode, remainingSeconds: durationForMode(settings, mode), running: false, endsAt: null, cyclePomos, activeTaskId, currentSessionId: null, sessionStartedAt: null
});

export function App() {
  const isSimplePage = window.location.pathname === "/app";
  const [data, setData] = useState<BootstrapData | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loadingError, setLoadingError] = useState("");
  const [dialog, setDialog] = useState<"settings" | "report" | "signin" | null>(null);
  const [toast, setToast] = useState("");
  const finishing = useRef(false);
  const timerRef = useRef<TimerState | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 3200);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => notify((event as CustomEvent<string>).detail);
    window.addEventListener("pomofocus-toast", handler);
    return () => window.removeEventListener("pomofocus-toast", handler);
  }, [notify]);

  const loadData = useCallback(async () => {
    const loaded = await api.bootstrap();
    setData(loaded);
    setTimer(loaded.timer);
    timerRef.current = loaded.timer;
    setLoadingError("");
    return loaded;
  }, []);

  useEffect(() => { void loadData().catch((error: Error) => setLoadingError(error.message)); }, [loadData]);
  useEffect(() => { timerRef.current = timer; }, [timer]);

  useEffect(() => {
    const sound = data?.settings.focusSound;
    const volume = data?.settings.focusVolume ?? 0;
    if (!timer?.running || !sound || sound === "None" || volume === 0) return;
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
    source.buffer = buffer;
    source.loop = true;
    filter.type = sound === "Cafe" ? "bandpass" : "lowpass";
    filter.frequency.value = sound === "Rain" ? 1900 : sound === "Cafe" ? 1250 : sound === "Forest" ? 1150 : 9500;
    filter.Q.value = sound === "Cafe" ? 0.65 : 0.7;
    gain.gain.value = volume / 1000;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
    let birds: number | undefined;
    if (sound === "Forest") {
      const chirp = () => {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(2100, context.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1450, context.currentTime + 0.16);
        envelope.gain.setValueAtTime(0, context.currentTime);
        envelope.gain.linearRampToValueAtTime(volume / 1600, context.currentTime + 0.025);
        envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.21);
      };
      birds = window.setInterval(chirp, 6200);
      window.setTimeout(chirp, 1100);
    }
    void context.resume();
    return () => {
      if (birds !== undefined) window.clearInterval(birds);
      source.stop();
      void context.close();
    };
  }, [timer?.running, data?.settings.focusSound, data?.settings.focusVolume]);

  const persistTimer = useCallback(async (next: TimerState) => {
    setTimer(next);
    timerRef.current = next;
    try { const saved = await api.saveTimer(next); setTimer(saved); timerRef.current = saved; }
    catch (error) { notify(`Timer could not be saved: ${(error as Error).message}`); }
  }, [notify]);

  const soundAlarm = useCallback(() => {
    if (!data || data.settings.alarmVolume <= 0 || data.settings.alarmSound === "None") return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const play = (count: number) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = data.settings.alarmSound === "Kitchen" ? "sine" : "triangle";
        oscillator.frequency.value = data.settings.alarmSound === "Bell" ? 880 : 660;
        gain.gain.value = data.settings.alarmVolume / 600;
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + 0.2);
        if (count > 1) window.setTimeout(() => play(count - 1), 400);
        else window.setTimeout(() => void context.close(), 800);
      };
      play(data.settings.alarmRepeat);
    } catch { /* Audio may be unavailable until the browser receives a user gesture. */ }
  }, [data]);

  const finishSession = useCallback(async (current: TimerState) => {
    if (finishing.current) return;
    finishing.current = true;
    const endedAt = new Date().toISOString();
    const settings = data?.settings ?? DEFAULT_SETTINGS;
    const duration = durationForMode(settings, current.mode);
    try {
      if (current.currentSessionId && current.sessionStartedAt) {
        await api.completeSession({ id: current.currentSessionId, mode: current.mode, startedAt: current.sessionStartedAt, endedAt, durationSeconds: duration, taskId: current.activeTaskId });
      }
      soundAlarm();
      if (settings.notificationReminderMinutes > 0 && "Notification" in window && Notification.permission === "granted") {
        new Notification(current.mode === "pomodoro" ? "Pomodoro complete" : "Break complete", { body: current.mode === "pomodoro" ? "Time for a short break." : "Ready to focus again?" });
      }
      const cyclePomos = current.mode === "pomodoro" ? current.cyclePomos + 1 : current.cyclePomos;
      const nextMode: TimerMode = current.mode === "pomodoro"
        ? (cyclePomos % settings.longBreakInterval === 0 ? "longBreak" : "shortBreak")
        : "pomodoro";
      const autoStart = nextMode === "pomodoro" ? settings.autoStartPomodoros : settings.autoStartBreaks;
      const nextDuration = durationForMode(settings, nextMode);
      const startedAt = autoStart ? new Date().toISOString() : null;
      const next: TimerState = {
        mode: nextMode,
        remainingSeconds: nextDuration,
        running: autoStart,
        endsAt: autoStart ? Date.now() + nextDuration * 1000 : null,
        cyclePomos,
        activeTaskId: current.activeTaskId,
        currentSessionId: autoStart ? crypto.randomUUID() : null,
        sessionStartedAt: startedAt
      };
      await persistTimer(next);
      await loadData();
      notify(current.mode === "pomodoro" ? "Focus session complete. Time for a break." : "Break complete. Ready for another Pomodoro?");
    } catch (error) {
      notify(`Could not finish session: ${(error as Error).message}`);
      const next = { ...current, running: false, endsAt: null, remainingSeconds: 0 };
      await persistTimer(next);
    } finally { finishing.current = false; }
  }, [data, loadData, notify, persistTimer, soundAlarm]);

  useEffect(() => {
    if (!timer?.running || timer.endsAt === null) return;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= (timerRef.current?.endsAt ?? Infinity)) void finishSession(timerRef.current!);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [timer?.running, timer?.endsAt, finishSession]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.key === "t" || event.key === "T") && !event.metaKey && !event.ctrlKey && !event.altKey && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName ?? "")) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("pomofocus-add-task"));
      }
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const seconds = useMemo(() => timer?.running && timer.endsAt !== null
    ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
    : timer?.remainingSeconds ?? 0, [timer, now]);

  const updateData = async (change: (current: BootstrapData) => BootstrapData) => setData((current) => current ? change(current) : current);
  const handleTaskCreate = async (draft: Pick<Task, "title" | "note" | "estimatePomos">) => {
    await api.createTask(draft); await loadData();
  };
  const handleTaskUpdate = async (id: string, patch: Partial<Task>) => { await api.updateTask(id, patch); await loadData(); };
  const handleTaskDelete = async (id: string) => { await api.deleteTask(id); if (timer?.activeTaskId === id && timer) await persistTimer({ ...timer, activeTaskId: null }); await loadData(); };
  const handleAction = async (action: "clear-finished" | "clear-all" | "clear-pomos" | "toggle-hidden") => {
    const updated = await api.taskAction(action);
    setData(updated);
    if (timer?.activeTaskId && !updated.tasks.some((task) => task.id === timer.activeTaskId)) {
      await persistTimer({ ...timer, activeTaskId: null });
    }
  };
  const handleCreateTemplate = async (draft: Pick<Task, "title" | "note" | "estimatePomos">, name: string) => { await api.createTemplate({ ...draft, name }); await loadData(); notify("Template saved."); };
  const handleUseTemplate = async (id: string) => { await api.useTemplate(id); await loadData(); };

  const selectMode = (mode: TimerMode) => {
    if (!timer || !data) return;
    void persistTimer(freshTimer(data.settings, mode, timer.activeTaskId, timer.cyclePomos));
  };
  const toggleTimer = () => {
    if (!timer || !data) return;
    if (timer.running) {
      const remainingSeconds = Math.max(0, Math.ceil(((timer.endsAt ?? now) - now) / 1000));
      void persistTimer({ ...timer, running: false, endsAt: null, remainingSeconds });
    } else {
      const sessionStartedAt = timer.sessionStartedAt ?? new Date().toISOString();
      void persistTimer({ ...timer, running: true, endsAt: Date.now() + timer.remainingSeconds * 1000, currentSessionId: timer.currentSessionId ?? crypto.randomUUID(), sessionStartedAt });
    }
  };
  const saveSettings = async (settings: Settings) => {
    const saved = await api.saveSettings(settings);
    setData((current) => current ? { ...current, settings: saved } : current);
    if (timer && !timer.running) await persistTimer({ ...timer, remainingSeconds: durationForMode(saved, timer.mode) });
  };
  const setActiveTask = (id: string) => { if (timer) void persistTimer({ ...timer, activeTaskId: id }); };

  const shellTheme = data?.settings.themeColor ?? "red";
  const darkRunning = Boolean(data?.settings.darkModeWhenRunning && timer?.running);

  if (loadingError) return <main className="fatal-state"><div><div className="fatal-mark"><ArrowClockwise size={22} /></div><h1>Pomofocus</h1><p>Can't connect to the local timer service.</p><code>{loadingError}</code><button className="button-dark" onClick={() => { setLoadingError(""); void loadData().catch((error: Error) => setLoadingError(error.message)); }}>Try again</button><small>Start both apps with <code>npm run dev</code>.</small></div></main>;
  if (!data || !timer) return <main className="loading-state"><div className="loading-spinner" /><span>Preparing your focus space…</span></main>;

  return <div className={`app-shell theme-${shellTheme} ${darkRunning ? "dark-running" : ""}`}>
    <div className="focus-area">
      <CloudBackdrop />
      <div className="app-container">
        <Header onReport={() => setDialog("report")} onSettings={() => setDialog("settings")} onSignIn={() => setDialog("signin")} />
        <main className="focus-main">
          <TimerPanel mode={timer.mode} seconds={seconds} running={timer.running} cyclePomos={timer.cyclePomos} taskTitle={data.tasks.find((task) => task.id === timer.activeTaskId)?.title} onMode={selectMode} onToggle={toggleTimer} />
          <TasksPanel tasks={data.tasks} templates={data.templates} activeTaskId={timer.activeTaskId} visible={data.settings.tasksVisible} hourFormat={data.settings.hourFormat} onCreate={handleTaskCreate} onUpdate={handleTaskUpdate} onDelete={handleTaskDelete} onUseTemplate={handleUseTemplate} onCreateTemplate={handleCreateTemplate} onAction={handleAction} onSelect={setActiveTask} onToast={notify} />
        </main>
      </div>
    </div>
    {!isSimplePage && <MarketingContent />}
    <div className="app-bottom-link">{isSimplePage ? <a href="/">FULL PAGE</a> : <a href="/app">SIMPLE PAGE</a>}</div>
    {dialog === "settings" && <SettingsDialog initial={data.settings} onSave={saveSettings} onClose={() => setDialog(null)} onToast={notify} />}
    {dialog === "report" && <ReportDialog onClose={() => setDialog(null)} onToast={notify} />}
    {dialog === "signin" && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="small-dialog signin-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title"><button className="dialog-close" aria-label="Close sign in" onClick={() => setDialog(null)}><X size={20} /></button><div className="dialog-lock"><span>PF</span></div><h2 id="signin-title">Sign in to Pomofocus</h2><p>Accounts aren't enabled in this local clone. Your tasks, settings, and reports are saved in the local database.</p><button className="button-dark full-button" onClick={() => setDialog(null)}>Continue focusing</button></section></div>}
    {toast && <div className="toast-message" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={16} /></button></div>}
  </div>;
}
