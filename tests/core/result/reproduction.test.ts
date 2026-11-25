import { describe, expect, it, vi } from 'vitest';
import { bilingualMethodDescription } from '@/core/result/methods';
import { evaluateFormula, reproduceResult } from '@/core/result/reproduction';
import { buildReproductionScript } from '@/core/result/reproduceScript';
import { createResultRecord } from '@/core/result/record';

const record = createResultRecord({
  pluginId: 'stats.demo',
  pluginVersion: '1.2.0',
  dataHash: 'a'.repeat(64),
  params: { alpha: 2, beta: 3 },
  seed: 42,
  metrics: [
    { key: 'sum', label: 'sum', value: 5, display: '5', formula: 'p["alpha"] + p["beta"]' },
    { key: 'opaque', label: 'opaque', value: 'converged', display: 'converged' },
  ],
});

describe('method description', () => {
  it('is bilingual and contains the result id and hash', () => {
    const text = bilingualMethodDescription(record);
    expect(text).toContain(record.resultId);
    expect(text).toContain(record.input.dataHash);
    expect(text).toContain('Computations were performed');
    expect(text).toContain('使用 Ergalics Studio');
  });
});

describe('reproduction', () => {
  it('evaluates only narrow expressions', () => {
    expect(evaluateFormula('p["alpha"] * 2', { alpha: 3 }, {})).toBe(6);
    expect(evaluateFormula('__import__("os").system("x")', {}, {})).toBeNull();
  });

  it('mints a new result, matches computable metrics and flags the rest', () => {
    const publish = vi.fn((args) => createResultRecord(args));
    const outcome = reproduceResult(record, publish);
    expect(publish).toHaveBeenCalledOnce();
    expect(outcome.record.resultId).not.toBe(record.resultId);
    expect(outcome.record.parentResultId).toBe(record.resultId);
    expect(outcome.comparison.find((r) => r.key === 'sum')?.matched).toBe(true);
    expect(outcome.comparison.find((r) => r.key === 'opaque')?.matched).toBe(false);
    expect(outcome.unverifiable).toEqual([
      expect.stringContaining('opaque: no machine-checkable formula'),
    ]);
  });
});

describe('standalone script', () => {
  it('carries provenance in the header and never drops unverifiable metrics', () => {
    const script = buildReproductionScript(record);
    expect(script).toContain(`# resultId: ${record.resultId}`);
    expect(script).toContain(`# dataHash: ${record.input.dataHash}`);
    expect(script).toContain('UNVERIFIABLE: opaque');
    expect(script).toContain('check("sum"');
  });
});
