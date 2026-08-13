import { useSyncExternalStore } from 'react';
import type { Locale, LocaleDictionary } from './types';
import { LOCALES } from './types';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

const STORAGE_KEY = 'ergalics:lang';

const dictionaries: Record<Locale, LocaleDictionary> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

type Listener = () => void;
const listeners = new Set<Listener>();

let currentLocale: Locale = detectInitialLocale();

function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in dictionaries) return saved;
    const nav = navigator.language?.toLowerCase() ?? '';
    if (nav.startsWith('zh')) return 'zh-CN';
  } catch {
    /* ignore */
  }
  return 'zh-CN';
}

function emit() {
  listeners.forEach((l) => l());
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (!(locale in dictionaries)) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  } catch {
    /* ignore */
  }
  emit();
}

/** Translate a key. Supports `{placeholder}` interpolation. */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = dictionaries[currentLocale][key] ?? dictionaries['zh-CN'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function subscribeLocale(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive locale hook — components re-render on locale change. */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { locale, setLocale };
}

/** Reactive translation function hook. */
export function useT() {
  useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return t;
}

export { LOCALES };
export type { Locale, LocaleDictionary };