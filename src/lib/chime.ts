import type { Chime } from "./types";

/** Notification chimes generated with Web Audio (no audio files needed). */
let ctx: AudioContext | null = null;

export const CHIME_LABEL: Record<Chime, string> = {
  "chime-1": "Soft ding-dong",
  "chime-2": "Bright triple",
  "chime-3": "Workshop bell",
};

const NOTES: Record<Chime, { freq: number; at: number; type: OscillatorType; len: number; vol: number }[]> = {
  "chime-1": [
    { freq: 880, at: 0, type: "sine", len: 0.9, vol: 0.12 },
    { freq: 1318.5, at: 0.16, type: "sine", len: 0.9, vol: 0.12 },
  ],
  "chime-2": [
    { freq: 1046.5, at: 0, type: "sine", len: 0.35, vol: 0.1 },
    { freq: 1318.5, at: 0.12, type: "sine", len: 0.35, vol: 0.1 },
    { freq: 1568, at: 0.24, type: "sine", len: 0.7, vol: 0.1 },
  ],
  "chime-3": [
    { freq: 659.3, at: 0, type: "triangle", len: 1.6, vol: 0.16 },
    { freq: 1318.5, at: 0, type: "sine", len: 1.2, vol: 0.05 },
  ],
};

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Browsers block sound until the user interacts; call this from the first click. */
export function unlockAudio() {
  audio();
}

export function playChime(chime: Chime = "chime-1") {
  try {
    const c = audio();
    if (!c) return;
    const now = c.currentTime;
    (NOTES[chime] ?? NOTES["chime-1"]).forEach(({ freq, at, type, len, vol }) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t = now + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + len + 0.05);
    });
  } catch {
    /* audio blocked until the user interacts with the page – ignore */
  }
}
