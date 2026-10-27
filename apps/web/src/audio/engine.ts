type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;

function contextClass(): AudioContextConstructor | undefined {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

/** Returns the app-wide AudioContext, or null when Web Audio is unavailable. */
export function getAudioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = contextClass();
  if (!Ctor) return null;
  try { context = new Ctor(); } catch { return null; }
  return context;
}

/** Resumes the shared context; browsers only allow this reliably during or after a user gesture. */
export async function resumeAudio(): Promise<AudioContext | null> {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state !== "running") {
    try { await ctx.resume(); } catch { /* Still locked; the next user gesture unlocks it. */ }
  }
  return ctx;
}

/**
 * Browsers create audio contexts suspended until a user gesture. Timer alarms fire from a timeout, not a
 * gesture, so the shared context is resumed on the first interaction (with a silent buffer for Safari)
 * and stays unlocked for later alarms.
 */
export function installAudioUnlock(): () => void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    void resumeAudio().then((ctx) => {
      if (!ctx || ctx.state !== "running") return;
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();
      remove();
    });
  };
  const remove = () => events.forEach((name) => window.removeEventListener(name, unlock, true));
  events.forEach((name) => window.addEventListener(name, unlock, { capture: true, passive: true }));
  return remove;
}
