// ==========================================================================
// Ambience audio — procedural Web Audio cues + an optional ambient pad.
// No audio files: every cue is synthesized (oscillator + gain envelope), so
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
}

const config: AudioConfig = { enabled: true, volume: 70 };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// Ambient pad state (kept module-level so start/stop are idempotent).
let ambientNodes: { oscs: OscillatorNode[]; lfo: OscillatorNode; gain: GainNode } | null = null;

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

// ---- ambient pad -------------------------------------------------------------

/** Match the pad's timbre to the resolved theme: darker/warmer in dark mode,
 *  brighter and airier in light mode. */
export function setAmbientTheme(dark: boolean): void {
  if (!ctx || !ambientNodes) return;
  ambientNodes.oscs.forEach((o, i) => {
    const base = dark ? 110 : 146.83; // A2 vs D3
    o.frequency.setTargetAtTime(base * (i === 1 ? 1.005 : 1), ctx!.currentTime, 0.4);
  });
}

export function startAmbient(): void {
  if (!config.enabled || !config.ambientEnabled || ambientNodes) return;
  const ac = ensureContext();
  if (!ac || !master) return;
  const gain = ac.createGain();
  gain.gain.value = 0.0001;
  gain.gain.setTargetAtTime(0.05 * (config.volume / 100), ac.currentTime, 1.2);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 0.5;
  // Slow LFO breathing on the filter — the "distant room tone" feel.
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain).connect(filter.frequency);
  const oscs = [0, 1].map((i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = i === 1 ? 110.55 : 110;
    o.connect(filter);
    o.start();
    return o;
  });
  const harmonic = ac.createOscillator();
  harmonic.type = 'sine';
  harmonic.frequency.value = 220;
  const harmonicGain = ac.createGain();
  harmonicGain.gain.value = 0.25;
  harmonic.connect(harmonicGain).connect(filter);
  harmonic.start();
  oscs.push(harmonic);
  filter.connect(gain).connect(master);
  lfo.start();
  ambientNodes = { oscs, lfo, gain };
}

export function stopAmbient(): void {
  if (!ctx || !ambientNodes) return;
  const { oscs, lfo, gain } = ambientNodes;
  ambientNodes = null;
  const t = ctx.currentTime;
  gain.gain.setTargetAtTime(0.0001, t, 0.4);
  window.setTimeout(() => {
    oscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    try {
      lfo.stop();
    } catch {
      /* already stopped */
    }
  }, 1600);
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
