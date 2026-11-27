export type Locale = 'zh-CN' | 'en-US';

export type LocaleDictionary = Record<string, string>;

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
];