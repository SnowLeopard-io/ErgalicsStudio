import { describe, expect, it } from 'vitest';
import {
  createManifest,
  currentSeed,
  dagToPython,
  hashString,
  manifestToText,
  mulberry32,
  setSeed,
  topoSort,
} from '@/core/repro';

describe('reproducibility kernel', () => {
  it('mulberry32 is deterministic for a fixed seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('different seeds yield different streams', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it('setSeed + currentSeed round-trips', () => {
    setSeed(987654);
    expect(currentSeed()).toBe(987654);
  });

  it('hashString is stable and hex', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('manifest captures seed, version, inputs and graph', () => {
    const m = createManifest({
      studioVersion: '1.2.3',
      seed: 42,
      inputs: [{ name: 'data.csv', content: 'a,b\n1,2' }],
      graph: [
        { id: 'b1', blockId: 'statistics.tTestTwo', params: { xColumn: 'a', yColumn: 'b' }, inputs: ['src'] },
        { id: 'src', blockId: 'data_source.csv', params: {}, inputs: [] },
      ],
      outputs: [{ name: 'result', content: 'p=0.3' }],
      now: new Date('2026-09-05T00:00:00Z'),
    });
    expect(m.seed).toBe(42);
    expect(m.studioVersion).toBe('1.2.3');
    expect(m.inputs[0]!.hash).toBe(hashString('a,b\n1,2'));
    expect(m.graph).toHaveLength(2);
    const text = manifestToText(m);
    expect(text).toContain('seed: 42');
    expect(text).toContain('statistics.tTestTwo');
  });

  it('topoSort orders dependencies before dependents', () => {
    const nodes = [
      { id: 'c', blockId: 'x', params: {}, inputs: ['b'] },
      { id: 'a', blockId: 'x', params: {}, inputs: [] },
      { id: 'b', blockId: 'x', params: {}, inputs: ['a'] },
    ];
    const order = topoSort(nodes).map((n) => n.id);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('dagToPython sets the seed and emits scipy calls for known blocks', () => {
    const py = dagToPython({
      seed: 7,
      studioVersion: '1.2.3',
      manifestId: 'run-x',
      nodes: [
        { id: 'src', blockId: 'data_source.csv', params: {}, inputs: [] },
        {
          id: 't',
          blockId: 'statistics.tTestTwo',
          params: { xColumn: 'a', yColumn: 'b' },
          inputs: ['src', 'src'],
        },
      ],
    });
    expect(py).toContain('# Reproduced by Ergalics Studio');
    expect(py).toContain('np.random.seed(7)');
    expect(py).toContain('import scipy.stats as scipy');
    expect(py).toContain('scipy.stats.ttest_ind');
    expect(py).toContain('n0'); // src variable
    // t-test references the upstream dataframe column
    expect(py).toContain("n1 = scipy.stats.ttest_ind(n0['a'], n0['b'], equal_var=False)");
  });

  it('dagToPython degrades unknown blocks to valid TODO comments', () => {
    const py = dagToPython({
      seed: 1,
      studioVersion: 'v',
      nodes: [{ id: 'u', blockId: 'mystery.block', params: {}, inputs: [] }],
    });
    expect(py).toContain('# block u (mystery.block)');
    expect(py).not.toContain('undefined');
  });
});
