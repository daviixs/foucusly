import { useState, type CSSProperties } from "react";
import { BellRinging, Check, GearSix, X } from "@phosphor-icons/react";
import { DEFAULT_SETTINGS, isAllowedWebhookUrl, type Settings, type ThemeColor, type WebhookEvent } from "@foucusly/contracts";
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

const WEBHOOK_EVENT_OPTIONS: Array<{ id: WebhookEvent; label: string }> = [
  { id: "session.finished", label: "Session finished" },
  { id: "task.completed", label: "Task completed" }
];

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
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial, webhookEvents: [...(initial.webhookEvents ?? [])] });
  const [busy, setBusy] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      await onSave(settings);
      onClose();
    } catch (reason) {
      onToast((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleWebhookEvent = (event: WebhookEvent, checked: boolean) => {
    setSettings((current) => {
      const events = new Set(current.webhookEvents);
      if (checked) events.add(event);
      else events.delete(event);
      return { ...current, webhookEvents: [...events] };
    });
  };
  const clearWebhook = () => {
    setSettings((current) => ({ ...current, webhookUrl: "", webhookSecret: "", webhookToken: "", webhookEnabled: false, webhookEvents: [], webhookLastError: "" }));
  };
  const testWebhook = async () => {
    setTestBusy(true);
    try {
      const result = await api.testWebhook({ webhookUrl: settings.webhookUrl, webhookSecret: settings.webhookSecret, webhookToken: settings.webhookToken });
      setSettings((current) => ({ ...current, webhookLastError: result.ok ? "" : result.error ?? "Webhook delivery failed" }));
      onToast(result.ok ? `Webhook ping delivered (${result.status ?? "ok"}). Use OK to save these settings.` : `Webhook ping failed: ${result.error ?? "delivery failed"}`);
    } catch (reason) {
      const message = (reason as Error).message;
      setSettings((current) => ({ ...current, webhookLastError: message }));
      onToast(message);
    } finally {
      setTestBusy(false);
    }
  };

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
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
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
          <ToggleSetting label="Dark mode at night (18:00–06:00)" checked={settings.autoDarkAtNight} onChange={(value) => set("autoDarkAtNight", value)} />
        </section>
        <section className="settings-group"><h3>Notification</h3><p className="settings-hint">Notify this many minutes before the timer ends, and again when it finishes. 0 turns both browser alerts off. Subscribed devices are still notified when the timer finishes.</p><div className="select-grid"><NumberSetting label="Remind before end" value={settings.notificationReminderMinutes} min={0} max={120} suffix="min" onChange={(value) => { const wasOff = settings.notificationReminderMinutes <= 0; set("notificationReminderMinutes", value); if (wasOff && value > 0 && "Notification" in window && Notification.permission === "default") void Notification.requestPermission().then((permission) => { if (permission !== "granted") onToast("Allow notifications to get the early reminder in this browser."); }); }} /><button className="device-button" disabled={deviceBusy} onClick={() => { void enableDevice(); }}><BellRinging size={16} /> {deviceBusy ? "Enabling…" : "Add this device"}</button><button className="device-button" onClick={() => { void testPush(); }}><BellRinging size={16} /> Test reminder</button></div></section>
        <section className="settings-group">
          <h3>Integration</h3>
          <p className="settings-hint">POST JSON to your own URL when a session finishes or a task is checked off. HTTPS is required; http://localhost and http://127.0.0.1 are allowed for local testing. OK saves. Test sends a ping to the URL in this form.</p>
          <div className="webhook-form">
            <label className="webhook-field">
              <span>Webhook URL</span>
              <input type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder="https://hooks.zapier.com/..." value={settings.webhookUrl} onChange={(event) => set("webhookUrl", event.target.value)} />
            </label>
            <ToggleSetting label="Enabled" checked={settings.webhookEnabled} onChange={(value) => set("webhookEnabled", value)} />
            <fieldset className="webhook-events">
              <legend>Events</legend>
              {WEBHOOK_EVENT_OPTIONS.map((option) => (
                <label key={option.id} className="webhook-check">
                  <input type="checkbox" checked={settings.webhookEvents.includes(option.id)} onChange={(event) => toggleWebhookEvent(option.id, event.target.checked)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="webhook-field">
              <span>Secret (optional)</span>
              <input type="password" autoComplete="new-password" spellCheck={false} value={settings.webhookSecret} onChange={(event) => set("webhookSecret", event.target.value)} />
            </label>
            <label className="webhook-field">
              <span>Bearer token (optional)</span>
              <input type="password" autoComplete="off" spellCheck={false} value={settings.webhookToken} onChange={(event) => set("webhookToken", event.target.value)} />
            </label>
            {settings.webhookUrl.trim() && !isAllowedWebhookUrl(settings.webhookUrl) ? <p className="webhook-error" role="alert">Use an https:// URL (http:// only for localhost / 127.0.0.1).</p> : null}
            <p className="settings-hint">When a secret is set, each request includes X-Foucusly-Signature: sha256= plus the HMAC-SHA256 of the raw JSON body.</p>
            {settings.webhookLastError ? <p className="webhook-error" role="status">{settings.webhookLastError}</p> : null}
            <div className="webhook-actions">
              <button type="button" className="device-button" disabled={testBusy} onClick={() => { void testWebhook(); }}>{testBusy ? "Testing…" : "Test"}</button>
              <button type="button" className="device-button" onClick={clearWebhook}>Clear</button>
            </div>
          </div>
        </section>
      </div>
      <footer className="dialog-footer"><button className="button-muted" onClick={onClose}>Cancel</button><button className="button-dark" onClick={() => void save()} disabled={busy || testBusy}>{busy ? "Saving…" : "OK"}</button></footer>
    </section>
  </div>;
}
