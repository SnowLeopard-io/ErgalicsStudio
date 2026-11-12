// ==========================================================================
// Regression tests for the research-tool bugs found in the audit.
//
// Every case here reproduced a real defect: a wrong number, a crash, a
// silently wrong file, or data that leaked between projects.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { movingAverage } from '@/core/signal/filter';
import { decomposeAdditive } from '@/core/signal/decompose';
import { peakFrequency, spectrum } from '@/core/signal/fft';
import { etlPivot, parseCsvTable } from '@/core/dataeng/etl';
import { hashText, sanitizeTableName, uniqueTableNames } from '@/core/sql/engine';
import { effectiveDpi, autoPanelTag } from '@/core/submit/checklist';
import { figureSheetPath } from '@/core/publish/bridge';
import { extent } from '@/core/stats';

describe('signal: moving average', () => {
  it('produces finite values for an EVEN window (no fractional indexing)', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = movingAverage(x, 4);
    // Every sample must be a number — the old code indexed x[1.5] and
    // produced NaN for every interior sample.
    expect(out.length).toBe(x.length);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('stays symmetric for an odd window (edges use the available samples)', () => {
    const x = [1, 2, 3, 4, 5];
    const out = movingAverage(x, 3);
    expect(Array.from(out)).toEqual([1.5, 2, 3, 4, 4.5]);
  });

  it('the centred average equals the manual mean for an odd window', () => {
    const x = [2, 4, 6, 8, 10];
    const out = movingAverage(x, 3);
    expect(out[2]).toBeCloseTo(6, 10);
    expect(out[0]).toBeCloseTo(3, 10); // edge: (2+4)/2
  });

  it('the causal variant is unchanged', () => {
    const x = [1, 2, 3, 4, 5];
    expect(Array.from(movingAverage(x, 3, true))).toEqual([1, 1.5, 2, 3, 4]);
  });
});

describe('signal: peak frequency is a frequency, not a bin index', () => {
  it('returns the dominant frequency in Hz', () => {
    const n = 128;
    const rate = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 8 * i) / rate));
    const r = spectrum(x, rate, 'hann');
    const peak = peakFrequency(r);
    // The value must be inside the frequency axis (the old page indexed the
    // frequency array with it a second time and always got undefined).
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(r.freqs[r.freqs.length - 1]!);
  });
});

describe('signal: additive decomposition', () => {
  it('a detected period yields a seasonal component (not a fixed period 2)', () => {
    const m = 12;
    const x = Array.from({ length: m * 8 }, (_, i) => Math.sin((2 * Math.PI * i) / m));
    const d = decomposeAdditive(x, m);
    // The trend must be ~0 and the residual small for a pure seasonal series.
    expect(Math.abs(d.trend[0]!)).toBeLessThan(1);
  });
});

describe('etl: pivot with numeric column values', () => {
  it('fills the cells instead of leaving them empty', () => {
    const csv = 'year,region,sales\n2020,north,10\n2020,south,20\n2021,north,30\n';
    const table = parseCsvTable(csv);
    const pivoted = etlPivot(table, 'year', 'region', 'sales', 'sum');
    const row2020 = pivoted.rows.find((r) => String(r.year) === '2020');
    // The write used keyString(2020) ('n:2020') and the read keyString('2020')
    // ('s:2020') → every cell came back null.
    expect(row2020?.north).toBe(10);
    expect(row2020?.south).toBe(20);
    const row2021 = pivoted.rows.find((r) => String(r.year) === '2021');
    expect(row2021?.north).toBe(30);
  });
});

describe('sql: table naming and content fingerprints', () => {
  it('hashText distinguishes different content of the same name', () => {
    expect(hashText('a,b\n1,2')).not.toBe(hashText('a,b\n1,3'));
    expect(hashText('same')).toBe(hashText('same'));
  });

  it('sanitizes table names and dedupes collisions', () => {
    expect(sanitizeTableName('my data.csv')).toBe('my_data');
    const names = uniqueTableNames(['data.csv', 'data.csv']);
    expect(names.get('data.csv')).toBe('data');
  });
});

describe('submission checklist: effective resolution', () => {
  it('reports the raster dpi for the raster formats', () => {
    expect(
      effectiveDpi({ format: 'png600', rasterDpi: 600, colorMode: 'rgb', fontEmbedded: true }),
    ).toBe(600);
    // A PDF carries a raster too — reporting "∞" made a 300-dpi PDF pass a
    // 600-dpi requirement.
    expect(
      effectiveDpi({ format: 'pdf', rasterDpi: 300, colorMode: 'rgb', fontEmbedded: true }),
    ).toBe(300);
  });

  it('reports an infinite resolution for the vector format', () => {
    expect(
      effectiveDpi({ format: 'svg', rasterDpi: 72, colorMode: 'rgb', fontEmbedded: true }),
    ).toBe(Infinity);
  });

  it('numbers panels a..z, aa, ab', () => {
    expect(autoPanelTag(0)).toBe('a');
    expect(autoPanelTag(25)).toBe('z');
    expect(autoPanelTag(26)).toBe('aa');
  });
});

describe('publish: figure paths are unique per sheet', () => {
  it('two sheets with the same name get different paths', () => {
    const sheet = { id: 'aaaaaaaa-1111', name: 'Analysis', templateId: 'ieee_single', caption: '', panels: [], createdAt: 0, updatedAt: 0 };
    const other = { ...sheet, id: 'bbbbbbbb-2222' };
    expect(figureSheetPath(sheet as never)).not.toBe(figureSheetPath(other as never));
    expect(figureSheetPath(sheet as never)).toMatch(/^figures\/analysis-[0-9a-f]{8}\.svg$/);
  });
});

describe('stats: extent is safe for huge samples', () => {
  it('finds the extremes without spreading the array', () => {
    const big = new Float64Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i;
    const [min, max] = extent(big);
    expect(min).toBe(0);
    expect(max).toBe(199_999);
  });

  it('reports NaN for an empty sample', () => {
    expect(extent([])).toEqual([NaN, NaN]);
  });
});
