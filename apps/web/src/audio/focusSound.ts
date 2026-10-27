import { getAudioContext, resumeAudio } from "./engine";

/** Starts the ambient focus sound on the shared context and returns a function that stops it. */
export function startFocusSound(sound: string, volume: number): () => void {
  const context = getAudioContext();
  if (!context || sound === "None" || volume <= 0) return () => {};
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
  source.buffer = buffer;
  source.loop = true;
  filter.type = sound === "Cafe" ? "bandpass" : "lowpass";
  filter.frequency.value = sound === "Rain" ? 1900 : sound === "Cafe" ? 1250 : sound === "Forest" ? 1150 : 9500;
  filter.Q.value = sound === "Cafe" ? 0.65 : 0.7;
  gain.gain.value = volume / 1000;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start();
  let birds: number | undefined;
  if (sound === "Forest") {
    const chirp = () => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(2100, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1450, context.currentTime + 0.16);
      envelope.gain.setValueAtTime(0, context.currentTime);
      envelope.gain.linearRampToValueAtTime(volume / 1600, context.currentTime + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.21);
    };
    birds = window.setInterval(chirp, 6200);
    window.setTimeout(chirp, 1100);
  }
  void resumeAudio();
  return () => {
    if (birds !== undefined) window.clearInterval(birds);
    source.stop();
    gain.disconnect();
  };
}
