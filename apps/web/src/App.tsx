import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, Crown, Keyboard, Trash, X } from "@phosphor-icons/react";
import { DEFAULT_SETTINGS, durationForMode, type BootstrapData, type Profile, type Settings, type Task, type TaskTemplate, type TimerMode, type TimerState } from "@foucusly/contracts";
import { api } from "./api";
import { Header } from "./components/Header";
import { ReportDialog } from "./components/ReportDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import CloudBackdrop from "./components/CloudBackdrop";
import DarkStarfield from "./components/DarkStarfield";
import { TasksPanel } from "./components/TasksPanel";
import { TimerPanel } from "./components/TimerPanel";
import { ProfileGate } from "./components/ProfileGate";

const freshTimer = (settings: Settings, mode: TimerMode, activeTaskId: string | null, cyclePomos: number): TimerState => ({
  mode, remainingSeconds: durationForMode(settings, mode), running: false, endsAt: null, cyclePomos, activeTaskId,
  currentSessionId: null, sessionStartedAt: null, currentSessionTaskId: null, currentSessionTaskTitle: null, currentSessionProjectId: null
});

export function App() {
  const isSimplePage = window.location.pathname === "/app";
  const [data, setData] = useState<BootstrapData | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileCreateMode, setProfileCreateMode] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [premiumDialogOpen, setPremiumDialogOpen] = useState(false);
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
    window.addEventListener("foucusly-toast", handler);
    return () => window.removeEventListener("foucusly-toast", handler);
  }, [notify]);

  const loadData = useCallback(async () => {
    const loaded = await api.bootstrap();
    setData(loaded);
    setTimer(loaded.timer);
    timerRef.current = loaded.timer;
    setLoadingError("");
    return loaded;
  }, []);

  const activateProfile = useCallback(async (next: Profile) => {
    api.setActiveProfile(next.id);
    window.localStorage.setItem("foucusly-profile-id", next.id);
    setProfile(next);
    setData(null);
    setTimer(null);
    try { await loadData(); }
    catch (error) { setLoadingError((error as Error).message); }
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    void api.profiles().then(async (available) => {
      if (cancelled) return;
      setProfiles(available);
      const savedId = window.localStorage.getItem("foucusly-profile-id");
      const savedProfile = available.find((item) => item.id === savedId);
      if (savedProfile) await activateProfile(savedProfile);
    }).catch((error: Error) => { if (!cancelled) setLoadingError(error.message); });
    return () => { cancelled = true; };
  }, [activateProfile]);

  const createLocalProfile = async (username: string) => {
    const created = await api.createProfile(username);
    const available = await api.profiles();
    setProfiles(available);
    setProfileDialogOpen(false);
    setProfileCreateMode(false);
    await activateProfile(created);
    notify(`Profile “${created.username}” created.`);
  };

  const handleDeleteAccount = async () => {
    if (!profile || deleting) return;
    setDeleting(true);
    try {
      const deletedId = profile.id;
      const deletedName = profile.username;
      await api.deleteProfile(deletedId);
      window.localStorage.removeItem("foucusly-profile-id");
      const remaining = await api.profiles();
      setProfiles(remaining);
      setDeleteDialogOpen(false);
      if (remaining.length > 0) {
        await activateProfile(remaining[0]);
        notify(`Account “${deletedName}” deleted.`);
      } else {
        setProfile(null);
        setData(null);
        setTimer(null);
        setProfileCreateMode(true);
        setProfileDialogOpen(true);
        notify(`Account “${deletedName}” deleted.`);
      }
    } catch (err) {
      notify(`Could not delete account: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem("foucusly-profile-id");
    const previousName = profile?.username;
    setProfile(null);
    setData(null);
    setTimer(null);
    setProfileCreateMode(false);
    setProfileDialogOpen(true);
    if (previousName) notify(`Logged out from “${previousName}”.`);
  };
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
        await api.completeSession({ id: current.currentSessionId, mode: current.mode, startedAt: current.sessionStartedAt, endedAt, durationSeconds: duration, taskId: current.currentSessionTaskId, taskTitle: current.currentSessionTaskTitle, projectId: current.currentSessionProjectId });
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
        sessionStartedAt: startedAt,
        currentSessionTaskId: autoStart ? current.activeTaskId : null,
        currentSessionTaskTitle: autoStart ? data?.tasks.find((task) => task.id === current.activeTaskId)?.title ?? null : null,
        currentSessionProjectId: autoStart ? data?.tasks.find((task) => task.id === current.activeTaskId)?.projectId ?? null : null
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

  const toggleTimer = () => {
    if (!timer || !data) return;
    if (timer.running) {
      const remainingSeconds = Math.max(0, Math.ceil(((timer.endsAt ?? now) - now) / 1000));
      void persistTimer({ ...timer, running: false, endsAt: null, remainingSeconds });
    } else {
      const sessionStartedAt = timer.sessionStartedAt ?? new Date().toISOString();
      const newSession = !timer.currentSessionId;
      const task = data.tasks.find((item) => item.id === timer.activeTaskId);
      void persistTimer({ ...timer, running: true, endsAt: Date.now() + timer.remainingSeconds * 1000,
        currentSessionId: timer.currentSessionId ?? crypto.randomUUID(), sessionStartedAt,
        currentSessionTaskId: newSession ? timer.activeTaskId : timer.currentSessionTaskId,
        currentSessionTaskTitle: newSession ? task?.title ?? null : timer.currentSessionTaskTitle,
        currentSessionProjectId: newSession ? task?.projectId ?? null : timer.currentSessionProjectId
      });
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName ?? "") || (event.target as HTMLElement)?.isContentEditable;
      if ((event.key === "t" || event.key === "T") && !event.metaKey && !event.ctrlKey && !event.altKey && !isInput) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("foucusly-add-task"));
      }
      if (event.key === " " && !isInput && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleTimer();
      }
      if (event.key === "Escape") {
        setDialog(null);
        setDeleteDialogOpen(false);
        setShortcutsDialogOpen(false);
        setPremiumDialogOpen(false);
        if (profile) {
          setProfileDialogOpen(false);
          setProfileCreateMode(false);
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [profile, toggleTimer]);
  const seconds = useMemo(() => timer?.running && timer.endsAt !== null
    ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
    : timer?.remainingSeconds ?? 0, [timer, now]);

  const updateData = async (change: (current: BootstrapData) => BootstrapData) => setData((current) => current ? change(current) : current);
  const handleTaskCreate = async (draft: Pick<Task, "title" | "note" | "estimatePomos" | "projectId">) => {
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
  const handleCreateTemplate = async (draft: Pick<Task, "title" | "note" | "estimatePomos" | "projectId">, name: string) => {
    const { projectId: _projectId, ...template } = draft;
    await api.createTemplate({ ...template, name }); await loadData(); notify("Template saved.");
  };
  const handleUseTemplate = async (id: string) => { await api.useTemplate(id); await loadData(); };
  const handleCreateProject = async (name: string, color: string | null = null) => { const project = await api.createProject(name, color); await loadData(); return project; };
  const handleRenameProject = async (id: string, name: string) => { await api.renameProject(id, name); await loadData(); };
  const handleUpdateProjectColor = async (id: string, color: string | null) => { await api.updateProject(id, { color }); await loadData(); };
  const handleArchiveProject = async (id: string) => { await api.archiveProject(id); await loadData(); };
  const handleRestoreProject = async (id: string) => { await api.restoreProject(id); await loadData(); };
  const handleReorderTasks = async (order: string[]) => { const updated = await api.reorderTasks(order); setData((current) => current ? { ...current, tasks: updated.tasks } : current); };

  const selectMode = (mode: TimerMode) => {
    if (!timer || !data) return;
    void persistTimer(freshTimer(data.settings, mode, timer.activeTaskId, timer.cyclePomos));
  };

  const saveSettings = async (settings: Settings) => {
    const saved = await api.saveSettings(settings);
    setData((current) => current ? { ...current, settings: saved } : current);
    if (timer && !timer.running) await persistTimer({ ...timer, remainingSeconds: durationForMode(saved, timer.mode) });
  };
  const setActiveTask = (id: string) => { if (timer) void persistTimer({ ...timer, activeTaskId: id }); };

  if (loadingError) return <main className="fatal-state"><div><div className="fatal-mark"><ArrowClockwise size={22} /></div><h1>Foucusly</h1><p>Can't connect to the local timer service.</p><code>{loadingError}</code><button className="button-dark" onClick={() => { setLoadingError(""); if (profile) void activateProfile(profile); else void api.profiles().then(setProfiles).catch((error: Error) => setLoadingError(error.message)); }}>Try again</button><small>Start both apps with <code>npm run dev</code>.</small></div></main>;
  if (profile && (!data || !timer)) return <main className="loading-state"><div className="loading-spinner" /><span>Preparing your focus space…</span></main>;

  const shownData = data ?? { tasks: [], projects: [], templates: [], settings: DEFAULT_SETTINGS };
  const shownTimer = timer ?? freshTimer(DEFAULT_SETTINGS, "pomodoro", null, 0);
  const shellTheme = shownData.settings.themeColor ?? "red";
  const darkRunning = Boolean(shownData.settings.darkModeWhenRunning && shownTimer.running);

  return <div className={`app-shell theme-${shellTheme} ${darkRunning ? "dark-running" : ""}`}>
    <div className="focus-area">
      {darkRunning && <DarkStarfield />}
      <CloudBackdrop dark={darkRunning} />
      <div className="app-container">
        <Header
          profile={profile}
          onAccount={() => {
            setProfileCreateMode(false);
            setProfileDialogOpen(true);
          }}
          onPremium={() => setPremiumDialogOpen(true)}
          onLogout={handleLogout}
          onShortcuts={() => setShortcutsDialogOpen(true)}
          onDeleteAccount={() => setDeleteDialogOpen(true)}
          onReport={() => setDialog("report")}
          onSettings={() => setDialog("settings")}
          onSignIn={() => {
            setProfileCreateMode(profiles.length === 0);
            setProfileDialogOpen(true);
          }}
        />
        <main className="focus-main">
          <TimerPanel mode={shownTimer.mode} seconds={seconds} running={shownTimer.running} cyclePomos={shownTimer.cyclePomos} taskTitle={shownData.tasks.find((task) => task.id === shownTimer.activeTaskId)?.title} onMode={selectMode} onToggle={toggleTimer} />
          <TasksPanel tasks={shownData.tasks} projects={shownData.projects} templates={shownData.templates} activeTaskId={shownTimer.activeTaskId} visible={shownData.settings.tasksVisible} hourFormat={shownData.settings.hourFormat} onCreate={handleTaskCreate} onUpdate={handleTaskUpdate} onDelete={handleTaskDelete} onReorder={handleReorderTasks} onUseTemplate={handleUseTemplate} onCreateTemplate={handleCreateTemplate} onAction={handleAction} onSelect={setActiveTask} onToast={notify} onCreateProject={handleCreateProject} onRenameProject={handleRenameProject} onUpdateProjectColor={handleUpdateProjectColor} onArchiveProject={handleArchiveProject} onRestoreProject={handleRestoreProject} />
        </main>
      </div>
    </div>
    {isSimplePage && <div className="app-bottom-link"><a href="/">FULL PAGE</a></div>}
    {dialog === "settings" && data && <SettingsDialog initial={data.settings} onSave={saveSettings} onClose={() => setDialog(null)} onToast={notify} />}
    {dialog === "report" && <ReportDialog onClose={() => setDialog(null)} />}
    {(!profile || profileDialogOpen) && (
      <ProfileGate
        profiles={profiles}
        activeProfileId={profile?.id ?? null}
        initialCreating={profileCreateMode || profiles.length === 0}
        onSelect={(selected) => {
          setProfileDialogOpen(false);
          setProfileCreateMode(false);
          void activateProfile(selected);
        }}
        onCreate={createLocalProfile}
        onClose={profile ? () => {
          setProfileDialogOpen(false);
          setProfileCreateMode(false);
        } : undefined}
      />
    )}
    {deleteDialogOpen && profile && (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (!deleting && event.target === event.currentTarget) {
            setDeleteDialogOpen(false);
          }
        }}
      >
        <section
          className="section-dialog delete-account-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <header className="section-dialog-header">
            <button
              className="dialog-close"
              aria-label="Close"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              <X size={20} />
            </button>
            <span className="section-dialog-icon delete-icon">
              <Trash size={28} weight="duotone" />
            </span>
            <span className="dialog-eyebrow">DANGER ZONE</span>
            <h2 id="delete-account-title">Delete Account</h2>
            <p>
              Are you sure you want to permanently delete account <strong>{profile.username}</strong>?
              All your tasks, projects, sessions, and settings will be permanently removed.
            </p>
          </header>
          <footer className="dialog-footer">
            <button
              type="button"
              className="button-muted"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button-danger"
              onClick={() => void handleDeleteAccount()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete Account"}
            </button>
          </footer>
        </section>
      </div>
    )}
    {shortcutsDialogOpen && (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShortcutsDialogOpen(false);
        }}
      >
        <section
          className="section-dialog shortcuts-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-dialog-title"
        >
          <header className="section-dialog-header">
            <button
              className="dialog-close"
              aria-label="Close"
              onClick={() => setShortcutsDialogOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="section-dialog-icon">
              <Keyboard size={28} weight="duotone" />
            </span>
            <span className="dialog-eyebrow">QUICK ACCESS</span>
            <h2 id="shortcuts-dialog-title">Keyboard Shortcuts</h2>
            <p>Speed up your productivity with keyboard controls.</p>
          </header>
          <div className="shortcuts-content">
            <div className="shortcut-row">
              <span>Start or pause timer</span>
              <kbd>Space</kbd>
            </div>
            <div className="shortcut-row">
              <span>Add a new task</span>
              <kbd>T</kbd>
            </div>
            <div className="shortcut-row">
              <span>Close open dialog</span>
              <kbd>Esc</kbd>
            </div>
          </div>
          <footer className="dialog-footer">
            <button
              type="button"
              className="button-dark"
              onClick={() => setShortcutsDialogOpen(false)}
            >
              Got it
            </button>
          </footer>
        </section>
      </div>
    )}
    {premiumDialogOpen && (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPremiumDialogOpen(false);
        }}
      >
        <section
          className="section-dialog premium-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="premium-dialog-title"
        >
          <header className="section-dialog-header">
            <button
              className="dialog-close"
              aria-label="Close"
              onClick={() => setPremiumDialogOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="section-dialog-icon premium-icon">
              <Crown size={28} weight="duotone" />
            </span>
            <span className="dialog-eyebrow">UPGRADE</span>
            <h2 id="premium-dialog-title">Foucusly Premium</h2>
            <p>Supercharge your daily focus sessions with pro features.</p>
          </header>
          <div className="premium-content">
            <ul className="premium-features-list">
              <li>
                <strong>Webhook Automations:</strong> Sync completed focus sessions with Discord, Slack, and Notion automatically.
              </li>
              <li>
                <strong>Ambient Audio Library:</strong> High-definition binaural beats and cafe/nature soundscapes.
              </li>
              <li>
                <strong>Deep Ranking & Analytics:</strong> Export full CSV reports with detailed project timeline insights.
              </li>
              <li>
                <strong>Unlimited Templates:</strong> Save repeatable daily task routines and templates without limits.
              </li>
            </ul>
          </div>
          <footer className="dialog-footer">
            <button
              type="button"
              className="button-dark"
              onClick={() => setPremiumDialogOpen(false)}
            >
              Close
            </button>
          </footer>
        </section>
      </div>
    )}
    {toast && <div className="toast-message" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={16} /></button></div>}
  </div>;
}
