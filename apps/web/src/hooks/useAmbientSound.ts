import { useEffect, useSyncExternalStore } from "react";
import { type AmbientSoundType, play, setVolume, stop } from "../audio/noise";

export type AmbientType = "none" | AmbientSoundType;

export interface AmbientState {
  type: AmbientType;
  /** 0-100 */
  volume: number;
  /** User-level on/off (the quick mute toggle). */
  playing: boolean;
  onlyDuringFocus: boolean;
}

export const DEFAULT_AMBIENT: AmbientState = { type: "none", volume: 40, playing: true, onlyDuringFocus: true };

const TYPES: AmbientType[] = ["none", "white", "pink", "brown", "rain", "cafe", "forest"];

/** Old server-side "Focus Sound" values and their ambient equivalents. */
const LEGACY_FOCUS_SOUNDS: Record<string, AmbientType> = { Rain: "rain", Cafe: "cafe", Forest: "forest", "White noise": "white" };

export interface LegacyFocusSound { focusSound: string; focusVolume: number }

/**
 * One-time migration from the removed Focus Sound setting: only when this profile has never stored an
 * ambient choice. Returns the state to store, or null when nothing should change.
 */
export function migrateLegacyFocusSound(stored: string | null, legacy: LegacyFocusSound | null | undefined): AmbientState | null {
  if (stored !== null || !legacy) return null;
  const type = LEGACY_FOCUS_SOUNDS[legacy.focusSound];
  if (!type) return null;
  const volume = Number.isFinite(legacy.focusVolume) ? Math.min(100, Math.max(0, Math.round(legacy.focusVolume))) : DEFAULT_AMBIENT.volume;
  return { ...DEFAULT_AMBIENT, type, volume };
}

export function storageKey(profileId: string | null | undefined): string {
  return profileId ? `foucusly-ambient:${profileId}` : "foucusly-ambient";
}

export function parseAmbient(raw: string | null): AmbientState {
  if (!raw) return { ...DEFAULT_AMBIENT };
  try {
    const value = JSON.parse(raw) as Partial<AmbientState>;
    return {
      type: TYPES.includes(value.type as AmbientType) ? (value.type as AmbientType) : DEFAULT_AMBIENT.type,
      volume: typeof value.volume === "number" ? Math.min(100, Math.max(0, value.volume)) : DEFAULT_AMBIENT.volume,
      playing: typeof value.playing === "boolean" ? value.playing : DEFAULT_AMBIENT.playing,
      onlyDuringFocus: typeof value.onlyDuringFocus === "boolean" ? value.onlyDuringFocus : DEFAULT_AMBIENT.onlyDuringFocus
    };
  } catch {
    return { ...DEFAULT_AMBIENT };
  }
}

/** Decides whether noise should be audible. */
export function shouldPlay(state: AmbientState, focusRunning: boolean, previewing: boolean): boolean {
  if (state.type === "none") return false;
  if (previewing) return true;
  return state.playing && (!state.onlyDuringFocus || focusRunning);
}

// Small shared store so the settings dialog, the quick toggle and the timer sync see the same state.
let key = storageKey(null);
let state: AmbientState = { ...DEFAULT_AMBIENT };
let previewing = false;
let focusRunning = false;
const listeners = new Set<() => void>();

function read(): AmbientState {
  try { return parseAmbient(window.localStorage.getItem(key)); } catch { return { ...DEFAULT_AMBIENT }; }
}

function apply() {
  setVolume(state.volume / 100);
  if (shouldPlay(state, focusRunning, previewing) && state.type !== "none") void play(state.type);
  else stop();
}

function emit() {
  apply();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAmbient(patch: Partial<AmbientState>) {
  state = { ...state, ...patch };
  try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage unavailable */ }
  emit();
}

export function setAmbientPreview(value: boolean) {
  previewing = value;
  emit();
}

const getPreview = () => previewing;

/** Read/update the ambient sound preferences. */
export function useAmbientSound() {
  const current = useSyncExternalStore(subscribe, () => state);
  const isPreviewing = useSyncExternalStore(subscribe, getPreview);
  return { ...current, previewing: isPreviewing, update: updateAmbient, setPreview: setAmbientPreview };
}

/** Mount once (in App): loads the profile's preferences and follows the timer. */
export function useAmbientTimerSync(profileId: string | null | undefined, isFocusRunning: boolean, legacy?: LegacyFocusSound | null) {
  useEffect(() => {
    key = storageKey(profileId);
    state = read();
    emit();
  }, [profileId]);
  const legacySound = legacy?.focusSound;
  const legacyVolume = legacy?.focusVolume;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the active profile (storage key) changes.
  useEffect(() => {
    if (legacySound === undefined || legacyVolume === undefined) return;
    let stored: string | null;
    try { stored = window.localStorage.getItem(key); } catch { return; }
    if (stored !== null) return;
    // Persist even the default so the migration never runs again for this profile.
    updateAmbient(migrateLegacyFocusSound(stored, { focusSound: legacySound, focusVolume: legacyVolume }) ?? { ...DEFAULT_AMBIENT });
  }, [profileId, legacySound, legacyVolume]);
  useEffect(() => {
    focusRunning = isFocusRunning;
    if (isFocusRunning) previewing = false;
    emit();
  }, [isFocusRunning]);
  useEffect(() => () => { focusRunning = false; previewing = false; stop(); }, []);
}
