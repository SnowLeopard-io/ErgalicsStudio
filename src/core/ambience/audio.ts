// ==========================================================================
// Ambience audio — procedural Web Audio cues + generative light music.
// No audio files: every sound is synthesized (oscillator + gain envelope), so
// the whole sound system costs zero bytes and stays stylistically coherent.
// The AudioContext is created lazily inside the first user-gesture-triggered
// cue, which satisfies browser autoplay policies.
// ==========================================================================

export type CueName =
  | 'click'
  | 'toggle'
  | 'notify'
  | 'success'
  | 'error'
  | 'xp'
  | 'badge'
  | 'open';

interface AudioConfig {
  enabled: boolean;
  /** 0–100 (store scale). */
  volume: number;
  /** Which generative theme is playing (see AMBIENT_TRACK_IDS). */
  ambientTrack: string;
}

const config: AudioConfig = { enabled: true, volume: 70, ambientTrack: 'starfield' };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = (config.volume / 100) * 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

export function configureAudio(partial: Partial<AudioConfig>): void {
  Object.assign(config, partial);
  if (master && ctx) {
    master.gain.setTargetAtTime((config.volume / 100) * 0.5, ctx.currentTime, 0.05);
  }
}

function tone(
  freq: number,
  opts: {
    type?: OscillatorType;
    start?: number;
    duration?: number;
    peak?: number;
    endFreq?: number;
  } = {},
): void {
  const ac = ensureContext();
  if (!ac || !master) return;
  const { type = 'sine', start = 0, duration = 0.1, peak = 0.18, endFreq } = opts;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
  // Fast attack, exponential decay — the "soft tick" envelope used everywhere.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

const CUES: Record<CueName, () => void> = {
  // Short neutral tick — primary clicks.
  click: () => tone(1250, { duration: 0.045, peak: 0.1 }),
  // Two-tone pop — switches, mode changes.
  toggle: () => {
    tone(620, { duration: 0.05, peak: 0.09 });
    tone(930, { start: 0.045, duration: 0.06, peak: 0.09 });
  },
  // Gentle two-note rise — informational toast.
  notify: () => {
    tone(1046.5, { duration: 0.12, peak: 0.12 });
    tone(1318.5, { start: 0.09, duration: 0.14, peak: 0.1 });
  },
  // Soft major chord — success / run completed.
  success: () => {
    tone(1046.5, { duration: 0.3, peak: 0.1 });
    tone(1318.5, { start: 0.06, duration: 0.3, peak: 0.08 });
    tone(1568, { start: 0.12, duration: 0.34, peak: 0.07 });
  },
  // Low, short, non-alarming downward blip.
  error: () => tone(220, { type: 'triangle', duration: 0.22, peak: 0.14, endFreq: 170 }),
  // Delicate arpeggio — XP awarded.
  xp: () => {
    tone(880, { duration: 0.09, peak: 0.09 });
    tone(1108.7, { start: 0.07, duration: 0.09, peak: 0.08 });
    tone(1318.5, { start: 0.14, duration: 0.12, peak: 0.07 });
  },
  // Four-note rise — badge unlocked (the one louder highlight moment).
  badge: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, { start: i * 0.11, duration: 0.26, peak: 0.13 }),
    );
  },
  // Warm open sweep — project/plugin opened.
  open: () => tone(400, { duration: 0.16, peak: 0.08, endFreq: 800 }),
};

/** Play a named cue. No-ops when sounds are disabled or the context cannot
 *  start (e.g. no gesture yet — the notify sound simply stays silent). */
export function playCue(name: CueName): void {
  if (!config.enabled) return;
  try {
    CUES[name]();
  } catch {
    /* audio must never break the interaction that triggered it */
  }
}

// ---- generative light music (ambient) ------------------------------------------
//
// The ambient option plays a slow generative piece: soft piano-like tones on
// a themed scale with random-walk melodies and a warm delay tail. Zero bytes,
// always different, always calm. Themes ("tracks") vary register, scale,
// tempo, note length and space — 星空 is airy and high, 深邃海洋 is dark and
// slow, 雪域高山 is crystalline open fifths, 森林 is a minor-pentatonic
// nocturne, 水墨 is a plucked Jiangnan-style pentatonic.

const PENTATONIC_MAJOR = [0, 2, 4, 7, 9];
const PENTATONIC_MINOR = [0, 3, 5, 7, 10];

export type AmbientTrackId = 'starfield' | 'ocean' | 'alpine' | 'forest' | 'ink';

export const AMBIENT_TRACK_IDS: AmbientTrackId[] = ['starfield', 'ocean', 'alpine', 'forest', 'ink'];

interface AmbientTrack {
  /** Scale intervals in semitones. */
  scale: number[];
  /** Root register per resolved theme (dark / light). */
  baseDark: number;
  baseLight: number;
  /** Ladder length in scale steps (melody range). */
  steps: number;
  /** Seconds between notes [min, max]. */
  tempo: [number, number];
  /** Note duration in seconds [min, max]. */
  duration: [number, number];
  /** Note peak multiplier. */
  peak: number;
  harmonyChance: number;
  /** Delay time / feedback / wet — the "space" of the theme. */
  space: [number, number, number];
  /** Signature texture layered on top of the base melody. */
  texture: 'shimmer' | 'sub' | 'airy' | 'none';
}

const TRACKS: Record<AmbientTrackId, AmbientTrack> = {
  // 星空探索 — high register, sparse, twinkling high partials, wide space.
  starfield: {
    scale: PENTATONIC_MAJOR, baseDark: 261.63, baseLight: 329.63, steps: 15,
    tempo: [1.2, 2.8], duration: [2.6, 4.2], peak: 0.9, harmonyChance: 0.25,
    space: [0.6, 0.42, 0.4], texture: 'shimmer',
  },
  // 深邃海洋 — low register, minor pentatonic, long swells, very slow.
  ocean: {
    scale: PENTATONIC_MINOR, baseDark: 98, baseLight: 110, steps: 10,
    tempo: [1.7, 3.4], duration: [3.5, 6], peak: 1.1, harmonyChance: 0.3,
    space: [0.7, 0.45, 0.42], texture: 'sub',
  },
  // 雪域高山 — crystalline, open-fifth air, moderately sparse.
  alpine: {
    scale: PENTATONIC_MAJOR, baseDark: 146.83, baseLight: 196, steps: 12,
    tempo: [1.4, 3], duration: [2.4, 4], peak: 0.8, harmonyChance: 0.35,
    space: [0.55, 0.4, 0.36], texture: 'airy',
  },
  // 森林夜曲 — warm minor pentatonic, gentle flow, close space.
  forest: {
    scale: PENTATONIC_MINOR, baseDark: 174.61, baseLight: 196, steps: 12,
    tempo: [0.9, 2.1], duration: [1.8, 3.2], peak: 0.85, harmonyChance: 0.2,
    space: [0.38, 0.3, 0.3], texture: 'none',
  },
  // 水墨江南 — plucked pentatonic, short notes, intimate space.
  ink: {
    scale: PENTATONIC_MAJOR, baseDark: 220, baseLight: 261.63, steps: 12,
    tempo: [0.8, 1.8], duration: [1.1, 2], peak: 0.9, harmonyChance: 0.18,
    space: [0.3, 0.24, 0.26], texture: 'none',
  },
};

interface AmbientState {
  bus: GainNode;
  timer: number;
  trackId: AmbientTrackId;
  /** Melody position on the theme's scale ladder. */
  step: number;
  /** Root frequency in Hz (theme-dependent). */
  base: number;
}

let ambientNodes: AmbientState | null = null;
/** True while a plugin plays its own audio — the music stands down. */
let hostAudioActive = false;
/** Whether the user wants the music on at all (mirrors the store setting). */
let ambientWanted = false;

/** Mirror the store's "music desired" state so host-audio ducking knows
 *  whether to resume the music after a clip finishes. */
export function setAmbientWanted(wanted: boolean): void {
  ambientWanted = wanted;
}

function playPadNote(
  ac: AudioContext,
  dest: AudioNode,
  freq: number,
  peak: number,
  dur: number,
  opts: { attack?: number; shimmer?: number; when?: number } = {},
): void {
  const { attack = 0.045, shimmer = 0.18, when = 0 } = opts;
  const t0 = ac.currentTime + when;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  // Soft "felt piano" voice: pure fundamental + a quiet octave shimmer.
  const fundamental = ac.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  const partial = ac.createOscillator();
  partial.type = 'triangle';
  partial.frequency.value = freq * 2;
  const partialGain = ac.createGain();
  partialGain.gain.value = shimmer;
  fundamental.connect(env);
  partial.connect(partialGain).connect(env);
  env.connect(dest);
  fundamental.start(t0);
  partial.start(t0);
  fundamental.stop(t0 + dur + 0.1);
  partial.stop(t0 + dur + 0.1);
}

function stepToFreq(step: number, track: AmbientTrack, base: number): number {
  const semitone = (track.scale[step % track.scale.length] ?? 0) + 12 * Math.floor(step / track.scale.length);
  return base * Math.pow(2, semitone / 12);
}

function ambientTick(): void {
  if (!ambientNodes || !ctx) return;
  const state = ambientNodes;
  const track = TRACKS[state.trackId];
  // Random walk, biased to small steps — melody without aimlessness.
  const drift = Math.random() < 0.72 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
  state.step = Math.min(track.steps - 1, Math.max(0, state.step + drift));
  const peak = (0.08 + Math.random() * 0.05) * track.peak;
  playPadNote(ctx, state.bus, stepToFreq(state.step, track, state.base), peak,
    track.duration[0] + Math.random() * (track.duration[1] - track.duration[0]));
  // Occasional harmony a scale step or two above.
  if (Math.random() < track.harmonyChance) {
    const hStep = Math.min(track.steps - 1, state.step + (Math.random() < 0.5 ? 2 : 3));
    playPadNote(ctx, state.bus, stepToFreq(hStep, track, state.base), peak * 0.7,
      track.duration[0], { when: 0.06 });
  }
  // Theme signature textures.
  if (track.texture === 'shimmer' && Math.random() < 0.3) {
    // A distant twinkle: high octave, slow swell.
    playPadNote(ctx, state.bus, stepToFreq(state.step, track, state.base) * 2,
      peak * 0.35, 3, { attack: 0.5, shimmer: 0.3, when: 0.3 });
  } else if (track.texture === 'sub' && Math.random() < 0.3) {
    // A deep swell underneath, like distant water.
    playPadNote(ctx, state.bus, state.base / 2, 0.055, 6, { attack: 1.4, shimmer: 0.05, when: 0.2 });
  } else if (track.texture === 'airy' && Math.random() < 0.3) {
    // An open fifth held softly — thin mountain air.
    playPadNote(ctx, state.bus, stepToFreq(state.step, track, state.base) * 1.5,
      peak * 0.3, 4, { attack: 0.8, shimmer: 0.08, when: 0.15 });
  }
  // Low root anchor for the harmony.
  if (Math.random() < 0.14) {
    playPadNote(ctx, state.bus, state.base / 2, 0.06, 5, { shimmer: 0.05, when: 0.1 });
  }
  state.timer = window.setTimeout(ambientTick,
    (track.tempo[0] + Math.random() * (track.tempo[1] - track.tempo[0])) * 1000);
}

/** Match the music's register to the resolved theme. Takes effect from the
 *  next note. */
export function setAmbientTheme(dark: boolean): void {
  if (!ambientNodes) return;
  const track = TRACKS[ambientNodes.trackId];
  ambientNodes.base = dark ? track.baseDark : track.baseLight;
}

/** Register/unregister host-side audio playback (e.g. a plugin's clip
 *  player). While active, the ambient music stands down entirely so the two
 *  never talk over each other; when playback ends, the music resumes. */
export function setHostAudioActive(active: boolean): void {
  if (hostAudioActive === active) return;
  hostAudioActive = active;
  if (active) {
    stopAmbient();
  } else if (config.enabled && ambientWanted) {
    startAmbient();
  }
}

export function startAmbient(): void {
  if (ambientNodes || hostAudioActive) return;
  const ac = ensureContext();
  if (!ac || !master) return;
  const trackId = (AMBIENT_TRACK_IDS.includes(config.ambientTrack as AmbientTrackId)
    ? config.ambientTrack : 'starfield') as AmbientTrackId;
  const track = TRACKS[trackId];
  const bus = ac.createGain();
  bus.gain.value = 0.0001;
  // Note peaks are ~0.1; through this bus and master the effective level is
  // a quiet background music — clearly audible, easy to ignore.
  bus.gain.setTargetAtTime(0.9 * (config.volume / 100), ac.currentTime, 1.2);
  // Space: dry path + a warm feedback-delay tail (the "concert hall distance").
  const delay = ac.createDelay(2);
  delay.delayTime.value = track.space[0];
  const feedback = ac.createGain();
  feedback.gain.value = track.space[1];
  const wet = ac.createGain();
  wet.gain.value = track.space[2];
  bus.connect(master);
  bus.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(master);
  let base: number;
  try {
    base = document.documentElement.dataset.theme === 'light' ? track.baseLight : track.baseDark;
  } catch {
    base = track.baseDark;
  }
  ambientNodes = { bus, timer: 0, trackId, step: Math.floor(track.steps / 2), base };
  ambientTick();
}

export function stopAmbient(): void {
  if (!ctx || !ambientNodes) return;
  const { bus, timer } = ambientNodes;
  ambientNodes = null;
  window.clearTimeout(timer);
  bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  // Notes and delay tails self-terminate; the bus node is garbage-collected
  // once every connected voice has stopped.
  window.setTimeout(() => {
    try {
      bus.disconnect();
    } catch {
      /* already disconnected */
    }
  }, 8000);
}

export function isAmbientRunning(): boolean {
  return ambientNodes !== null;
}

// ---- global interaction sounds -------------------------------------------------

let installed = false;

/** Delegated click/change sounds: one capture-phase listener covers every
 *  button in the app without touching each component. Toggle-like controls
 *  (aria-pressed, mode buttons) get the two-tone pop instead of the tick. */
export function installInteractionSounds(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLElement>('button, [role="button"]');
      if (!btn || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') return;
      const isToggle =
        btn.hasAttribute('aria-pressed') || btn.classList.contains('mode-btn') || btn.classList.contains('settings-nav-item');
      playCue(isToggle ? 'toggle' : 'click');
    },
    true,
  );
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'SELECT') playCue('toggle');
    },
    true,
  );
}
