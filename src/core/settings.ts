import { LOCALES, type Locale } from '@/i18n/types';
import type { ThemePreference } from '@/theme';

export interface SettingsState {
  locale: Locale;
  theme: ThemePreference;
  autoSaveInterval: number; // ms; 0 = off
  gpuBackend: 'auto' | 'cpu-fallback';
  memoryLimit: 'auto' | 512 | 1024 | 2048; // MB
  /** FR-16: parse worker pool size ('auto' = cores capped at 4). */
  workerPoolSize: 'auto' | 1 | 2 | 4 | 8;
  /** FR-16: rows per ingestion chunk ('auto' = 50_000). */
  chunkRows: 'auto' | 1000 | 10000 | 50000;
}

export const DEFAULT_SETTINGS: SettingsState = {
  locale: 'zh-CN',
  theme: 'system',
  autoSaveInterval: 60_000,
  gpuBackend: 'auto',
  memoryLimit: 'auto',
  workerPoolSize: 'auto',
  chunkRows: 'auto',
};

/** Effective chunk size when the user picked 'auto'. */
export const AUTO_CHUNK_ROWS = 50_000;

export function resolveChunkRows(setting: SettingsState['chunkRows']): number {
  return setting === 'auto' ? AUTO_CHUNK_ROWS : setting;
}

const STORAGE_KEY = 'ergalics:settings';

const MEMORY_LIMITS: ReadonlyArray<SettingsState['memoryLimit']> = ['auto', 512, 1024, 2048];
const POOL_SIZES: ReadonlyArray<SettingsState['workerPoolSize']> = ['auto', 1, 2, 4, 8];
const CHUNK_ROWS: ReadonlyArray<SettingsState['chunkRows']> = ['auto', 1000, 10000, 50000];

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
  if (POOL_SIZES.includes(input.workerPoolSize as SettingsState['workerPoolSize'])) {
    out.workerPoolSize = input.workerPoolSize as SettingsState['workerPoolSize'];
  }
  if (CHUNK_ROWS.includes(input.chunkRows as SettingsState['chunkRows'])) {
    out.chunkRows = input.chunkRows as SettingsState['chunkRows'];
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
