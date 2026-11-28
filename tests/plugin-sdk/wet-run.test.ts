import { describe, it, expect } from 'vitest';
import { createRunRecord, type WetRunDetails } from '@ergalics/plugin-sdk/types';

const wet: WetRunDetails = {
  protocol: 'ELISA-01@v3',
  operator: '张三',
  sampleIds: ['S-001', 'S-002'],
  instrumentId: 'plate-reader-1',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  note: '第 3 孔起泡，重做',
};

describe('RunRecord — wet-lab context', () => {
  it('carries bench details through unchanged', () => {
    const run = createRunRecord({ projectId: 'p1', source: 'wet', wet, durationMs: 600_000 });
    expect(run.source).toBe('wet');
    expect(run.wet).toEqual(wet);
  });

  it('omits the key entirely when no bench context is given', () => {
    // 缺省的键不能是 present-but-undefined：存储会原样落盘，之后和旧记录对比
    // 就会出现莫名其妙的差异。
    const run = createRunRecord({ projectId: 'p1', source: 'code' });
    expect('wet' in run).toBe(false);
  });

  it('keeps bench details out of params so diffRuns ignores them', () => {
    const run = createRunRecord({ projectId: 'p1', source: 'wet', params: { dilution: 10 }, wet });
    expect(run.params).toEqual({ dilution: 10 });
    expect(run.wet).toEqual(wet);
  });
});
