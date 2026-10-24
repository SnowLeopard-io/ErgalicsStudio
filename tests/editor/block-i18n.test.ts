// Block i18n completeness — every %{BKY_*} reference must resolve in both locales.
import { describe, it, expect } from 'vitest';
import { BLOCK_DEFS, BLOCK_I18N, TOOLBOX } from '@/editor/block';

function extractBkyKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/%\{BKY_([A-Z0-9_]+)\}/g)) out.add(m[1]!);
  } else if (Array.isArray(value)) {
    value.forEach((v) => extractBkyKeys(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => extractBkyKeys(v, out));
  }
  return out;
}

describe('block i18n', () => {
  it('every %{BKY_*} reference (blocks + toolbox) has a message in both locales', () => {
    const keys = extractBkyKeys([BLOCK_DEFS, TOOLBOX]);
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(BLOCK_I18N['zh-CN'][key], `zh-CN missing BKY_${key}`).toBeTypeOf('string');
      expect(BLOCK_I18N['en-US'][key], `en-US missing BKY_${key}`).toBeTypeOf('string');
    }
  });

  it('both locales expose the same set of keys', () => {
    const zh = Object.keys(BLOCK_I18N['zh-CN']).sort();
    const en = Object.keys(BLOCK_I18N['en-US']).sort();
    expect(en).toEqual(zh);
  });
});
