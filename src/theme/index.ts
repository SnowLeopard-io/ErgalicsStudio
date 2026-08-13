import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ergalics:theme';

type Listener = () => void;
const listeners = new Set<Listener>();

let preference: ThemePreference = detectInitialPreference();

function detectInitialPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* ignore */
  }
  return 'system';
}

function systemDark(): boolean {
  return (
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
}

function apply() {
  const resolved = preference === 'system' ? (systemDark() ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
}

function emit() {
  listeners.forEach((l) => l());
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): 'light' | 'dark' {
  return preference === 'system' ? (systemDark() ? 'dark' : 'light') : preference;
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  apply();
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keep theme in sync with system changes when in "system" mode.
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const onSystemChange = () => {
  if (preference === 'system') {
    apply();
    emit();
  }
};
if (mediaQuery.addEventListener) {
  mediaQuery.addEventListener('change', onSystemChange);
} else {
  mediaQuery.addListener(onSystemChange);
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
} {
  useSyncExternalStore(subscribe, getThemePreference, getThemePreference);
  return {
    preference,
    resolved: getResolvedTheme(),
    setPreference: setThemePreference,
  };
}

// Apply immediately on module load.
apply();