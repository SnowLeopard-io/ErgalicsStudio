import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateL4Card, renderL4Report, type L4Evidence } from '@/core/acceptance/l4';
import { L4_TOP30 } from '@/core/acceptance/top30';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const BENCH = join(ROOT, 'bench');
const EVIDENCE = join(BENCH, 'l4-evidence.json');
const REPORT = join(BENCH, 'l4-report.md');

/**
 * Evidence is collected by the external harness and may legitimately be absent
 * in a fresh checkout. A missing file means "no evidence yet" (every card
 * FAILs with explicit reasons), not a test error — otherwise the whole suite
 * goes red for an environment condition that the gate is supposed to report.
 */
function readEvidence(): L4Evidence[] {
  if (!existsSync(EVIDENCE)) return [];
  const text = readFileSync(EVIDENCE, 'utf8').trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as L4Evidence[]) : [];
}

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
    const evidence = readEvidence();
    const byId = new Map(evidence.map((e) => [e.pluginId, e]));
    const cards = L4_TOP30.map((p) => evaluateL4Card(byId.get(p.pluginId) ?? { ...p }));
    const report = renderL4Report(cards);
    if (!existsSync(BENCH)) mkdirSync(BENCH, { recursive: true });
    writeFileSync(REPORT, report);
    expect(cards).toHaveLength(30);
    expect(report).toContain('Plugins: 30');
    expect(report).toContain('Release gate');
    // No evidence means no card can claim PASS; the report must say so rather
    // than silently passing an empty run.
    if (evidence.length === 0) expect(report).toContain('FAIL');
  });
});
