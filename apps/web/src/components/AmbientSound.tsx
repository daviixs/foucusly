import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { useAmbientSound, type AmbientType } from "../hooks/useAmbientSound";
import "./ambient.css";

const OPTIONS: Array<{ id: AmbientType; label: string }> = [
  { id: "none", label: "None" },
  { id: "white", label: "White" },
  { id: "pink", label: "Pink" },
  { id: "brown", label: "Brown" },
  { id: "rain", label: "Rain" },
  { id: "cafe", label: "Cafe" },
  { id: "forest", label: "Forest" }
];

/** "Ambient sound" block for the Settings dialog. Changes apply (and persist) immediately. */
export function AmbientSoundSettings() {
  const ambient = useAmbientSound();
  return <div className="ambient-settings">
    <p className="settings-hint">Ambient sound</p>
    <fieldset className="ambient-options" aria-label="Ambient sound type">
      {OPTIONS.map((option) => <button key={option.id} type="button" aria-pressed={ambient.type === option.id} className={`ambient-option ${ambient.type === option.id ? "selected" : ""}`} onClick={() => ambient.update({ type: option.id })}>{option.label}</button>)}
    </fieldset>
    <div className="sound-settings">
      <label className="range-setting"><span>Volume</span><input aria-label="Ambient sound volume" type="range" min={0} max={100} value={ambient.volume} onChange={(event) => ambient.update({ volume: Number(event.target.value) })} /><output>{ambient.volume}</output></label>
      <button type="button" className="device-button" disabled={ambient.type === "none"} onClick={() => ambient.setPreview(!ambient.previewing)}>{ambient.previewing ? "Stop preview" : "Preview"}</button>
    </div>
    <div className="toggle-stack"><label className="toggle-setting"><span>Play only during focus</span><input type="checkbox" checked={ambient.onlyDuringFocus} onChange={(event) => ambient.update({ onlyDuringFocus: event.target.checked })} /><i aria-hidden="true" /></label></div>
  </div>;
}

/** Quick mute/unmute next to the timer controls. Hidden when no ambient sound is chosen. */
export function AmbientToggle() {
  const ambient = useAmbientSound();
  if (ambient.type === "none") return null;
  const label = ambient.playing ? "Mute ambient sound" : "Unmute ambient sound";
  return <button type="button" className="ambient-toggle" aria-label={label} title={label} aria-pressed={!ambient.playing} onClick={() => ambient.update({ playing: !ambient.playing })}>
    {ambient.playing ? <SpeakerHigh size={22} weight="fill" /> : <SpeakerSlash size={22} weight="fill" />}
  </button>;
}
