// Studio API tests — the JS implementation backed by @/blocks/ops.
import { describe, it, expect, vi } from 'vitest';
import { createStudioApi } from '@/editor/runtime/studio-api';
import type { StudioApiHost } from '@/editor/runtime/studio-api';
import { createDataTable, type DataTable, type RenderedView } from '@/types/datatable';

function makeHost(overrides?: Partial<StudioApiHost>): StudioApiHost & {
  rendered: RenderedView[];
} {
  const rendered: RenderedView[] = [];
  const host: StudioApiHost & { rendered: RenderedView[] } = {
    loadText: vi.fn(async () => ''),
    renderView: vi.fn(async (view: RenderedView) => {
      rendered.push(view);
    }),
    notify: vi.fn(),
    print: vi.fn(),
    ...overrides,
    rendered,
  };
  return host;
}

function table(columns: { name: string; data: number[] }[]): DataTable {
  return createDataTable(
    't',
    columns.map((c) => ({ name: c.name, type: 'f64' as const, data: Float64Array.from(c.data) })),
    { provenance: 'test' },
  );
}

describe('studio data parsing', () => {
  it('parses CSV with a header row', () => {
    const api = createStudioApi(makeHost());
    const t = api.loadCSV('time,temp\n0,19.34\n5,20.19\n10,20.80');
    expect(t.columnNames()).toEqual(['time', 'temp']);
    expect(t.length).toBe(3);
    expect(t.getColumn('temp')).toEqual(Float64Array.from([19.34, 20.19, 20.8]));
  });

  it('parses CSV without a header using c0..cN names', () => {
    const api = createStudioApi(makeHost());
    const t = api.loadCSV('1,2\n3,4');
    expect(t.columnNames()).toEqual(['c0', 'c1']);
    expect(t.length).toBe(2);
  });

  it('parses XYZ naming x/y/z', () => {
    const api = createStudioApi(makeHost());
    const t = api.loadXYZ('0 0 0\n1 2 3');
    expect(t.columnNames()).toEqual(['x', 'y', 'z']);
    expect(t.getColumn('z')).toEqual(Float64Array.from([0, 3]));
  });

  it('load() dispatches on file extension', async () => {
    const host = makeHost({
      loadText: vi.fn(async (path: string) => (path.endsWith('.csv') ? 'a,b\n1,2' : '5 6')),
    });
    const api = createStudioApi(host);
    const csv = await api.load('data.csv');
    expect(csv.columnNames()).toEqual(['a', 'b']);
    const dat = await api.load('data.dat');
    expect(dat.columnNames()).toEqual(['c0', 'c1']);
  });

  it('throws on empty input', () => {
    const api = createStudioApi(makeHost());
    expect(() => api.loadCSV('')).toThrow(/no numeric data/);
  });
});

describe('studio transforms / statistics', () => {
  it('normalize minmax maps to [0,1]', () => {
    const api = createStudioApi(makeHost());
    expect([...api.normalize(Float64Array.from([1, 2, 3]))]).toEqual([0, 0.5, 1]);
  });

  it('normalize zscore centers and scales', () => {
    const api = createStudioApi(makeHost());
    const out = api.normalize(Float64Array.from([1, 2, 3]), 'zscore');
    expect(out[0]).toBeCloseTo(-1.2247, 3);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(1.2247, 3);
  });

  it('summary computes mean/std/min/max/median', () => {
    const api = createStudioApi(makeHost());
    const s = api.summary([1, 2, 3]);
    expect(s.mean).toBe(2);
    expect(s.min).toBe(1);
    expect(s.max).toBe(3);
    expect(s.median).toBe(2);
    expect(s.std).toBeCloseTo(Math.sqrt(2 / 3), 6);
  });

  it('histogram bins values evenly', () => {
    const api = createStudioApi(makeHost());
    const h = api.histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect([...h.counts]).toEqual([2, 2, 2, 2, 2]);
    expect(h.centers[0]).toBeCloseTo(0.9, 6);
    expect(h.centers[4]).toBeCloseTo(8.1, 6);
  });

  it('sort asc/desc reorders rows', () => {
    const api = createStudioApi(makeHost());
    const t = table([{ name: 'x', data: [3, 1, 2] }]);
    expect([...(api.sort(t, 'x', 'asc').getColumn('x') as Float64Array)]).toEqual([1, 2, 3]);
    expect([...(api.sort(t, 'x', 'desc').getColumn('x') as Float64Array)]).toEqual([3, 2, 1]);
  });

  it('select/filter/addColumn mirror ops', () => {
    const api = createStudioApi(makeHost());
    const t = table([
      { name: 'x', data: [1, 2, 3, 4] },
      { name: 'y', data: [5, 6, 7, 8] },
    ]);
    expect(api.select(t, ['x']).columnNames()).toEqual(['x']);
    expect(api.filter(t, (row) => (row.x as number) > 2).length).toBe(2);
    const added = api.addColumn(t, 'z', [9, 10, 11, 12]);
    expect(added.columnNames()).toEqual(['x', 'y', 'z']);
    expect([...(added.getColumn('z') as Float64Array)]).toEqual([9, 10, 11, 12]);
  });
});

describe('studio.random', () => {
  it('is deterministic for a given seed', () => {
    const api = createStudioApi(makeHost());
    const a = api.random(8, 42).getColumn('x') as Float64Array;
    const b = api.random(8, 42).getColumn('x') as Float64Array;
    expect([...a]).toEqual([...b]);
  });

  it('respects the requested count', () => {
    const api = createStudioApi(makeHost());
    expect(api.random(12).length).toBe(12);
  });
});

describe('studio.plot', () => {
  it('produces a RenderedView routed to the right plugin', async () => {
    const host = makeHost();
    const api = createStudioApi(host);
    const t = table([
      { name: 'x', data: [1, 2] },
      { name: 'y', data: [4, 5] },
    ]);
    await api.plot('scatter', t, { x: 'x', y: 'y' });
    expect(host.rendered).toHaveLength(1);
    const payload = host.rendered[0]!.data as { pluginId: string; text: string };
    expect(payload.pluginId).toBe('example.scatter');
    expect(payload.text).toBe('1 4\n2 5');
  });

  it('histogram routes to the histogram plugin with newline delimiters', async () => {
    const host = makeHost();
    const api = createStudioApi(host);
    const t = table([{ name: 'x', data: [1, 2, 3] }]);
    await api.plot('histogram', t, { column: 'x' });
    const payload = host.rendered[0]!.data as { pluginId: string; text: string };
    expect(payload.pluginId).toBe('example.histogram');
    expect(payload.text).toBe('1\n2\n3');
  });
});

describe('studio host interaction', () => {
  it('notify/print forward to the host and params round-trip', () => {
    const host = makeHost();
    const params = new Map<string, unknown>();
    const api = createStudioApi(host, params);
    api.notify('warning', 'careful');
    api.print('hello', 42);
    expect(host.notify).toHaveBeenCalledWith('warning', 'careful');
    expect(host.print).toHaveBeenCalledWith('hello 42');
    api.setParam('key', { a: 1 });
    expect(api.getParam('key')).toEqual({ a: 1 });
  });
});
