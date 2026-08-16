// Built-in plugin logic tests — Contour grid normalization & Scatter parsing
import { describe, it, expect } from 'vitest';
import { normalizeGrid } from '@/plugins/builtin/contour';
import { parseScatter } from '@/plugins/builtin/scatter';
import { normalizeGridUniform } from '@/plugins/builtin/heatmap';
import { NBodyPlugin } from '@/plugins/builtin/nbody';
import { ProteinPlugin } from '@/plugins/builtin/protein';
import { ParticlePlugin } from '@/plugins/builtin/particles';
import { ContourPlugin } from '@/plugins/builtin/contour';
import { ImageViewerPlugin } from '@/plugins/builtin/imageViewer';
import type { NBodyBody } from '@/core/wgsl';
import type { PluginApi } from '@/types/plugin';

function fakeApi(): PluginApi {
  return {
    locale: 'en-US',
    t: (k: string) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: () => {},
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: () => undefined,
    setParam: () => {},
  };
}

describe('contour normalizeGrid', () => {
  it('accepts a bare numeric grid', () => {
    const grid = normalizeGrid([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([0, 1, 2]);
  });

  it('accepts { values: grid } wrappers', () => {
    expect(normalizeGrid({ values: [[1.5, 2.5]] })).toEqual([[1.5, 2.5]]);
    expect(normalizeGrid({ data: { values: [[7]] } })).toEqual([[7]]);
  });

  it('rejects non-arrays and ragged/NaN input', () => {
    expect(normalizeGrid(null)).toEqual([]);
    expect(normalizeGrid(42)).toEqual([]);
    expect(normalizeGrid([[1, 'x']])).toEqual([]);
    expect(normalizeGrid([[1], [2, 3]])).toEqual([]);
  });

  it('clamps oversized grids', () => {
    const big = Array.from({ length: 500 }, () => Array.from({ length: 500 }, () => 1));
    const grid = normalizeGrid(big);
    expect(grid).toHaveLength(320);
    expect(grid[0]).toHaveLength(320);
  });
});

describe('scatter parseScatter', () => {
  it('parses space/comma separated x y [c]', () => {
    const rows = parseScatter('1 2 0.5\n3,4\n5 6 0.9\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ x: 1, y: 2, c: 0.5 });
    expect(rows[1]).toEqual({ x: 3, y: 4, c: undefined });
  });

  it('skips header lines and non-numeric rows', () => {
    const rows = parseScatter('x y value\n1 2 3\nnot a number\n4 5\n');
    expect(rows).toHaveLength(2);
  });

  it('handles scientific notation and negatives', () => {
    const rows = parseScatter('-1.5e2 2.5e-1 1\n');
    expect(rows[0]?.x).toBeCloseTo(-150);
    expect(rows[0]?.y).toBeCloseTo(0.25);
  });
});

describe('heatmap normalizeGridUniform', () => {
  it('pads ragged rows to the widest row with NaN', () => {
    const grid = normalizeGridUniform([[1, 2], [3], [4, 5, 6]]);
    expect(grid).toEqual([
      [1, 2, NaN],
      [3, NaN, NaN],
      [4, 5, 6],
    ]);
  });

  it('drops non-finite cells then re-normalizes width', () => {
    const grid = normalizeGridUniform([[1, 'x', 3], [4, 5, 6]]);
    expect(grid[0]).toEqual([1, 3, NaN]);
  });

  it('returns [] for degenerate grids (<2 rows or <2 cols)', () => {
    expect(normalizeGridUniform([[1]])).toEqual([]);
    expect(normalizeGridUniform([[1, 2]])).toEqual([]);
    expect(normalizeGridUniform(42)).toEqual([]);
  });
});

describe('nbody non-destructive downsample', () => {
  it('restores the full dataset after downsampling', async () => {
    const plugin = new NBodyPlugin();
    await plugin.init(fakeApi());
    const p = plugin as unknown as {
      state: { hasData: boolean };
      raw: NBodyBody[];
      bodies: NBodyBody[];
    };
    p.state.hasData = true;
    const raw = Array.from({ length: 128 }, (_, i) => ({
      x: i, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: 1,
    }));
    p.raw = raw;
    plugin.updateParams({ count: 64 });
    expect(p.bodies).toHaveLength(64);
    // Raising the count again must come from the pristine raw set, not the
    // already-downsampled working set (the old bug kept it at 64 forever).
    plugin.updateParams({ count: 128 });
    expect(p.bodies).toHaveLength(128);
    expect(p.bodies[127]).toEqual(raw[127]);
  });
});

describe('protein non-destructive downsample', () => {
  it('restores the full network and its edges after downsampling', async () => {
    const plugin = new ProteinPlugin();
    await plugin.init(fakeApi());
    const p = plugin as unknown as {
      state: { hasData: boolean };
      rawNodes: Array<{ id: string; name: string }>;
      rawEdges: Array<{ a: number; b: number; weight: number }>;
      nodes: Array<{ id: string }>;
      edges: Array<{ a: number; b: number }>;
    };
    p.state.hasData = true;
    p.rawNodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, name: `n${i}` }));
    p.rawEdges = [
      { a: 0, b: 99, weight: 1 },
      { a: 1, b: 98, weight: 2 },
    ];
    plugin.updateParams({ count: 40 });
    expect(p.nodes).toHaveLength(40);
    // Raising the count back must restore the full network (old bug kept 40).
    plugin.updateParams({ count: 100 });
    expect(p.nodes).toHaveLength(100);
    expect(p.edges).toHaveLength(2);
  });
});

describe('particles count clamping', () => {
  it('clamps out-of-range counts to the declared param range', async () => {
    const plugin = new ParticlePlugin();
    await plugin.init(fakeApi());
    const p = plugin as unknown as { state: { count: number } };
    plugin.updateParams({ count: 999999 });
    expect(p.state.count).toBe(250000);
    plugin.updateParams({ count: 100 });
    expect(p.state.count).toBe(500);
  });
});

describe('contour levels clamping', () => {
  it('clamps levels to the declared param range [2, 30]', async () => {
    const plugin = new ContourPlugin();
    await plugin.init(fakeApi());
    const p = plugin as unknown as { state: { levels: number } };
    plugin.updateParams({ levels: 100 });
    expect(p.state.levels).toBe(30);
    plugin.updateParams({ levels: 1 });
    expect(p.state.levels).toBe(2);
  });
});

describe('imageViewer destroy', () => {
  it('bumps the load token so in-flight decodes go stale', async () => {
    const plugin = new ImageViewerPlugin();
    await plugin.init(fakeApi());
    const p = plugin as unknown as { loadSeq: number };
    p.loadSeq = 5;
    await plugin.destroy();
    expect(p.loadSeq).toBe(6);
  });
});
