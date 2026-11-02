// Ergalics Studio — ambience store (sound / motion / XP / badges)
//
// Owns every piece of ambience state:
//  - settings (persisted): sound, ambient pad, volume, motion mode, rewards
//  - progress (persisted): XP, streak, unlocked badges, usage counters
//  - transient UI: XP floats, level-up overlay, badge unlock queue, bursts
//
// Persistence follows the project convention (manual localStorage read/write,
// key 'ergalics:ambience') rather than the persist middleware. A storage
// failure degrades to an in-memory session, never a crash.

import { create } from 'zustand';
import {
  BADGES,
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  XP_RATE_LIMIT_MS,
  XP_RULES,
  levelFromXp,
  rankKeyForLevel,
  type AmbienceProgress,
  type AmbienceSettings,
  type BadgeId,
  type BadgeTrigger,
  type XpReason,
} from '@/core/ambience/model';
import {
  configureAudio,
  playCue,
  startAmbient,
  stopAmbient,
} from '@/core/ambience/audio';
import { logger } from '@/core/logger';

const STORAGE_KEY = 'ergalics:ambience';

interface XpFloat {
  id: number;
  amount: number;
}

interface LevelUpCard {
  level: number;
  rankKey: string;
}

interface AmbienceStore {
  settings: AmbienceSettings;
  progress: AmbienceProgress;
  // transient
  floats: XpFloat[];
  levelUp: LevelUpCard | null;
  badgeQueue: BadgeId[];
  /** Increment-only id; AmbienceLayer plays a particle burst when it changes. */
  burstId: number;

  setSoundEnabled: (v: boolean) => void;
  setAmbientEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  setMotion: (v: AmbienceSettings['motion']) => void;
  setRewardsEnabled: (v: boolean) => void;
  markWallSeen: () => void;

  /** Award XP for a reason. Handles rate limiting, level-ups and UI feedback.
   *  Returns the granted amount (0 when suppressed). */
  awardXp: (reason: XpReason) => number;
  /** Run the badge checker against the current progress snapshot. Newly
   *  earned badges are queued for the unlock toast and announced. */
  checkBadges: (extra?: Partial<BadgeTrigger>) => void;
  dismissLevelUp: () => void;
  dequeueBadge: (id: BadgeId) => void;
  /** Export/import the whole ambience blob (settings + progress). */
  exportProgress: () => string;
  importProgress: (json: string) => boolean;
}

let floatId = 0;
/** Timestamps of the last award per reason (rate limiting). */
const lastAwardAt = new Map<XpReason, number>();

function loadPersisted(): { settings: AmbienceSettings; progress: AmbienceProgress } {
  const fallback = { settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      settings?: Partial<AmbienceSettings>;
      progress?: Partial<AmbienceProgress>;
    };
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      progress: {
        ...DEFAULT_PROGRESS,
        ...(parsed.progress ?? {}),
        badges: { ...(parsed.progress?.badges ?? {}) },
        usedPlugins: parsed.progress?.usedPlugins ?? [],
        runSources: parsed.progress?.runSources ?? [],
        counters: { ...DEFAULT_PROGRESS.counters, ...(parsed.progress?.counters ?? {}) },
        flags: { ...(parsed.progress?.flags ?? {}) },
      },
    };
  } catch {
    return fallback;
  }
}

function persist(get: () => AmbienceStore): void {
  try {
    const { settings, progress } = get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, progress }));
  } catch {
    /* private mode — ambience simply does not persist */
  }
}

/** Apply non-reactive side effects of a settings change: audio engine config,
 *  ambient pad lifecycle and the [data-motion] hook used by CSS. */
function applySideEffects(settings: AmbienceSettings): void {
  configureAudio({ enabled: settings.soundEnabled, volume: settings.volume });
  if (settings.soundEnabled && settings.ambientEnabled) startAmbient();
  else stopAmbient();
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.motion = settings.motion;
  }
}

const persisted = loadPersisted();

export const useAmbienceStore = create<AmbienceStore>((set, get) => ({
  settings: persisted.settings,
  progress: persisted.progress,
  floats: [],
  levelUp: null,
  badgeQueue: [],
  burstId: 0,

  setSoundEnabled: (v) => {
    set((s) => ({ settings: { ...s.settings, soundEnabled: v } }));
    applySideEffects(get().settings);
    persist(get);
  },
  setAmbientEnabled: (v) => {
    set((s) => ({ settings: { ...s.settings, ambientEnabled: v } }));
    applySideEffects(get().settings);
    persist(get);
  },
  setVolume: (v) => {
    set((s) => ({ settings: { ...s.settings, volume: v } }));
    applySideEffects(get().settings);
    persist(get);
  },
  setMotion: (v) => {
    set((s) => ({ settings: { ...s.settings, motion: v } }));
    applySideEffects(get().settings);
    persist(get);
  },
  setRewardsEnabled: (v) => {
    set((s) => ({ settings: { ...s.settings, rewardsEnabled: v } }));
    persist(get);
  },
  markWallSeen: () => {
    set((s) => ({ progress: { ...s.progress, flags: { ...s.progress.flags, wallSeen: true } } }));
    persist(get);
  },

  awardXp: (reason) => {
    if (!get().settings.rewardsEnabled) return 0;
    // Rate limit identical reasons so rapid re-runs are not farmable.
    const now = Date.now();
    if (now - (lastAwardAt.get(reason) ?? 0) < XP_RATE_LIMIT_MS) return 0;
    lastAwardAt.set(reason, now);
    const amount = XP_RULES[reason];
    if (amount <= 0) return 0;

    const before = levelFromXp(get().progress.xp).level;
    const xp = get().progress.xp + amount;
    set((s) => ({
      progress: { ...s.progress, xp },
      floats: [...s.floats, { id: ++floatId, amount }],
    }));

    const after = levelFromXp(xp);
    if (after.level > before) {
      set({ levelUp: { level: after.level, rankKey: rankKeyForLevel(after.level) }, burstId: get().burstId + 1 });
      playCue('badge');
    } else {
      playCue('xp');
    }
    persist(get);
    // Prune the float after its animation window so the list never grows.
    const id = floatId;
    window.setTimeout(() => {
      set((s) => ({ floats: s.floats.filter((f) => f.id !== id) }));
    }, 1900);
    return amount;
  },

  checkBadges: (extra) => {
    if (!get().settings.rewardsEnabled) return;
    const p = get().progress;
    const trigger: BadgeTrigger = {
      runs: p.counters.runs,
      ingests: p.counters.ingests,
      streak: p.streak,
      usedPlugins: p.usedPlugins,
      runSources: p.runSources,
      xp: p.xp,
      tourCompleted: Boolean(p.flags.tourRewarded),
      ...extra,
    };
    const earned: BadgeId[] = [];
    for (const badge of BADGES) {
      if (p.badges[badge.id]) continue;
      try {
        if (badge.check(trigger)) earned.push(badge.id);
      } catch (err) {
        logger.error('ambience', 'badge check failed', err);
      }
    }
    if (earned.length === 0) return;
    const now = Date.now();
    set((s) => {
      const badges = { ...s.progress.badges };
      for (const id of earned) badges[id] = now;
      return {
        progress: { ...s.progress, badges },
        badgeQueue: [...s.badgeQueue, ...earned.filter((id) => !s.badgeQueue.includes(id))],
      };
    });
    persist(get);
  },

  dismissLevelUp: () => set({ levelUp: null }),

  dequeueBadge: (id) =>
    set((s) => ({ badgeQueue: s.badgeQueue.filter((b) => b !== id) })),

  exportProgress: () => {
    const { settings, progress } = get();
    return JSON.stringify({ app: 'ergalics-studio', kind: 'ambience', settings, progress }, null, 2);
  },

  importProgress: (json) => {
    try {
      const parsed = JSON.parse(json) as {
        settings?: Partial<AmbienceSettings>;
        progress?: Partial<AmbienceProgress>;
      };
      if (!parsed || typeof parsed !== 'object' || typeof parsed.progress?.xp !== 'number') return false;
      set((s) => ({
        settings: { ...s.settings, ...(parsed.settings ?? {}) },
        progress: {
          ...DEFAULT_PROGRESS,
          ...parsed.progress,
          badges: { ...(parsed.progress?.badges ?? {}) },
          usedPlugins: parsed.progress?.usedPlugins ?? [],
          runSources: parsed.progress?.runSources ?? [],
          counters: { ...DEFAULT_PROGRESS.counters, ...(parsed.progress?.counters ?? {}) },
          flags: { ...(parsed.progress?.flags ?? {}) },
        },
      }));
      applySideEffects(get().settings);
      persist(get);
      return true;
    } catch {
      return false;
    }
  },
}));

// Sync the audio engine + motion attribute with the loaded settings on boot.
applySideEffects(persisted.settings);
