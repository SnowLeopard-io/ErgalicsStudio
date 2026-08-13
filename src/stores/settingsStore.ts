import { create } from 'zustand';
import type { SettingsState } from '@/core/settings';
import { loadSettings, saveSettings, persistLegacyPrefs } from '@/core/settings';
import { setLocale } from '@/i18n';
import { setThemePreference } from '@/theme';
import type { Locale } from '@/i18n/types';
import type { ThemePreference } from '@/theme';

interface SettingsStore extends SettingsState {
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePreference) => void;
  setAutoSaveInterval: (ms: number) => void;
  setGpuBackend: (backend: SettingsState['gpuBackend']) => void;
  setMemoryLimit: (limit: SettingsState['memoryLimit']) => void;
}

const initial = loadSettings();

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...initial,

  setLocale: (locale) => {
    set({ locale });
    setLocale(locale);
    persist();
  },
  setTheme: (theme) => {
    set({ theme });
    setThemePreference(theme);
    persist();
  },
  setAutoSaveInterval: (autoSaveInterval) => {
    set({ autoSaveInterval });
    persist();
  },
  setGpuBackend: (gpuBackend) => {
    set({ gpuBackend });
    persist();
  },
  setMemoryLimit: (memoryLimit) => {
    set({ memoryLimit });
    persist();
  },
}));

function persist() {
  saveSettings({
    locale: useSettingsStore.getState().locale,
    theme: useSettingsStore.getState().theme,
    autoSaveInterval: useSettingsStore.getState().autoSaveInterval,
    gpuBackend: useSettingsStore.getState().gpuBackend,
    memoryLimit: useSettingsStore.getState().memoryLimit,
  });
  persistLegacyPrefs(useSettingsStore.getState() as SettingsState);
}