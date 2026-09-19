// ==========================================================================
// FR-21 theme market — official theme catalog + installed-theme persistence
//
// Official themes ship as compiled-in data (always available, never
// uninstallable). User-installed themes (from the market or a .cstheme
// import) persist under `ergalics:themes:installed`; every read re-runs
// parseCsTheme() so a hand-edited or corrupted store can never smuggle
// unsafe values into the style layer (same defense as core/settings.ts).
//
// The *applied* theme id persists alongside the list so a reload restores
// the user's choice; restoreAppliedTheme() re-applies it at boot.
// ==========================================================================

import { parseCsTheme, type CsTheme } from './schema';
import { applyTheme, removeTheme } from './apply';

export const INSTALLED_THEMES_KEY = 'ergalics:themes:installed';

// ---------------------------------------------------------------------------
// Official themes
// ---------------------------------------------------------------------------

/** `journal` — 期刊科研风：衬线字体、克制的墨蓝强调色与紧凑的图表配色。
 *  Aligned with the website catalog entry `journal-serif`. */
export const JOURNAL_THEME: CsTheme = {
  id: 'journal',
  name: 'Journal Two-Column',
  version: '1.1.0',
  description: 'Serif type, paper-white surfaces and a restrained ink-blue accent — built for long writing and reviewing sessions.',
  author: 'Ergalics Official',
  font: { family: "'Source Serif 4', 'Georgia', 'Songti SC', serif" },
  // "Two-column journal density": slightly tighter spacing + leading suited
  // to long-form reading; the compact mode drives the spacing scale.
  density: 'compact',
  chartPalette: ['#1f4e79', '#c0504d', '#9bbf30', '#f79646', '#4f81bd'],
  tokens: {
    light: {
      '--color-bg-primary': '#fbfaf7',
      '--color-bg-secondary': '#f3f0e9',
      '--color-bg-tertiary': '#eae6dc',
      '--color-bg-elevated': '#ffffff',
      '--color-bg-hover': '#f0ece3',
      '--color-bg-active': '#e2ddd0',
      '--color-text-primary': '#1c1b1a',
      '--color-text-secondary': '#5d5750',
      '--color-text-tertiary': '#7a736a',
      '--color-text-inverse': '#ffffff',
      '--color-text-disabled': '#aca69c',
      '--color-border': '#e3ddd2',
      '--color-border-hover': '#cfc7b8',
      '--color-border-strong': '#a89f90',
      '--color-accent': '#1f4e79',
      '--color-accent-hover': '#163a5c',
      '--color-accent-active': '#10304c',
      '--color-accent-soft': 'rgba(31, 78, 121, 0.12)',
      '--color-accent-text': '#1a4d78',
    },
    dark: {
      '--color-bg-primary': '#12100d',
      '--color-bg-secondary': '#191612',
      '--color-bg-tertiary': '#211d17',
      '--color-bg-elevated': '#1c1915',
      '--color-bg-hover': '#27221a',
      '--color-bg-active': '#322b21',
      '--color-text-primary': '#ece7dd',
      '--color-text-secondary': '#b6ae9f',
      '--color-text-tertiary': '#938a79',
      '--color-text-inverse': '#12100d',
      '--color-text-disabled': '#6b6354',
      '--color-border': '#2f2a23',
      '--color-border-hover': '#474034',
      '--color-border-strong': '#6b6354',
      '--color-accent': '#7ba7cc',
      '--color-accent-hover': '#9dc0dd',
      '--color-accent-active': '#5f8fc0',
      '--color-accent-soft': 'rgba(123, 167, 204, 0.16)',
      '--color-accent-text': '#9dc0dd',
    },
  },
};

/** `edu` — 教育风格：最大化对比度、加大字号，适合投影授课与无障碍场景。
 *  Aligned with the website catalog entry `classroom-high-contrast`. */
export const EDU_THEME: CsTheme = {
  id: 'edu',
  name: 'Classroom High-Contrast',
  version: '1.1.0',
  description: 'Large type, bold outlines and maximum contrast — made for projector teaching and accessibility.',
  author: 'Ergalics Official',
  // ~15% larger type across the whole scale.
  font: { scale: 1.15 },
  density: 'comfortable',
  chartPalette: ['#0b57d0', '#d93025', '#e37400', '#137333', '#7627bb'],
  tokens: {
    light: {
      '--color-bg-primary': '#ffffff',
      '--color-bg-secondary': '#f2f2f2',
      '--color-bg-tertiary': '#e6e6e6',
      '--color-bg-elevated': '#ffffff',
      '--color-bg-hover': '#ececec',
      '--color-bg-active': '#dedede',
      '--color-text-primary': '#000000',
      '--color-text-secondary': '#1a1a1a',
      '--color-text-tertiary': '#333333',
      '--color-text-inverse': '#ffffff',
      '--color-text-disabled': '#555555',
      '--color-border': '#000000',
      '--color-border-hover': '#333333',
      '--color-border-strong': '#000000',
      '--color-accent': '#0b57d0',
      '--color-accent-hover': '#073889',
      '--color-accent-active': '#0a4cb8',
      '--color-accent-soft': 'rgba(11, 87, 208, 0.16)',
      '--color-accent-text': '#0b57d0',
    },
    dark: {
      '--color-bg-primary': '#000000',
      '--color-bg-secondary': '#111111',
      '--color-bg-tertiary': '#1e1e1e',
      '--color-bg-elevated': '#0d0d0d',
      '--color-bg-hover': '#1f1f1f',
      '--color-bg-active': '#2e2e2e',
      '--color-text-primary': '#ffffff',
      '--color-text-secondary': '#e6e6e6',
      '--color-text-tertiary': '#c4c4c4',
      '--color-text-inverse': '#000000',
      '--color-text-disabled': '#888888',
      '--color-border': '#ffffff',
      '--color-border-hover': '#cccccc',
      '--color-border-strong': '#ffffff',
      '--color-accent': '#8ab4f8',
      '--color-accent-hover': '#b3cdfb',
      '--color-accent-active': '#6f9fe8',
      '--color-accent-soft': 'rgba(138, 180, 248, 0.18)',
      '--color-accent-text': '#b3cdfb',
    },
  },
};

export const OFFICIAL_THEMES: readonly CsTheme[] = Object.freeze([JOURNAL_THEME, EDU_THEME]);

export function getOfficialTheme(id: string): CsTheme | undefined {
  return OFFICIAL_THEMES.find((t) => t.id === id);
}

export function isOfficialThemeId(id: string): boolean {
  return OFFICIAL_THEMES.some((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Persistence (localStorage, defensive like core/settings.ts)
// ---------------------------------------------------------------------------

interface InstalledStore {
  themes: CsTheme[];
  appliedId: string | null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function emptyStore(): InstalledStore {
  return { themes: [], appliedId: null };
}

/** Re-validate every persisted record; garbage entries are dropped, not
 *  trusted. An unreadable store degrades to "nothing installed". */
function readStore(): InstalledStore {
  const store = storage();
  if (!store) return emptyStore();
  try {
    const raw = store.getItem(INSTALLED_THEMES_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return emptyStore();
    const input = parsed as Record<string, unknown>;
    const out = emptyStore();
    if (Array.isArray(input.themes)) {
      for (const candidate of input.themes) {
        try {
          const theme = parseCsTheme(candidate);
          if (!isOfficialThemeId(theme.id) && !out.themes.some((t) => t.id === theme.id)) {
            out.themes.push(theme);
          }
        } catch {
          /* drop invalid record */
        }
      }
    }
    if (typeof input.appliedId === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input.appliedId)) {
      out.appliedId = input.appliedId;
    }
    return out;
  } catch {
    return emptyStore();
  }
}

function writeStore(next: InstalledStore): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(INSTALLED_THEMES_KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — in-memory state still correct for the session */
  }
}

/** User-installed (non-official) themes. */
export function listInstalledThemes(): CsTheme[] {
  return readStore().themes;
}

/** Official + installed, for lookups by id. */
export function findThemeById(id: string): CsTheme | undefined {
  return getOfficialTheme(id) ?? readStore().themes.find((t) => t.id === id);
}

/** Install (or update-in-place) a theme. Official ids cannot shadow the
 *  built-in copies — installing one is a no-op that just marks it applied
 *  elsewhere. Throws if the theme fails re-validation. */
export function installTheme(theme: CsTheme): CsTheme {
  const validated = parseCsTheme(theme);
  if (isOfficialThemeId(validated.id)) return validated;
  const store = readStore();
  const idx = store.themes.findIndex((t) => t.id === validated.id);
  if (idx >= 0) store.themes[idx] = validated;
  else store.themes.push(validated);
  writeStore(store);
  return validated;
}

/** Uninstall a user theme; if it is currently applied, the applied marker
 *  is cleared too (the caller decides whether to also removeTheme()). */
export function uninstallTheme(id: string): boolean {
  if (isOfficialThemeId(id)) return false;
  const store = readStore();
  const before = store.themes.length;
  store.themes = store.themes.filter((t) => t.id !== id);
  if (store.appliedId === id) store.appliedId = null;
  if (store.themes.length === before) return false;
  writeStore(store);
  return true;
}

// ---------------------------------------------------------------------------
// Applied-theme marker
// ---------------------------------------------------------------------------

export function getAppliedThemeId(): string | null {
  const store = readStore();
  return store.appliedId;
}

export function setAppliedThemeId(id: string | null): void {
  const store = readStore();
  store.appliedId = id;
  writeStore(store);
}

/** Apply a theme and persist the choice. */
export function applyAndRemember(theme: CsTheme): void {
  applyTheme(theme);
  setAppliedThemeId(theme.id);
}

/** Remove the layer and forget the choice. */
export function clearAppliedTheme(): void {
  removeTheme();
  setAppliedThemeId(null);
}

/** Re-apply the persisted theme after boot. Returns the theme id restored,
 *  or null when nothing (or an unknown theme) was persisted. Unknown ids
 *  self-heal by clearing the stale marker. */
export function restoreAppliedTheme(): string | null {
  const id = getAppliedThemeId();
  if (!id) return null;
  const theme = findThemeById(id);
  if (!theme) {
    setAppliedThemeId(null);
    return null;
  }
  applyTheme(theme);
  return id;
}
