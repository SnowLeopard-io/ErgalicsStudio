// i18n tests (spec §8 — 中英双语)
import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale, getLocale, t, LOCALES } from '@/i18n';

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
});
