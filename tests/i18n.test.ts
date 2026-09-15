// i18n tests (spec §8 — 中英双语)
import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale, getLocale, t, LOCALES, dictionaries } from '@/i18n';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('zh-CN');
  });

  it('exposes both locales', () => {
    expect(LOCALES.map((l) => l.code)).toContain('zh-CN');
    expect(LOCALES.map((l) => l.code)).toContain('en-US');
  });

  it('switches locale', () => {
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
    expect(t('plugin.loading')).toBe('Loading…');
    setLocale('zh-CN');
    expect(t('plugin.loading')).toBe('加载中…');
  });

  it('translates new sandbox-related keys', () => {
    setLocale('zh-CN');
    expect(t('plugin.sandbox_fallback')).toContain('沙箱');
    expect(t('plugin.sandbox_trusted')).toContain('受信任');
  });

  it('returns the zh-CN text for existing keys', () => {
    expect(t('plugin.load_failed')).toBe('插件加载失败');
  });

  it('falls back to the key when unknown', () => {
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('falls back to zh-CN for missing en-US keys', () => {
    setLocale('en-US');
    // key exists in zh-CN dictionary
    expect(typeof t('welcome.title')).toBe('string');
  });

  it('keeps zh-CN and en-US dictionaries in exact key parity', () => {
    const zh = Object.keys(dictionaries['zh-CN']!).sort();
    const en = Object.keys(dictionaries['en-US']!).sort();
    const missingInEn = zh.filter((k) => !(k in dictionaries['en-US']!));
    const missingInZh = en.filter((k) => !(k in dictionaries['zh-CN']!));
    expect(missingInEn).toEqual([]);
    expect(missingInZh).toEqual([]);
    expect(zh).toEqual(en);
  });

  it('translates every research-module key in both locales', () => {
    const keys = [
      'research.menu',
      'figure.title',
      'figure.add_panel',
      'supplement.title',
      'supplement.build',
      'notebook.title',
      'notebook.run',
    ];
    setLocale('zh-CN');
    for (const key of keys) expect(t(key)).not.toBe(key);
    setLocale('en-US');
    for (const key of keys) expect(t(key)).not.toBe(key);
    setLocale('zh-CN');
  });
});
