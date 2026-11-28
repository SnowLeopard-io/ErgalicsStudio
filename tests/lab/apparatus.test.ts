import { describe, it, expect } from 'vitest';
import {
  createApparatus,
  mix,
  molesOf,
  totalMoles,
  transfer,
  volumeOf,
} from '@ergalics/sci-kernels/lab/apparatus';

const beaker = (id: string, cap = 250) => createApparatus(id, 'beaker', cap);

describe('lab/apparatus', () => {
  it('conserves volume and solute across a transfer', () => {
    const a = { ...beaker('A'), portions: [{ solutionId: 'CuSO4', volumeMl: 50, concentration: 0.1 }] };
    const b = beaker('B');
    const { next, warnings } = transfer(a, b, 20);
    expect(warnings).toEqual([]);
    expect(volumeOf(next.from)).toBe(30);
    expect(volumeOf(next.to)).toBe(20);
    expect(molesOf(next.from, 'CuSO4') + molesOf(next.to, 'CuSO4')).toBeCloseTo(5, 9);
  });

  it('refuses to overflow the target instead of silently spilling', () => {
    const a = { ...beaker('A'), portions: [{ solutionId: 'H2O', volumeMl: 100, concentration: 0 }] };
    const small = beaker('SMALL', 50);
    const { next, warnings } = transfer(a, small, 80);
    expect(warnings[0]!.code).toBe('over-capacity');
    expect(volumeOf(next.to)).toBe(0);
    expect(volumeOf(next.from)).toBe(100);
  });

  it('warns about the acid-into-water order hazard', () => {
    const acid = { ...beaker('ACID'), portions: [{ solutionId: 'H2SO4', volumeMl: 10, concentration: 18 }] };
    const water = { ...beaker('WATER'), portions: [{ solutionId: 'H2O', volumeMl: 50, concentration: 0 }] };
    expect(transfer(acid, water, 5).warnings.map((w) => w.code)).toContain('acid-into-water');
  });

  it('reports an empty source rather than producing negative volume', () => {
    const { warnings, next } = transfer(beaker('EMPTY'), beaker('B'), 10);
    expect(warnings[0]!.code).toBe('empty-source');
    expect(volumeOf(next.from)).toBe(0);
  });

  it('mixing merges the same solute and preserves its moles', () => {
    const a = {
      ...beaker('M'),
      portions: [
        { solutionId: 'NaCl', volumeMl: 100, concentration: 0.2 },
        { solutionId: 'NaCl', volumeMl: 100, concentration: 0.4 },
      ],
    };
    const beforeMoles = totalMoles(a);
    const m = mix(a);
    expect(m.portions).toHaveLength(1);
    expect(m.portions[0]!.concentration).toBeCloseTo(0.3, 9);
    expect(totalMoles(m)).toBeCloseTo(beforeMoles, 9);
  });

  it('mixing keeps different solutes separate so ion identity survives', () => {
    const a = {
      ...beaker('M'),
      portions: [
        { solutionId: 'CuSO4', volumeMl: 50, concentration: 0.1 },
        { solutionId: 'NaOH', volumeMl: 50, concentration: 0.2 },
      ],
    };
    const m = mix(a);
    expect(m.portions.map((p) => p.solutionId).sort()).toEqual(['CuSO4', 'NaOH']);
    expect(molesOf(m, 'CuSO4')).toBeCloseTo(5, 9);
    expect(molesOf(m, 'NaOH')).toBeCloseTo(10, 9);
  });

  it('rejects non-positive volumes', () => {
    expect(() => transfer(beaker('A'), beaker('B'), 0)).toThrow();
    expect(() => createApparatus('X', 'beaker', 0)).toThrow();
  });
});
