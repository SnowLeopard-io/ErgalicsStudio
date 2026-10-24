// ==========================================================================
// FR-07 — offline intent engine tests (matchIntent / synthesizeCode /
// validateStudioApi / suggestFix)
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  INTENT_KINDS,
  STUDIO_API_NAMES,
  matchIntent,
  synthesizeCode,
  validateStudioApi,
  suggestFix,
  type IntentKind,
} from '@/core/ai/intents';

describe('STUDIO_API_NAMES allowlist', () => {
  it('is extracted from the real studio.py module', () => {
    expect(STUDIO_API_NAMES.length).toBeGreaterThan(8);
    for (const name of ['load', 'exampleData', 'addColumn', 'summary', 'histogram', 'plot', 'print', 'random']) {
      expect(STUDIO_API_NAMES).toContain(name);
    }
  });

  it('never exposes private methods', () => {
    expect(STUDIO_API_NAMES.some((n) => n.startsWith('_'))).toBe(false);
  });
});

describe('validateStudioApi', () => {
  it('accepts code that only calls supported APIs', () => {
    expect(validateStudioApi("df = studio.load('a.csv')\nstudio.print(df)")).toBe(true);
  });

  it('rejects invented APIs', () => {
    expect(validateStudioApi('studio.fakeApi(df)')).toBe(false);
  });

  it('rejects mixed valid/invalid calls', () => {
    expect(validateStudioApi('studio.print(df)\nstudio.teleport(df)')).toBe(false);
  });

  it('rejects code without any studio call', () => {
    expect(validateStudioApi('df.column_names()')).toBe(false);
  });
});

describe('matchIntent — five intents, bilingual', () => {
  it('zh correlation', () => {
    const m = matchIntent('对 height 和 weight 做相关分析', 'zh-CN');
    expect(m?.kind).toBe('correlation');
    expect(m?.slots.x).toBe('height');
    expect(m?.slots.y).toBe('weight');
  });

  it('en correlation', () => {
    const m = matchIntent('compute the correlation between height and weight', 'en-US');
    expect(m?.kind).toBe('correlation');
    expect(m?.slots.x).toBe('height');
    expect(m?.slots.y).toBe('weight');
  });

  it('zh regression', () => {
    const m = matchIntent('用最小二乘回归拟合 x 与 y 的关系', 'zh-CN');
    expect(m?.kind).toBe('regression');
  });

  it('en regression', () => {
    const m = matchIntent('fit a least squares regression line', 'en-US');
    expect(m?.kind).toBe('regression');
  });

  it('zh distribution', () => {
    const m = matchIntent('查看列 temperature 的分布并画直方图', 'zh-CN');
    expect(m?.kind).toBe('distribution');
    expect(m?.slots.column).toBe('temperature');
  });

  it('en distribution', () => {
    const m = matchIntent('describe the distribution of the data', 'en-US');
    expect(m?.kind).toBe('distribution');
  });

  it('zh test', () => {
    const m = matchIntent('检验均值=5 是否显著', 'zh-CN');
    expect(m?.kind).toBe('test');
    expect(m?.slots.mu).toBe(5);
  });

  it('en test', () => {
    const m = matchIntent('run a t-test for significance', 'en-US');
    expect(m?.kind).toBe('test');
  });

  it('zh filter', () => {
    const m = matchIntent('对信号做移动平均平滑滤波去噪', 'zh-CN');
    expect(m?.kind).toBe('filter');
  });

  it('en filter', () => {
    const m = matchIntent('apply a moving average smoothing filter', 'en-US');
    expect(m?.kind).toBe('filter');
  });

  it('returns null for empty or unrelated text', () => {
    expect(matchIntent('   ', 'zh-CN')).toBeNull();
    expect(matchIntent('今天天气不错', 'zh-CN')).toBeNull();
  });

  it('confidence grows with keyword hits and stays below 1', () => {
    const weak = matchIntent('做个相关分析', 'zh-CN');
    const strong = matchIntent('相关性分析，关联程度，pearson 相关系数', 'zh-CN');
    expect(weak).not.toBeNull();
    expect(strong).not.toBeNull();
    expect(strong!.confidence).toBeGreaterThan(weak!.confidence);
    expect(strong!.confidence).toBeLessThanOrEqual(0.95);
  });
});

describe('slot extraction', () => {
  it('picks up a data file name', () => {
    const m = matchIntent('load measurements.csv and correlate the columns', 'en-US');
    expect(m?.slots.source).toBe('measurements.csv');
  });

  it('parses histogram bins', () => {
    const m = matchIntent('画直方图，分箱 30 组', 'zh-CN');
    expect(m?.kind).toBe('distribution');
    expect(m?.slots.bins).toBe(30);
  });

  it('parses the smoothing window', () => {
    const m = matchIntent('用 window 10 的移动平均平滑信号', 'zh-CN');
    expect(m?.kind).toBe('filter');
    expect(m?.slots.window).toBe(10);
  });

  it('clamps out-of-range bins', () => {
    const m = matchIntent('直方图 bins 5000', 'zh-CN');
    expect(m?.slots.bins).toBe(100);
  });
});

describe('synthesizeCode', () => {
  for (const kind of INTENT_KINDS) {
    it(`produces valid studio API code for "${kind}"`, () => {
      const code = synthesizeCode(kind as IntentKind);
      expect(code).toContain('import studio');
      expect(validateStudioApi(code)).toBe(true);
    });
  }

  it('embeds the requested source file', () => {
    const code = synthesizeCode('correlation', { source: 'my data.csv' });
    expect(code).toContain("studio.load('my data.csv')");
  });

  it('falls back to exampleData without a source', () => {
    const code = synthesizeCode('distribution');
    expect(code).toContain('studio.exampleData');
  });

  it('honours numeric slots', () => {
    expect(synthesizeCode('filter', { window: 7 })).toContain('window = 7');
    expect(synthesizeCode('distribution', { bins: 12 })).toContain('bins = 12');
    expect(synthesizeCode('test', { mu: 3.5 })).toContain('mu0 = 3.5');
  });
});

describe('suggestFix', () => {
  it('zh: missing data file → exampleData hint + current file name', () => {
    const advice = suggestFix(
      "FileNotFoundError: 'measurements.csv' not found",
      "df = studio.load('measurements.csv')",
      'zh-CN',
    );
    expect(advice).toContain('exampleData');
    expect(advice).toContain('measurements.csv');
  });

  it('en: missing column → column_names hint', () => {
    const advice = suggestFix("KeyError: column 'foo' does not exist", 'studio.print(df)', 'en-US');
    expect(advice).toContain('column_names');
  });

  it('unsupported API advice', () => {
    const advice = suggestFix('studio.teleport is not a function', '', 'zh-CN');
    expect(advice).toContain('不支持');
  });

  it('division by zero advice', () => {
    expect(suggestFix('ZeroDivisionError: division by zero', '', 'en-US')).toContain('zero variance');
  });

  it('falls back to a generic hint for unknown errors', () => {
    expect(suggestFix('something totally unexpected', '', 'zh-CN')).toContain('未识别');
    expect(suggestFix('something totally unexpected', '', 'en-US')).toContain('Unrecognized');
  });
});
