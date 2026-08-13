import type { Locale } from '@/i18n/types';
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

export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
