// FR-02 statistical narrative tests: p formatting, Cohen effect labels, and
// full bilingual paragraphs for the five headline test families.
import { describe, it, expect } from 'vitest';
import {
  formatP,
  effectSizeLabel,
  generateNarrative,
  NARRATIVE_TYPES,
  type NarrativeInput,
} from '@/core/stats/narrative';

describe('stats/narrative — formatP', () => {
  it('renders p = 0 as the inequality', () => {
    expect(formatP(0)).toBe('p < .001');
  });

  it('renders very small p as the inequality', () => {
    expect(formatP(0.0001)).toBe('p < .001');
  });

  it('renders p = 0.001 with three decimals (not the inequality)', () => {
    expect(formatP(0.001)).toBe('p = .001');
  });

  it('renders p = 0.05 with the leading zero dropped', () => {
    expect(formatP(0.05)).toBe('p = .050');
  });

  it('renders p = 1', () => {
    expect(formatP(1)).toBe('p = 1.000');
  });

  it('guards against non-finite input', () => {
    expect(formatP(NaN)).toBe('p = —');
    expect(formatP(Infinity)).toBe('p = —');
  });
});

describe('stats/narrative — effectSizeLabel (Cohen thresholds)', () => {
  it("d: below .2 is negligible, .2 is small", () => {
    expect(effectSizeLabel('d', 0.15).en).toBe('negligible effect');
    expect(effectSizeLabel('d', 0.2).en).toBe('small effect');
  });

  it('d: .5 is medium, .8 is large', () => {
    expect(effectSizeLabel('d', 0.5).en).toBe('medium effect');
    expect(effectSizeLabel('d', 0.85).en).toBe('large effect');
  });

  it('d: negative values are classified by magnitude', () => {
    expect(effectSizeLabel('d', -0.9).en).toBe('large effect');
    expect(effectSizeLabel('d', -0.9).zh).toBe('大效应');
  });

  it('r: small/medium/large boundaries', () => {
    expect(effectSizeLabel('r', 0.05).en).toBe('negligible effect');
    expect(effectSizeLabel('r', 0.1).en).toBe('small effect');
    expect(effectSizeLabel('r', 0.42).en).toBe('medium effect');
    expect(effectSizeLabel('r', 0.5).en).toBe('large effect');
  });

  it('eta2: 0.01/0.06/0.14 boundaries', () => {
    expect(effectSizeLabel('eta2', 0.005).en).toBe('negligible effect');
    expect(effectSizeLabel('eta2', 0.01).en).toBe('small effect');
    expect(effectSizeLabel('eta2', 0.06).en).toBe('medium effect');
    expect(effectSizeLabel('eta2', 0.25).zh).toBe('大效应');
  });

  it('phi and w share the .1/.3/.5 benchmarks', () => {
    expect(effectSizeLabel('phi', 0.2).en).toBe('small effect');
    expect(effectSizeLabel('phi', 0.35).zh).toBe('中等效应');
    expect(effectSizeLabel('w', 0.6).en).toBe('large effect');
    expect(effectSizeLabel('w', 0.05).zh).toBe('效应极小');
  });

  it('non-finite values are uninterpretable', () => {
    expect(effectSizeLabel('d', NaN).en).toBe('uninterpretable');
  });
});

describe('stats/narrative — t-test', () => {
  const sig: NarrativeInput = {
    kind: 'ttest',
    variant: 'two',
    result: { statistic: 2.31, df: 28, pValue: 0.028 },
    d: 0.85,
  };

  it('zh significant paragraph matches the FR-02 example', () => {
    expect(generateNarrative(sig, 'zh-CN')).toBe(
      "独立样本 t 检验显示，两组均值差异显著，t(28) = 2.31, p = .028, Cohen's d = 0.85（大效应）。",
    );
  });

  it('en significant paragraph embeds the effect label', () => {
    expect(generateNarrative(sig, 'en-US')).toBe(
      "Independent-samples t-test revealed that the group means differ significantly, t(28) = 2.31, p = .028, Cohen's d = 0.85 (large effect).",
    );
  });

  it('zh non-significant result uses neutral wording', () => {
    const out = generateNarrative(
      { kind: 'ttest', variant: 'two', result: { statistic: 0.96, df: 28, pValue: 0.34 } },
      'zh-CN',
    );
    expect(out).toBe('独立样本 t 检验显示，两组均值差异未达显著水平，t(28) = 0.96, p = .340。');
    expect(out).not.toContain('无差异');
  });

  it('en one-sample variant is labelled correctly', () => {
    const out = generateNarrative(
      { kind: 'ttest', variant: 'one', result: { statistic: 3.4, df: 19, pValue: 0.003 } },
      'en-US',
    );
    expect(out).toBe(
      'One-sample t-test revealed that the mean differs significantly from the test value, t(19) = 3.40, p = .003.',
    );
  });
});

describe('stats/narrative — ANOVA', () => {
  it('zh significant paragraph matches the FR-02 example', () => {
    const out = generateNarrative(
      {
        kind: 'anova',
        result: { statistic: 4.52, df: [2, 27], pValue: 0.02 },
        eta2: 0.25,
      },
      'zh-CN',
    );
    expect(out).toBe('单因素方差分析显示，组间差异显著，F(2, 27) = 4.52, p = .020, η² = 0.25（大效应）。');
  });

  it('en non-significant paragraph stays neutral', () => {
    const out = generateNarrative(
      { kind: 'anova', result: { statistic: 1.1, df: [2, 27], pValue: 0.341 }, groups: 3 },
      'en-US',
    );
    expect(out).toBe(
      'One-way ANOVA revealed that the 3 groups did not differ significantly, F(2, 27) = 1.10, p = .341.',
    );
  });
});

describe('stats/narrative — chi-square', () => {
  it('zh significant paragraph matches the FR-02 example', () => {
    const out = generateNarrative(
      {
        kind: 'chi2',
        result: { statistic: 8.34, df: 1, pValue: 0.004 },
        phi: 0.2,
        n: 200,
      },
      'zh-CN',
    );
    expect(out).toBe(
      '卡方检验显示，两个分类变量之间存在显著关联，χ²(1, N = 200) = 8.34, p = .004, φ = 0.20（小效应）。',
    );
  });

  it('en non-significant paragraph omits N when unknown', () => {
    const out = generateNarrative(
      { kind: 'chi2', result: { statistic: 2.1, df: 1, pValue: 0.147 } },
      'en-US',
    );
    expect(out).toBe(
      'A chi-square test of independence showed the association between the two categorical variables did not reach significance, χ²(1) = 2.10, p = .147.',
    );
  });
});

describe('stats/narrative — correlation', () => {
  it('zh significant paragraph matches the FR-02 example', () => {
    const out = generateNarrative(
      { kind: 'correlation', r: 0.42, pValue: 0.0001, n: 100 },
      'zh-CN',
    );
    expect(out).toBe(
      'Pearson 相关分析显示，x 与 y 之间存在显著正相关，r(98) = 0.42, p < .001（中等效应）。',
    );
  });

  it('en significant negative correlation is labelled correctly', () => {
    const out = generateNarrative(
      { kind: 'correlation', r: -0.55, pValue: 0.00001, n: 60, xName: 'age', yName: 'score' },
      'en-US',
    );
    expect(out).toBe(
      'Pearson correlation analysis showed a significant negative correlation between age and score, r(58) = -0.55, p < .001 (large effect).',
    );
  });

  it('zh non-significant correlation avoids the effect label', () => {
    const out = generateNarrative(
      { kind: 'correlation', r: 0.12, pValue: 0.41, n: 50 },
      'zh-CN',
    );
    expect(out).toBe('Pearson 相关分析显示，x 与 y 之间的相关未达显著水平，r(48) = 0.12, p = .410。');
  });

  it('spearman method is named in the output', () => {
    const out = generateNarrative(
      { kind: 'correlation', r: 0.42, pValue: 0.001, n: 100, method: 'spearman' },
      'zh-CN',
    );
    expect(out.startsWith('Spearman 相关分析显示')).toBe(true);
  });
});

describe('stats/narrative — regression', () => {
  it('zh significant paragraph matches the FR-02 example', () => {
    const out = generateNarrative(
      {
        kind: 'regression',
        f: 21.3,
        df: [1, 98],
        pValue: 0.00001,
        r2: 0.178,
        predictor: { beta: 0.42, t: 4.62, df: 98, pValue: 0.00001 },
      },
      'zh-CN',
    );
    expect(out).toBe(
      '线性回归分析显示，模型整体显著，F(1, 98) = 21.30, p < .001, R² = 0.18；x 对 y 有显著正向预测作用，β = 0.42, t(98) = 4.62, p < .001。',
    );
  });

  it('en non-significant model and predictor stay neutral', () => {
    const out = generateNarrative(
      {
        kind: 'regression',
        f: 1.2,
        df: [1, 98],
        pValue: 0.276,
        r2: 0.012,
        predictor: { name: 'x1', beta: 0.11, t: 1.1, df: 98, pValue: 0.276 },
      },
      'en-US',
    );
    expect(out).toBe(
      'Linear regression showed that the model was not significant, F(1, 98) = 1.20, p = .276, R² = 0.01. In addition, x1 did not significantly positively predict y, β = 0.11, t(98) = 1.10, p = .276.',
    );
  });

  it('model-only paragraph has no predictor sentence', () => {
    const out = generateNarrative(
      { kind: 'regression', f: 5.5, df: [2, 57], pValue: 0.007, r2: 0.16 },
      'zh-CN',
    );
    expect(out).toBe('线性回归分析显示，模型整体显著，F(2, 57) = 5.50, p = .007, R² = 0.16。');
    expect(out).not.toContain('预测');
  });

  it('negative predictor beta is phrased as 负向', () => {
    const out = generateNarrative(
      {
        kind: 'regression',
        f: 9.0,
        df: [1, 48],
        pValue: 0.004,
        r2: 0.16,
        predictor: { name: 'stress', beta: -0.4, t: -3.0, df: 48, pValue: 0.004 },
      },
      'zh-CN',
    );
    expect(out).toContain('stress 对 y 有显著负向预测作用，β = -0.40, t(48) = -3.00, p = .004');
  });
});

describe('stats/narrative — cross-cutting rules', () => {
  it('NARRATIVE_TYPES lists the five FR-02 families in order', () => {
    expect(NARRATIVE_TYPES).toEqual(['ttest', 'anova', 'chi2', 'correlation', 'regression']);
  });

  it('p < .001 inequality appears in every family when p is tiny', () => {
    const cases: NarrativeInput[] = [
      { kind: 'ttest', variant: 'paired', result: { statistic: 5.1, df: 9, pValue: 0.0002 } },
      { kind: 'anova', result: { statistic: 12.4, df: [3, 36], pValue: 0.00001 } },
      { kind: 'chi2', result: { statistic: 20.1, df: 4, pValue: 0.00001 } },
      { kind: 'correlation', r: 0.9, pValue: 0.000001, n: 30 },
      { kind: 'regression', f: 40.2, df: [1, 28], pValue: 0.000001, r2: 0.59 },
    ];
    for (const c of cases) expect(generateNarrative(c, 'en-US')).toContain('p < .001');
  });

  it('degenerate (NaN) results never print NaN', () => {
    const out = generateNarrative(
      { kind: 'ttest', variant: 'two', result: { statistic: NaN, df: NaN, pValue: NaN } },
      'zh-CN',
    );
    expect(out).not.toContain('NaN');
  });
});
