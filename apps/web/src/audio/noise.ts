import { getAudioContext, resumeAudio } from "./engine";

export type NoiseType = "white" | "pink" | "brown";

const BUFFER_SECONDS = 2;
const RAMP_SECONDS = 0.08;

const cache = new Map<NoiseType, AudioBuffer>();
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let currentType: NoiseType | null = null;
let volume = 0.5;

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

function bufferFor(ctx: AudioContext, type: NoiseType): AudioBuffer {
  const cached = cache.get(type);
  if (cached && cached.sampleRate === ctx.sampleRate) return cached;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * BUFFER_SECONDS), ctx.sampleRate);
  fillNoise(type, buffer.getChannelData(0));
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
  if (!source || !gain) return;
  const oldSource = source;
  const oldGain = gain;
  ramp(oldGain, ctx, 0);
  try { oldSource.stop(ctx.currentTime + RAMP_SECONDS + 0.02); } catch { /* already stopped */ }
  oldSource.onended = () => oldGain.disconnect();
  source = null;
  gain = null;
  currentType = null;
}

/** Starts looping the given noise; replaces any noise already playing. */
export async function play(type: NoiseType): Promise<void> {
  const ctx = await resumeAudio();
  if (!ctx) return;
  if (currentType === type && source) return;
  release(ctx);
  const node = ctx.createGain();
  node.gain.value = 0;
  node.connect(ctx.destination);
  const src = ctx.createBufferSource();
  src.buffer = bufferFor(ctx, type);
  src.loop = true;
  src.connect(node);
  src.start();
  source = src;
  gain = node;
  currentType = type;
  ramp(node, ctx, volume);
}

export function stop(): void {
  const ctx = getAudioContext();
  if (ctx) release(ctx);
}

/** Sets volume in [0, 1]. */
export function setVolume(value: number): void {
  volume = Math.min(1, Math.max(0, value));
  const ctx = getAudioContext();
  if (ctx && gain) ramp(gain, ctx, volume);
}

export function playingType(): NoiseType | null {
  return currentType;
}
