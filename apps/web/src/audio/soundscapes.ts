import { noiseBuffer, type SceneType } from "./noise";

/**
 * Procedural soundscapes built from the shared 2 s noise loops plus short scheduled events.
 * Nothing is downloaded and memory stays at the three cached noise buffers (~1 MB total).
 */

type Stop = () => void;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function loop(
  ctx: AudioContext,
  type: "white" | "pink" | "brown",
  out: AudioNode,
  playbackRate = 1,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, type);
  src.loop = true;
  src.playbackRate.value = playbackRate;
  // Random start offset so layers using the same buffer do not phase against each other.
  src.connect(out);
  src.start(ctx.currentTime, rand(0, 1.9));
  return src;
}

function filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function gainNode(ctx: AudioContext, value: number, out: AudioNode): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  node.connect(out);
  return node;
}

/** Slow sine LFO added to an AudioParam. */
function lfo(ctx: AudioContext, param: AudioParam, frequency: number, depth: number): OscillatorNode {
  const osc = ctx.createOscillator();
  const amount = ctx.createGain();
  osc.frequency.value = frequency;
  amount.gain.value = depth;
  osc.connect(amount);
  amount.connect(param);
  osc.start();
  return osc;
}

/** Calls `fire(at)` with random gaps, scheduling ~0.3 s ahead on the audio clock. */
function scheduler(ctx: AudioContext, gap: () => number, fire: (at: number) => void): Stop {
  let next = ctx.currentTime + gap();
  const timer = window.setInterval(() => {
    while (next < ctx.currentTime + 0.3) {
      if (next >= ctx.currentTime) fire(next);
      next += gap();
    }
  }, 100);
  return () => window.clearInterval(timer);
}

function stopAll(sources: AudioScheduledSourceNode[], timers: Stop[]): Stop {
  return () => {
    for (const stop of timers) stop();
    for (const src of sources) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
    }
  };
}

function rain(ctx: AudioContext, out: AudioNode): Stop {
  // Steady hiss of distant rain: pink noise band-limited to 400 Hz - 7 kHz, plus a soft low rumble.
  const hiss = filter(ctx, "highpass", 400);
  const top = filter(ctx, "lowpass", 7000);
  hiss.connect(top);
  const hissGain = gainNode(ctx, 0.35, out);
  top.connect(hissGain);
  const rumbleFilter = filter(ctx, "lowpass", 250);
  rumbleFilter.connect(gainNode(ctx, 0.25, out));
  const sources: AudioScheduledSourceNode[] = [loop(ctx, "pink", hiss), loop(ctx, "brown", rumbleFilter)];
  sources.push(lfo(ctx, hissGain.gain, 0.09, 0.06));
  // Droplets: very short band-passed noise ticks at random pitches.
  const dropBus = gainNode(ctx, 0.5, out);
  const white = noiseBuffer(ctx, "white");
  const droplets = scheduler(
    ctx,
    () => rand(0.02, 0.14),
    (at) => {
      const src = ctx.createBufferSource();
      src.buffer = white;
      const band = filter(ctx, "bandpass", rand(1800, 6500), rand(4, 12));
      const env = ctx.createGain();
      const length = rand(0.012, 0.04);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(rand(0.15, 0.8), at + 0.002);
      env.gain.exponentialRampToValueAtTime(0.001, at + length);
      src.connect(band);
      band.connect(env);
      env.connect(dropBus);
      src.start(at, rand(0, 1.9), length + 0.01);
      src.onended = () => env.disconnect();
    },
  );
  return stopAll(sources, [droplets]);
}

function forest(ctx: AudioContext, out: AudioNode): Stop {
  // Wind through leaves: brown + pink noise through a slowly sweeping low-pass, with swelling gain.
  const windFilter = filter(ctx, "lowpass", 600, 0.5);
  const windGain = gainNode(ctx, 0.45, out);
  windFilter.connect(windGain);
  const leaves = filter(ctx, "bandpass", 2500, 0.6);
  const leavesGain = gainNode(ctx, 0.05, out);
  leaves.connect(leavesGain);
  const sources: AudioScheduledSourceNode[] = [loop(ctx, "brown", windFilter), loop(ctx, "pink", leaves)];
  sources.push(
    lfo(ctx, windFilter.frequency, 0.05, 250),
    lfo(ctx, windGain.gain, 0.07, 0.2),
    lfo(ctx, leavesGain.gain, 0.11, 0.03),
  );
  // Birds: phrases of 2-6 quick frequency-swept chirps from a random side.
  const birdBus = gainNode(ctx, 0.12, out);
  const birds = scheduler(
    ctx,
    () => rand(2.5, 9),
    (at) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.8, 0.8);
      pan.connect(birdBus);
      const base = rand(2400, 4200);
      const notes = Math.floor(rand(2, 7));
      const spacing = rand(0.09, 0.18);
      const level = rand(0.4, 1);
      for (let n = 0; n < notes; n++) {
        const start = at + n * spacing;
        const length = rand(0.05, 0.12);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.frequency.setValueAtTime(base * rand(0.95, 1.2), start);
        osc.frequency.exponentialRampToValueAtTime(base * rand(0.6, 0.85), start + length);
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(level, start + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, start + length);
        osc.connect(env);
        env.connect(pan);
        osc.start(start);
        osc.stop(start + length + 0.02);
        if (n === notes - 1) osc.onended = () => pan.disconnect();
      }
    },
  );
  return stopAll(sources, [birds]);
}

function cafe(ctx: AudioContext, out: AudioNode): Stop {
  // Crowd murmur: pink noise in the speech band (formant-like band-passes), amplitude-modulated so it "talks".
  const sources: AudioScheduledSourceNode[] = [];
  for (const [frequency, q, rate, level] of [
    [350, 1.2, 0.6, 0.5],
    [800, 1.5, 0.9, 0.35],
    [1600, 2, 1.3, 0.15],
  ] as const) {
    const band = filter(ctx, "bandpass", frequency, q);
    const voice = gainNode(ctx, level, out);
    band.connect(voice);
    sources.push(loop(ctx, "pink", band, rand(0.97, 1.03)));
    sources.push(lfo(ctx, voice.gain, rate, level * 0.45), lfo(ctx, band.frequency, rate * 0.37, frequency * 0.15));
  }
  const room = filter(ctx, "lowpass", 180);
  room.connect(gainNode(ctx, 0.25, out));
  sources.push(loop(ctx, "brown", room));
  // Cups and spoons: short inharmonic ringing partials.
  const clinkBus = gainNode(ctx, 0.05, out);
  const clinks = scheduler(
    ctx,
    () => rand(1.5, 6),
    (at) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.7, 0.7);
      pan.connect(clinkBus);
      const base = rand(2200, 3600);
      const hits = Math.random() < 0.35 ? 2 : 1;
      for (let h = 0; h < hits; h++) {
        const start = at + h * rand(0.08, 0.16);
        for (const ratio of [1, 1.47, 2.09]) {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.frequency.value = base * ratio;
          env.gain.setValueAtTime(0, start);
          env.gain.linearRampToValueAtTime(rand(0.3, 1) / ratio, start + 0.003);
          env.gain.exponentialRampToValueAtTime(0.001, start + rand(0.15, 0.35));
          osc.connect(env);
          env.connect(pan);
          osc.start(start);
          osc.stop(start + 0.4);
        }
      }
      window.setTimeout(() => pan.disconnect(), 1000);
    },
  );
  return stopAll(sources, [clinks]);
}

const scenes: Record<SceneType, (ctx: AudioContext, out: AudioNode) => Stop> = { rain, forest, cafe };

/** Starts a soundscape into `out` and returns a function that stops every node and timer it created. */
export function startScene(ctx: AudioContext, type: SceneType, out: AudioNode): Stop {
  return scenes[type](ctx, out);
}
