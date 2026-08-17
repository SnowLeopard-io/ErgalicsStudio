// Code-mode sample programs: structural invariants (i18n, import studio,
// no accidental await on the synchronous plot bridge).
import { describe, it, expect } from 'vitest';
import { CODE_SAMPLES } from '@/editor/code/samples';

describe('CODE_SAMPLES', () => {
  it('has unique ids and non-empty python bodies', () => {
    const ids = CODE_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of CODE_SAMPLES) {
      expect(s.python.trim().length).toBeGreaterThan(0);
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
    }
  });

  it('localizes names and descriptions for en-US', () => {
    for (const s of CODE_SAMPLES) {
      expect(s.nameI18n['en-US']).toBeTruthy();
      expect(s.descriptionI18n['en-US']).toBeTruthy();
    }
  });

  it('uses the studio module and never awaits the sync plot bridge', () => {
    for (const s of CODE_SAMPLES) {
      expect(s.python).toContain('import studio');
      expect(s.python).not.toMatch(/await\s+studio\./);
    }
  });

  it('references only resolvable bundled data files', () => {
    const known = new Set([
      'telemetry.csv',
      'galaxy.dat',
      'bar-data.csv',
      'radar-data.csv',
      'network-edges.csv',
      'bubble-data.csv',
      'violin-data.csv',
      'sankey-data.csv',
      'boxplot-data.csv',
      'parallel-data.csv',
      'errorband-data.csv',
      'treemap-data.csv',
      'qq-data.dat',
      'distribution.dat',
      'scatter-clusters.dat',
      'dataset.json',
      'field.json',
      'contour-data.json',
      'nbody.json',
      'protein.json',
      'diamond.xyz',
      'crystal.xyz',
      'tornado.xyz',
    ]);
    for (const s of CODE_SAMPLES) {
      const refs = [...s.python.matchAll(/studio\.load\('([^']+)'\)/g)].map((m) => m[1]!);
      for (const ref of refs) {
        expect(known.has(ref), `${s.id} references unknown file ${ref}`).toBe(true);
      }
    }
  });
});
