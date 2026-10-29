import type { Settings } from "@foucusly/contracts";
import { resumeAudio } from "./engine";

type AlarmSettings = Pick<Settings, "alarmSound" | "alarmVolume" | "alarmRepeat">;
/** Schedules one ring of a pattern starting at `at` and returns its length in seconds. */
type Pattern = (ctx: AudioContext, out: AudioNode, at: number) => number;

function tone(
  ctx: AudioContext,
  out: AudioNode,
  {
    at,
    frequency,
    length,
    type = "sine",
    peak = 1,
    endFrequency,
  }: {
    at: number;
    frequency: number;
    length: number;
    type?: OscillatorType;
    peak?: number;
    endFrequency?: number;
  },
) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + length);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(envelope);
  envelope.connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

const patterns: Record<string, Pattern> = {
  Kitchen: (ctx, out, at) => {
    for (let hit = 0; hit < 12; hit++)
      tone(ctx, out, {
        at: at + hit * 0.09,
        frequency: hit % 2 ? 1568 : 1760,
        length: 0.08,
        type: "triangle",
        peak: 0.8,
      });
    return 1.1;
  },
  Bell: (ctx, out, at) => {
    for (const [ratio, peak] of [
      [1, 0.9],
      [2.76, 0.35],
      [5.4, 0.15],
    ] as const)
      tone(ctx, out, { at, frequency: 659 * ratio, length: 1.6, peak });
    return 1.6;
  },
  Digital: (ctx, out, at) => {
    for (let beep = 0; beep < 4; beep++)
      tone(ctx, out, { at: at + beep * 0.2, frequency: 1046, length: 0.11, type: "square", peak: 0.35 });
    return 0.8;
  },
  Bird: (ctx, out, at) => {
    [0, 0.18, 0.5, 0.68].forEach((offset, index) =>
      tone(ctx, out, {
        at: at + offset,
        frequency: index % 2 ? 2600 : 2200,
        endFrequency: 1500,
        length: 0.15,
        peak: 0.7,
      }),
    );
    return 0.9;
  },
};

export const ALARM_SOUNDS = [...Object.keys(patterns), "None"];

/** Plays the configured alarm; resolves false when it is muted or the browser has not unlocked audio yet. */
export async function playAlarm({ alarmSound, alarmVolume, alarmRepeat }: AlarmSettings): Promise<boolean> {
  const pattern = patterns[alarmSound];
  if (!pattern || alarmVolume <= 0) return false;
  const ctx = await resumeAudio();
  if (!ctx || ctx.state !== "running") return false;
  const master = ctx.createGain();
  master.gain.value = (alarmVolume / 100) * 0.6;
  master.connect(ctx.destination);
  let at = ctx.currentTime + 0.05;
  for (let ring = 0; ring < Math.max(1, alarmRepeat); ring++) at += pattern(ctx, master, at) + 0.35;
  window.setTimeout(() => master.disconnect(), (at - ctx.currentTime) * 1000 + 500);
  return true;
}
