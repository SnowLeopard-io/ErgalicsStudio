import { LOCALES, type Locale } from '@/i18n/types';
import type { ThemePreference } from '@/theme';

export interface SettingsState {
  locale: Locale;
  theme: ThemePreference;
  autoSaveInterval: number; // ms; 0 = off
  gpuBackend: 'auto' | 'cpu-fallback';
  memoryLimit: 'auto' | 512 | 1024 | 2048; // MB
}

export const DEFAULT_SETTINGS: SettingsState = {
  locale: 'zh-CN',
  theme: 'system',
  autoSaveInterval: 60_000,
  gpuBackend: 'auto',
  memoryLimit: 'auto',
};

const STORAGE_KEY = 'ergalics:settings';

const MEMORY_LIMITS: ReadonlyArray<SettingsState['memoryLimit']> = ['auto', 512, 1024, 2048];

/** Field-by-field validation of persisted settings. localStorage can be
 *  corrupted or hand-edited, and a garbage value (locale: 123, theme:
 *  "neon") must fall back to the default instead of propagating into the
 *  app and crashing the theme/locale code paths. */
function sanitizeSettings(raw: unknown): SettingsState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const input = raw as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };

  if (LOCALES.some((l) => l.code === input.locale)) out.locale = input.locale as Locale;
  if (input.theme === 'light' || input.theme === 'dark' || input.theme === 'system') {
    out.theme = input.theme;
  }
  if (typeof input.autoSaveInterval === 'number' && Number.isFinite(input.autoSaveInterval) && input.autoSaveInterval >= 0) {
    out.autoSaveInterval = input.autoSaveInterval;
  }
  if (input.gpuBackend === 'auto' || input.gpuBackend === 'cpu-fallback') {
    out.gpuBackend = input.gpuBackend;
  }
  if (MEMORY_LIMITS.includes(input.memoryLimit as SettingsState['memoryLimit'])) {
    out.memoryLimit = input.memoryLimit as SettingsState['memoryLimit'];
  }
  return out;
}

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function persistLegacyPrefs(settings: SettingsState): void {
  try {
    localStorage.setItem('ergalics:lang', settings.locale);
    localStorage.setItem('ergalics:theme', settings.theme);
  } catch {
    /* ignore */
  }
}
