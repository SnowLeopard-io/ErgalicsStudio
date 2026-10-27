import { describe, expect, it } from 'vitest';
import { isParamVisible, type ParamDefinition } from '@/types/plugin';
import { DataImageprocPlugin } from '@/plugins/builtin/data-imageproc/plugin';
import { MathDistPlugin } from '@/plugins/builtin/math-dist/plugin';
import { MathGamePlugin } from '@/plugins/builtin/math-game/plugin';
import { MathGraphPlugin } from '@/plugins/builtin/math-graph/plugin';
import { MathLinalgPlugin } from '@/plugins/builtin/math-linalg/plugin';
import { MathOdefieldPlugin } from '@/plugins/builtin/math-odefield/plugin';
import { MathTopologyPlugin } from '@/plugins/builtin/math-topology/plugin';

function withValue(
  params: ParamDefinition[],
  key: string,
  value: string | number | boolean,
): ParamDefinition[] {
  return params.map((p) => (p.key === key ? ({ ...p, value } as ParamDefinition) : p));
}

function visibleKeys(params: ParamDefinition[]): string[] {
  return params.filter((p) => isParamVisible(p, params)).map((p) => p.key);
}

describe('conditional param visibility', () => {
  it('honours in / notIn rules and OR rule lists', () => {
    const base: ParamDefinition[] = [
      { key: 'mode', type: 'select', label: 'Mode', options: [], value: 'a' },
      { key: 'onlyA', type: 'range', label: 'Only A', min: 0, max: 1, step: 1, value: 0, visibleWhen: { key: 'mode', in: ['a'] } },
      { key: 'notA', type: 'range', label: 'Not A', min: 0, max: 1, step: 1, value: 0, visibleWhen: { key: 'mode', notIn: ['a'] } },
      { key: 'orRule', type: 'range', label: 'OR', min: 0, max: 1, step: 1, value: 0, visibleWhen: [{ key: 'mode', in: ['a'] }, { key: 'mode', in: ['b'] }] },
    ];
    expect(visibleKeys(base)).toEqual(['mode', 'onlyA', 'orRule']);
    const b = withValue(base, 'mode', 'b');
    expect(visibleKeys(b)).toEqual(['mode', 'notA', 'orRule']);
  });

  it('shows the image-processing strength only for blur/sharpen', () => {
    const params = new DataImageprocPlugin().getParams();
    expect(visibleKeys(params)).toContain('strength');
    expect(visibleKeys(withValue(params, 'filter', 'edge'))).not.toContain('strength');
  });

  it('hides Monte-Carlo sliders when a dataset drives the distribution', () => {
    const params = new MathDistPlugin().getParams();
    expect(visibleKeys(params)).toEqual(expect.arrayContaining(['sampleSize', 'seed']));
    const withDataset = withValue(params, 'dataset', 'galton');
    expect(visibleKeys(withDataset)).not.toContain('sampleSize');
    expect(visibleKeys(withDataset)).not.toContain('seed');
  });

  it('switches the linear-algebra panel between matrix and subspace controls', () => {
    const params = new MathLinalgPlugin().getParams();
    const matrix = visibleKeys(params);
    expect(matrix).toEqual(expect.arrayContaining(['sample', 'm11']));
    expect(matrix).not.toContain('vec1');
    const subspace = visibleKeys(withValue(params, 'mode', 'subspace'));
    expect(subspace).toContain('vec1');
    expect(subspace).not.toContain('sample');
    expect(subspace).not.toContain('m11');
  });

  it('only shows the game-tree selector in tree mode', () => {
    const params = new MathGamePlugin().getParams();
    const tree = visibleKeys(withValue(params, 'mode', 'tree'));
    expect(tree).toContain('tree');
    expect(tree).not.toContain('sample');
    expect(tree).not.toContain('payoffs');
    expect(tree).not.toContain('x0');
    const auction = visibleKeys(withValue(params, 'mode', 'auction'));
    expect(auction).toEqual(expect.arrayContaining(['auctionFormat', 'bidders', 'auctions', 'seed']));
    expect(auction).not.toContain('tree');
  });

  it('hides the topology deformation slider when nothing can deform', () => {
    const params = new MathTopologyPlugin().getParams();
    const idle = withValue(withValue(params, 'loop', 'none'), 'morph', 'none');
    expect(visibleKeys(idle)).not.toContain('deform');
    expect(visibleKeys(idle)).not.toContain('animate');
    const loop = withValue(idle, 'loop', 'meridian');
    expect(visibleKeys(loop)).toEqual(expect.arrayContaining(['deform', 'animate']));
  });

  it('shows custom ODE expressions only in custom mode', () => {
    const params = new MathOdefieldPlugin().getParams();
    expect(visibleKeys(params)).not.toContain('fx');
    const custom = visibleKeys(withValue(params, 'system', 'custom'));
    expect(custom).toEqual(expect.arrayContaining(['fx', 'fy']));
  });

  it('numbers the graph step slider from 1 to the step count', () => {
    const plugin = new MathGraphPlugin();
    const step = plugin.getParams().find((p) => p.key === 'step') as {
      min: number;
      max: number;
      value: number;
    };
    expect(step.min).toBe(1);
    expect(step.value).toBe(1);
    expect(step.max).toBeGreaterThan(1);
    plugin.updateParams({ step: step.max });
    const after = plugin.getParams().find((p) => p.key === 'step') as { value: number };
    expect(after.value).toBe(step.max);
  });
});
