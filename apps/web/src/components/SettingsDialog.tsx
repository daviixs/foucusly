import { useState, type CSSProperties } from "react";
import { BellRinging, Check, LockKey, X } from "@phosphor-icons/react";
import type { Settings, ThemeColor } from "@foucusly/contracts";

interface Props {
  initial: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onClose: () => void;
  onToast: (message: string) => void;
}

const themeOptions: Array<{ key: ThemeColor; label: string; color: string }> = [
  { key: "red", label: "Red", color: "#af4949" },
  { key: "teal", label: "Teal", color: "#38858a" },
  { key: "blue", label: "Blue", color: "#397097" },
  { key: "green", label: "Green", color: "#598c57" },
  { key: "purple", label: "Purple", color: "#7d53a2" }
];

function NumberSetting({ label, value, min = 0, max = 180, suffix, onChange }: { label: string; value: number; min?: number; max?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="number-setting"><span>{label}</span><span className="number-control"><input aria-label={label} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} />{suffix && <small>{suffix}</small>}</span></label>;
}

function ToggleSetting({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-setting"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function SelectSetting({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="select-setting"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((item) => <option key={item}>{item}</option>)}</select></label>;
}

export function SettingsDialog({ initial, onSave, onClose, onToast }: Props) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => { setBusy(true); try { await onSave(settings); onClose(); } finally { setBusy(false); } };
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="dialog-header"><div><span className="dialog-eyebrow">PREFERENCES</span><h2 id="settings-title">Setting</h2></div><button className="dialog-close" aria-label="Close settings" onClick={onClose}><X size={20} /></button></header>
      <div className="settings-content">
        <section className="settings-group"><h3>Timer</h3><p className="settings-hint">Time (minutes)</p>
          <div className="number-grid"><NumberSetting label="Pomodoro" value={settings.pomodoroMinutes} min={1} onChange={(value) => set("pomodoroMinutes", value)} /><NumberSetting label="Short Break" value={settings.shortBreakMinutes} min={1} max={60} onChange={(value) => set("shortBreakMinutes", value)} /><NumberSetting label="Long Break" value={settings.longBreakMinutes} min={1} max={90} onChange={(value) => set("longBreakMinutes", value)} /></div>
          <div className="settings-divider" />
          <div className="toggle-stack"><ToggleSetting label="Auto Start Breaks" checked={settings.autoStartBreaks} onChange={(value) => set("autoStartBreaks", value)} /><ToggleSetting label="Auto Start Pomodoros" checked={settings.autoStartPomodoros} onChange={(value) => set("autoStartPomodoros", value)} /></div>
          <NumberSetting label="Long Break interval" value={settings.longBreakInterval} min={2} max={12} onChange={(value) => set("longBreakInterval", value)} />
        </section>
        <section className="settings-group"><h3>Task</h3><div className="toggle-stack"><ToggleSetting label="Auto Check Tasks" checked={settings.autoCheckTasks} onChange={(value) => set("autoCheckTasks", value)} /><ToggleSetting label="Check to Bottom" checked={settings.checkToBottom} onChange={(value) => set("checkToBottom", value)} /></div></section>
        <section className="settings-group"><h3>Sound</h3><div className="sound-settings"><SelectSetting label="Alarm Sound" value={settings.alarmSound} options={["Kitchen", "Bell", "Digital", "Bird", "None"]} onChange={(value) => set("alarmSound", value)} /><label className="range-setting"><span>Volume</span><input aria-label="Alarm volume" type="range" min={0} max={100} value={settings.alarmVolume} onChange={(event) => set("alarmVolume", Number(event.target.value))} /><output>{settings.alarmVolume}</output></label><NumberSetting label="Repeat" value={settings.alarmRepeat} min={1} max={5} onChange={(value) => set("alarmRepeat", value)} /></div>
          <div className="sound-settings"><SelectSetting label="Focus Sound" value={settings.focusSound} options={["None", "Rain", "Cafe", "Forest", "White noise"]} onChange={(value) => set("focusSound", value)} /><label className="range-setting"><span>Volume</span><input aria-label="Focus sound volume" type="range" min={0} max={100} value={settings.focusVolume} onChange={(event) => set("focusVolume", Number(event.target.value))} /><output>{settings.focusVolume}</output></label></div>
        </section>
        <section className="settings-group"><h3>Theme</h3><div className="theme-picker" role="radiogroup" aria-label="Theme color">{themeOptions.map((theme) => <button type="button" key={theme.key} role="radio" aria-checked={settings.themeColor === theme.key} aria-label={`${theme.label} theme`} className={`theme-swatch ${settings.themeColor === theme.key ? "active" : ""}`} style={{ "--swatch": theme.color } as CSSProperties} onClick={() => set("themeColor", theme.key)}>{settings.themeColor === theme.key && <Check size={16} weight="bold" />}</button>)}</div><div className="select-grid"><SelectSetting label="Hour Format" value={settings.hourFormat} options={["24-hour", "12-hour"]} onChange={(value) => set("hourFormat", value as Settings["hourFormat"])} /><SelectSetting label="Week starts on" value={settings.weekStartsOn === 1 ? "Monday" : "Sunday"} options={["Monday", "Sunday"]} onChange={(value) => set("weekStartsOn", value === "Monday" ? 1 : 0)} /></div><ToggleSetting label="Dark Mode when running" checked={settings.darkModeWhenRunning} onChange={(value) => set("darkModeWhenRunning", value)} /></section>
        <section className="settings-group"><h3>Notification</h3><div className="select-grid"><NumberSetting label="Reminder" value={settings.notificationReminderMinutes} min={0} max={120} suffix="min" onChange={(value) => set("notificationReminderMinutes", value)} /><button className="device-button" onClick={() => { if ("Notification" in window) void Notification.requestPermission().then((permission) => onToast(permission === "granted" ? "Notifications enabled on this device." : "Notification permission was not granted.")); }}><BellRinging size={16} /> Add this device</button></div></section>
        <section className="settings-group"><h3>Integration</h3><div className="integration-row"><div><b>Todoist</b><small>Import tasks from your Todoist account</small></div><button className="locked-button" onClick={() => onToast("Todoist integration is a Premium feature.")}>Connect <LockKey size={13} /></button></div><div className="integration-row"><div><b>Webhook</b><small>Connect Foucusly with other apps</small></div><button className="locked-button" onClick={() => onToast("Webhooks are a Premium feature.")}>Add <LockKey size={13} /></button></div></section>
      </div>
      <footer className="dialog-footer"><button className="button-muted" onClick={onClose}>Cancel</button><button className="button-dark" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "OK"}</button></footer>
    </section>
  </div>;
}
