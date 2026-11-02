// ==========================================================================
// Ambience system — data model (XP rules, levels, badge definitions).
// Pure TS: no store imports, no React. Everything here is serializable and
// lives in localStorage under 'ergalics:ambience'.
// ==========================================================================

/** Why XP was granted. Maps 1:1 to the award hooks in engine.ts. */
export type XpReason =
  | 'daily_login'
  | 'run_completed'
  | 'run_failed_attempt'
  | 'data_ingested'
  | 'notebook_executed'
  | 'figure_exported'
  | 'plugin_first_use'
  | 'tour_completed'
  | 'streak_bonus';

/** XP granted per reason. `run_failed_attempt` keeps failed runs feeling
 *  like progress instead of punishment (spec: only attempt credit). */
export const XP_RULES: Record<XpReason, number> = {
  daily_login: 10,
  run_completed: 15,
  run_failed_attempt: 5,
  data_ingested: 10,
  notebook_executed: 10,
  figure_exported: 10,
  plugin_first_use: 25,
  tour_completed: 30,
  streak_bonus: 5,
};

/** Same-reason awards are rate-limited to one per window to keep XP from
 *  being farmable by rapid re-runs. */
export const XP_RATE_LIMIT_MS = 60_000;

/** Level ladder. Level n → n+1 costs 80 + (n-1)*40 XP, a gentle ramp that
 *  keeps the first levels reachable within minutes. */
export function xpForNextLevel(level: number): number {
  return 80 + (level - 1) * 40;
}

/** Cumulative XP required to *reach* a level (level 1 starts at 0). */
export function xpToReach(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpForNextLevel(n);
  return total;
}

/** Resolve level + progress inside the level from a total XP value. */
export function levelFromXp(xp: number): { level: number; into: number; span: number } {
  let level = 1;
  let remaining = xp;
  for (;;) {
    const span = xpForNextLevel(level);
    if (remaining < span) return { level, into: remaining, span };
    remaining -= span;
    level++;
    if (level > 99) return { level: 99, into: remaining, span };
  }
}

/** Academic rank titles, shown every 3 levels. Keys resolve via i18n. */
export function rankKeyForLevel(level: number): string {
  if (level >= 13) return 'ambience.rank.chief';
  if (level >= 10) return 'ambience.rank.senior';
  if (level >= 7) return 'ambience.rank.researcher';
  if (level >= 4) return 'ambience.rank.assistant';
  return 'ambience.rank.junior';
}

// ---- badges ----------------------------------------------------------------

export type BadgeId =
  | 'first-spark'
  | 'pathfinder'
  | 'data-hand'
  | 'first-run'
  | 'five-day'
  | 'hundred-forge'
  | 'panorama'
  | 'rigor'
  | 'coupling'
  | 'thirty-laurel'
  | 'night-owl'
  | 'xp-master';

/** Events the badge checker reacts to. Decoupled from XpReason so a badge
 *  can key off richer payloads (run source, hour of day…). */
export interface BadgeTrigger {
  runs: number;
  /** Recent run metadata (only set on run-completed events). */
  lastRun?: { source: string; usedInputFiles: boolean; hour: number };
  ingests: number;
  streak: number;
  usedPlugins: string[];
  /** Distinct research sources seen (drives the "panorama" badge). */
  runSources: string[];
  xp: number;
  tourCompleted: boolean;
}

export interface BadgeDef {
  id: BadgeId;
  nameKey: string;
  descKey: string;
  /** Rarity only affects the wall card's rim color, nothing else. */
  rarity: 'common' | 'rare' | 'epic';
  /** HD original served from public/ (kept for the future download/share
   *  feature); the UI uses the bundled 512px copy. */
  hdPath: string;
  check: (t: BadgeTrigger) => boolean;
}

const HD_BASE = `${import.meta.env.BASE_URL}badges-hd/`;

// 512px UI copies are bundled (small, ~23KB each); the 1920px originals stay
// in public/ and are only fetched when a user downloads/shares a badge.
const UI_IMAGES = import.meta.glob<{ default: string }>('../../assets/badges/badge-*.jpg', {
  eager: true,
});

function uiImage(id: BadgeId): string {
  const entry = UI_IMAGES[`../../assets/badges/badge-${id}.jpg`];
  return entry?.default ?? '';
}

const BADGE_DEFS: Array<Omit<BadgeDef, 'hdPath'>> = [
  { id: 'first-spark', rarity: 'common', nameKey: 'badges.first-spark.name', descKey: 'badges.first-spark.desc',
    check: (t) => t.xp > 0 },
  { id: 'pathfinder', rarity: 'common', nameKey: 'badges.pathfinder.name', descKey: 'badges.pathfinder.desc',
    check: (t) => t.tourCompleted },
  { id: 'data-hand', rarity: 'common', nameKey: 'badges.data-hand.name', descKey: 'badges.data-hand.desc',
    check: (t) => t.ingests >= 1 },
  { id: 'first-run', rarity: 'common', nameKey: 'badges.first-run.name', descKey: 'badges.first-run.desc',
    check: (t) => t.runs >= 1 },
  { id: 'five-day', rarity: 'rare', nameKey: 'badges.five-day.name', descKey: 'badges.five-day.desc',
    check: (t) => t.streak >= 5 },
  { id: 'hundred-forge', rarity: 'rare', nameKey: 'badges.hundred-forge.name', descKey: 'badges.hundred-forge.desc',
    check: (t) => t.runs >= 20 },
  { id: 'panorama', rarity: 'epic', nameKey: 'badges.panorama.name', descKey: 'badges.panorama.desc',
    check: (t) => t.runSources.length >= 5 },
  { id: 'rigor', rarity: 'rare', nameKey: 'badges.rigor.name', descKey: 'badges.rigor.desc',
    check: (t) => t.lastRun != null && ['uncertainty', 'inference', 'model'].includes(t.lastRun.source) },
  { id: 'coupling', rarity: 'rare', nameKey: 'badges.coupling.name', descKey: 'badges.coupling.desc',
    check: (t) => t.lastRun != null && t.lastRun.usedInputFiles },
  { id: 'thirty-laurel', rarity: 'epic', nameKey: 'badges.thirty-laurel.name', descKey: 'badges.thirty-laurel.desc',
    check: (t) => t.streak >= 30 },
  { id: 'night-owl', rarity: 'common', nameKey: 'badges.night-owl.name', descKey: 'badges.night-owl.desc',
    check: (t) => t.lastRun != null && (t.lastRun.hour >= 0 && t.lastRun.hour < 5) },
  { id: 'xp-master', rarity: 'epic', nameKey: 'badges.xp-master.name', descKey: 'badges.xp-master.desc',
    check: (t) => t.xp >= 2500 },
];

export const BADGES: BadgeDef[] = BADGE_DEFS.map((d) => ({
  ...d,
  hdPath: `${HD_BASE}badge-${d.id}.jpg`,
}));

export function badgeUiImage(id: BadgeId): string {
  return uiImage(id);
}

// ---- persistence shape ------------------------------------------------------

export interface AmbienceSettings {
  soundEnabled: boolean;
  ambientEnabled: boolean;
  /** 0–100. */
  volume: number;
  motion: 'full' | 'reduced' | 'off';
  /** Master switch for XP + badges (progress keeps accumulating silently). */
  rewardsEnabled: boolean;
}

export interface AmbienceProgress {
  xp: number;
  streak: number;
  /** Local date string (YYYY-MM-DD) of the last daily-login award. */
  lastActiveDate: string;
  /** Badge id → unlock timestamp (epoch ms). */
  badges: Partial<Record<BadgeId, number>>;
  usedPlugins: string[];
  runSources: string[];
  counters: { runs: number; ingests: number };
  flags: { tourRewarded?: boolean; soundHintShown?: boolean };
}

export const DEFAULT_SETTINGS: AmbienceSettings = {
  soundEnabled: true,
  ambientEnabled: false,
  volume: 70,
  motion: 'full',
  rewardsEnabled: true,
};

export const DEFAULT_PROGRESS: AmbienceProgress = {
  xp: 0,
  streak: 0,
  lastActiveDate: '',
  badges: {},
  usedPlugins: [],
  runSources: [],
  counters: { runs: 0, ingests: 0 },
  flags: {},
};
