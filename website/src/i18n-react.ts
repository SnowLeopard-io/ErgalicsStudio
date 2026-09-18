import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribe, t } from './i18n';

export function useT() {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

export function useLocale() {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale: getLocale(), setLocale };
}
