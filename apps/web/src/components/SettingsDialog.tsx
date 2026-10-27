import { useState, type CSSProperties } from "react";
import { BellRinging, Check, GearSix, LockKey, X } from "@phosphor-icons/react";
import type { Settings, ThemeColor } from "@foucusly/contracts";
import { api } from "../api";
import { ALARM_SOUNDS, playAlarm } from "../audio/alarm";

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) output[index] = raw.charCodeAt(index);
  return output;
}

interface Props {
  initial: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onClose: () => void;
  onToast: (message: string) => void;
}

const THEME_COLORS: Array<{ id: ThemeColor; label: string; swatch: string }> = [
  { id: "red", label: "Red", swatch: "#af4949" },
  { id: "teal", label: "Teal", swatch: "#38858a" },
  { id: "blue", label: "Blue", swatch: "#397097" },
  { id: "green", label: "Green", swatch: "#598c57" },
  { id: "purple", label: "Purple", swatch: "#7d53a2" }
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
  const [deviceBusy, setDeviceBusy] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => { setBusy(true); try { await onSave(settings); onClose(); } finally { setBusy(false); } };

  const enableDevice = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      onToast("Push notifications are not supported in this browser.");
      return;
    }
    setDeviceBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        onToast("Notification permission was not granted.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await api.pushPublicKey();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      }
      await api.subscribePush(JSON.stringify(subscription));
      onToast("Reminders will now reach this device even with the tab closed.");
    } catch (reason) {
      onToast(`Could not enable this device: ${(reason as Error).message}`);
    } finally {
      setDeviceBusy(false);
    }
  };

  const testPush = async () => {
    try {
      const result = await api.testPush();
      onToast(result.ok ? `Test reminder sent to ${result.delivered} device(s).` : "No push device was reachable. Re-add this device.");
    } catch (reason) {
      onToast((reason as Error).message);
    }
  };

  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog section-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
      <header className="section-dialog-header">
        <button className="dialog-close" aria-label="Close settings" onClick={onClose}><X size={20} /></button>
        <span className="section-dialog-icon"><GearSix size={25} weight="duotone" /></span>
        <span className="dialog-eyebrow">PREFERENCES</span>
        <h2 id="settings-title">Settings</h2>
        <p id="settings-description">Make your focus space work for you.</p>
      </header>
      <div className="settings-content">
        <section className="settings-group"><h3>Timer</h3><p className="settings-hint">Time (minutes)</p>
          <div className="number-grid"><NumberSetting label="Pomodoro" value={settings.pomodoroMinutes} min={1} onChange={(value) => set("pomodoroMinutes", value)} /><NumberSetting label="Short Break" value={settings.shortBreakMinutes} min={1} max={60} onChange={(value) => set("shortBreakMinutes", value)} /><NumberSetting label="Long Break" value={settings.longBreakMinutes} min={1} max={90} onChange={(value) => set("longBreakMinutes", value)} /></div>
          <div className="settings-divider" />
          <div className="toggle-stack"><ToggleSetting label="Auto Start Breaks" checked={settings.autoStartBreaks} onChange={(value) => set("autoStartBreaks", value)} /><ToggleSetting label="Auto Start Pomodoros" checked={settings.autoStartPomodoros} onChange={(value) => set("autoStartPomodoros", value)} /></div>
          <NumberSetting label="Long Break interval" value={settings.longBreakInterval} min={2} max={12} onChange={(value) => set("longBreakInterval", value)} />
        </section>
        <section className="settings-group"><h3>Task</h3><div className="toggle-stack"><ToggleSetting label="Auto Check Tasks" checked={settings.autoCheckTasks} onChange={(value) => set("autoCheckTasks", value)} /><ToggleSetting label="Check to Bottom" checked={settings.checkToBottom} onChange={(value) => set("checkToBottom", value)} /></div></section>
        <section className="settings-group"><h3>Sound</h3><div className="sound-settings"><SelectSetting label="Alarm Sound" value={settings.alarmSound} options={ALARM_SOUNDS} onChange={(value) => { set("alarmSound", value); void playAlarm({ ...settings, alarmSound: value, alarmRepeat: 1 }); }} /><label className="range-setting"><span>Volume</span><input aria-label="Alarm volume" type="range" min={0} max={100} value={settings.alarmVolume} onChange={(event) => set("alarmVolume", Number(event.target.value))} onPointerUp={() => void playAlarm({ ...settings, alarmRepeat: 1 })} /><output>{settings.alarmVolume}</output></label><NumberSetting label="Repeat" value={settings.alarmRepeat} min={1} max={5} onChange={(value) => set("alarmRepeat", value)} /></div>
          <div className="sound-settings"><SelectSetting label="Focus Sound" value={settings.focusSound} options={["None", "Rain", "Cafe", "Forest", "White noise"]} onChange={(value) => set("focusSound", value)} /><label className="range-setting"><span>Volume</span><input aria-label="Focus sound volume" type="range" min={0} max={100} value={settings.focusVolume} onChange={(event) => set("focusVolume", Number(event.target.value))} /><output>{settings.focusVolume}</output></label></div>
        </section>
        <section className="settings-group"><h3>Time Display</h3><div className="select-grid"><SelectSetting label="Hour Format" value={settings.hourFormat} options={["24-hour", "12-hour"]} onChange={(value) => set("hourFormat", value as Settings["hourFormat"])} /><SelectSetting label="Week starts on" value={settings.weekStartsOn === 1 ? "Monday" : "Sunday"} options={["Monday", "Sunday"]} onChange={(value) => set("weekStartsOn", value === "Monday" ? 1 : 0)} /></div></section>
        <section className="settings-group"><h3>Theme</h3><p className="settings-hint">Color</p>
          <div className="theme-picker" role="radiogroup" aria-label="Theme color">{THEME_COLORS.map((theme) => <button key={theme.id} type="button" role="radio" aria-checked={settings.themeColor === theme.id} aria-label={`${theme.label} theme`} className={`theme-swatch${settings.themeColor === theme.id ? " active" : ""}`} style={{ "--swatch": theme.swatch } as CSSProperties} onClick={() => set("themeColor", theme.id)}>{settings.themeColor === theme.id ? <Check size={14} weight="bold" /> : null}</button>)}</div>
          <ToggleSetting label="Dark mode when running" checked={settings.darkModeWhenRunning} onChange={(value) => set("darkModeWhenRunning", value)} />
        </section>
        <section className="settings-group"><h3>Notification</h3><p className="settings-hint">Notify this many minutes before the timer ends, and again when it finishes. 0 turns both browser alerts off. Subscribed devices are still notified when the timer finishes.</p><div className="select-grid"><NumberSetting label="Remind before end" value={settings.notificationReminderMinutes} min={0} max={120} suffix="min" onChange={(value) => { const wasOff = settings.notificationReminderMinutes <= 0; set("notificationReminderMinutes", value); if (wasOff && value > 0 && "Notification" in window && Notification.permission === "default") void Notification.requestPermission().then((permission) => { if (permission !== "granted") onToast("Allow notifications to get the early reminder in this browser."); }); }} /><button className="device-button" disabled={deviceBusy} onClick={() => { void enableDevice(); }}><BellRinging size={16} /> {deviceBusy ? "Enabling…" : "Add this device"}</button><button className="device-button" onClick={() => { void testPush(); }}><BellRinging size={16} /> Test reminder</button></div></section>
        <section className="settings-group"><h3>Integration</h3><div className="integration-row"><div><b>Webhook</b><small>Connect Foucusly with other apps</small></div><button className="locked-button" onClick={() => onToast("Webhooks are a Premium feature.")}>Add <LockKey size={13} /></button></div></section>
      </div>
      <footer className="dialog-footer"><button className="button-muted" onClick={onClose}>Cancel</button><button className="button-dark" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "OK"}</button></footer>
    </section>
  </div>;
}
