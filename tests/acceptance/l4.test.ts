import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateL4Card, renderL4Report, type L4Evidence } from '@/core/acceptance/l4';
import { L4_TOP30 } from '@/core/acceptance/top30';

const ROOT = 'C:/Users/smile/Desktop/ergalics-studio';

describe('L4 acceptance', () => {
  it('marks missing evidence as FAIL with explicit reasons', () => {
    const card = evaluateL4Card({ pluginId: 'p', discipline: 'x' });
    expect(card.status).toBe('FAIL');
    expect(card.reasons.length).toBeGreaterThan(3);
  });

  it('passes a fully evidenced card', () => {
    const card = evaluateL4Card({
      pluginId: 'p',
      discipline: 'x',
      defaultMetrics: { n: 10 },
      extremeParams: { n: 1000 },
      extremeMetrics: { n: 1000 },
      export: { page: ['10', '20'], firstLine: '10', lastLine: '20', sidecar: ['10', '20'] },
      refresh: { paramsMatch: true, metricsMatch: true, detail: 'round-trip verified' },
      independent: { expected: '10', actual: '10', detail: 'verified' },
      limitations: ['not applicable to streaming input'],
    });
    expect(card.status).toBe('PASS');
  });

  it('writes the 30-card Markdown release report', () => {
    const raw = JSON.parse(readFileSync(`${ROOT}/bench/l4-evidence.json`, 'utf8')) as L4Evidence[];
    const byId = new Map(raw.map((e) => [e.pluginId, e]));
    const cards = L4_TOP30.map((p) => evaluateL4Card(byId.get(p.pluginId) ?? { ...p }));
    const report = renderL4Report(cards);
    writeFileSync(`${ROOT}/bench/l4-report.md`, report);
    expect(cards).toHaveLength(30);
    expect(report).toContain('Plugins: 30');
    expect(report).toContain('Release gate');
  });
});
