import { create } from 'zustand';
import type { SettingsState } from '@/core/settings';
import { loadSettings, saveSettings, persistLegacyPrefs } from '@/core/settings';
import { setLocale, getLocale, subscribeLocale } from '@/i18n';
import { setThemePreference } from '@/theme';
import { initGpu, resetGpu } from '@/core/gpu';
import { resetGpuCompute } from '@/core/compute';
import type { Locale } from '@/i18n/types';
import type { ThemePreference } from '@/theme';

interface SettingsStore extends SettingsState {
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePreference) => void;
  setAutoSaveInterval: (ms: number) => void;
  setGpuBackend: (backend: SettingsState['gpuBackend']) => void;
  setMemoryLimit: (limit: SettingsState['memoryLimit']) => void;
  setWorkerPoolSize: (size: SettingsState['workerPoolSize']) => void;
  setChunkRows: (rows: SettingsState['chunkRows']) => void;
}

// Locale has a single runtime authority: the i18n module (booted from
// 'ergalics:lang', which every locale-writing path keeps up to date).
// The settings snapshot ('ergalics:settings') can lag behind it when the
// language was switched via the top-bar LanguageSwitcher, which bypasses
// this store — so on boot the store must adopt i18n's locale, otherwise
// the settings dialog would show a different language than the UI.
const initial = { ...loadSettings(), locale: getLocale() };

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
    const prev = useSettingsStore.getState().gpuBackend;
    set({ gpuBackend });
    persist();
    if (prev !== gpuBackend) {
      // Re-initialize the GPU device so the new backend applies immediately
      // instead of only after a reload/return to the welcome page.
      resetGpu();
      resetGpuCompute();
      void initGpu(gpuBackend);
    }
  },
  setMemoryLimit: (memoryLimit) => {
    set({ memoryLimit });
    persist();
  },
  setWorkerPoolSize: (workerPoolSize) => {
    set({ workerPoolSize });
    persist();
  },
  setChunkRows: (chunkRows) => {
    set({ chunkRows });
    persist();
  },
}));

// Keep the store's locale in sync when the language is changed outside this
// store (top-bar LanguageSwitcher calls i18n's setLocale directly). Persisting
// here keeps 'ergalics:settings' aligned; it does not loop, because writing
// localStorage does not re-emit i18n events.
subscribeLocale(() => {
  const next = getLocale();
  if (useSettingsStore.getState().locale !== next) {
    useSettingsStore.setState({ locale: next });
    persist();
  }
});

function persist() {
  const s = useSettingsStore.getState();
  saveSettings({
    locale: s.locale,
    theme: s.theme,
    autoSaveInterval: s.autoSaveInterval,
    gpuBackend: s.gpuBackend,
    memoryLimit: s.memoryLimit,
    workerPoolSize: s.workerPoolSize,
    chunkRows: s.chunkRows,
  });
  persistLegacyPrefs(s as SettingsState);
}