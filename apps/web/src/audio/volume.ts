/** Softest audible level at slider 1, in decibels below the maximum gain. */
const VOLUME_RANGE_DB = 40;

/**
 * Maps a 0–100 slider value to a gain using a decibel curve so each step sounds like an even change.
 * A linear mapping makes most of the slider sound the same, which reads as "volume does nothing".
 */
export function volumeToGain(volume: number, maxGain: number): number {
  const clamped = Math.min(100, Math.max(0, volume));
  if (clamped <= 0) return 0;
  return maxGain * 10 ** (((clamped - 100) / 100) * VOLUME_RANGE_DB / 20);
}
