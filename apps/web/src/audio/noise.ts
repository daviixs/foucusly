import { getAudioContext, resumeAudio } from "./engine";
import { startScene } from "./soundscapes";
import { volumeToGain } from "./volume";

export type NoiseType = "white" | "pink" | "brown";
export type SceneType = "rain" | "cafe" | "forest";
export type AmbientSoundType = NoiseType | SceneType;

const BUFFER_SECONDS = 2;
/** Samples cross-faded from the tail into the head so the loop point has no click (matters for brown). */
const LOOP_FADE_SAMPLES = 4096;
const RAMP_SECONDS = 0.08;
/** Output gain at slider 100, per sound, so every option peaks at a similar loudness. */
const MAX_GAIN: Record<AmbientSoundType, number> = { white: 0.35, pink: 0.5, brown: 0.8, rain: 0.9, cafe: 1, forest: 1 };

const cache = new Map<NoiseType, AudioBuffer>();
let gain: GainNode | null = null;
let stopCurrent: (() => void) | null = null;
let currentType: AmbientSoundType | null = null;
let volume = 50;

/** Fills `out` with noise samples in [-1, 1]. Exported for tests. */
export function fillNoise(type: NoiseType, out: Float32Array, random: () => number = Math.random): Float32Array {
  if (type === "white") {
    for (let i = 0; i < out.length; i++) out[i] = random() * 2 - 1;
    return out;
  }
  if (type === "pink") {
    // Paul Kellet's refined pink noise filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < out.length; i++) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
  } else {
    // Brown noise: leaky integration of white noise.
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
      out[i] = last;
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.9;
  return out;
}

/** Returns a cached, seamlessly looping mono noise buffer (2 s, shared by every sound). */
export function noiseBuffer(ctx: BaseAudioContext, type: NoiseType): AudioBuffer {
  const cached = cache.get(type);
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const length = Math.floor(ctx.sampleRate * BUFFER_SECONDS);
  const raw = fillNoise(type, new Float32Array(length + LOOP_FADE_SAMPLES));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  data.set(raw.subarray(0, length));
  // The head blends from the samples that would follow the tail, so sample length-1 flows into sample 0.
  for (let i = 0; i < LOOP_FADE_SAMPLES; i++) {
    const t = i / LOOP_FADE_SAMPLES;
    data[i] = raw[i] * t + raw[length + i] * (1 - t);
  }
  cache.set(type, buffer);
  return buffer;
}

function ramp(node: GainNode, ctx: AudioContext, target: number) {
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(target, now + RAMP_SECONDS);
}

function release(ctx: AudioContext) {
  if (!gain || !stopCurrent) return;
  const oldGain = gain;
  const oldStop = stopCurrent;
  ramp(oldGain, ctx, 0);
  window.setTimeout(() => { oldStop(); oldGain.disconnect(); }, (RAMP_SECONDS + 0.05) * 1000);
  gain = null;
  stopCurrent = null;
  currentType = null;
}

function targetGain(type: AmbientSoundType) {
  return volumeToGain(volume, MAX_GAIN[type]);
}

/** Starts looping the given sound; replaces any sound already playing. */
export async function play(type: AmbientSoundType): Promise<void> {
  const ctx = await resumeAudio();
  if (!ctx) return;
  if (currentType === type && gain) return;
  release(ctx);
  const node = ctx.createGain();
  node.gain.value = 0;
  node.connect(ctx.destination);
  if (type === "white" || type === "pink" || type === "brown") {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, type);
    src.loop = true;
    src.connect(node);
    src.start();
    stopCurrent = () => { try { src.stop(); } catch { /* already stopped */ } src.disconnect(); };
  } else {
    stopCurrent = startScene(ctx, type, node);
  }
  gain = node;
  currentType = type;
  ramp(node, ctx, targetGain(type));
}

export function stop(): void {
  const ctx = getAudioContext();
  if (ctx) release(ctx);
}

/** Sets the 0-100 slider volume; mapped through a perceptual (dB) curve. */
export function setVolume(value: number): void {
  volume = Math.min(100, Math.max(0, value));
  const ctx = getAudioContext();
  if (ctx && gain && currentType) ramp(gain, ctx, targetGain(currentType));
}

export function playingType(): AmbientSoundType | null {
  return currentType;
}
