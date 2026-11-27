import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeColumnData,
  decodeDataValue,
  decodeUnknown,
  encodeColumnData,
  encodeDataValue,
  encodeUnknown,
  estimateEncodedSize,
} from '@/core/build/codec';
import { hashDataValue, hashTable } from '@/core/build/hash';
import { createDataTable, isDataTable, isDataset } from '@ergalics/plugin-sdk/types';
import type { ColumnData, DataValue, Dataset } from '@ergalics/plugin-sdk/types';

describe('base64', () => {
  it('round-trips every tail length', () => {
    for (let n = 0; n < 12; n += 1) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
      expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    }
  });

  it('rejects malformed payloads', () => {
    expect(() => base64ToBytes('!!!!')).toThrow(/invalid base64/);
  });
});

describe('column codec', () => {
  it.each([
    ['f64', new Float64Array([0, -0, Number.NaN, Number.POSITIVE_INFINITY, -1.5])],
    ['f32', new Float32Array([0, -0, Number.NaN, Number.NEGATIVE_INFINITY, 1.5])],
    ['i32', new Int32Array([0, -1, 2147483647, -2147483648])],
    ['u32', new Uint32Array([0, 1, 4294967295])],
  ] as const)('preserves %s bit patterns and element type', (_type, data) => {
    const encoded = encodeColumnData(data);
    const decoded = decodeColumnData(encoded);
    expect(decoded.constructor).toBe(data.constructor);
    expect(decoded.length).toBe(data.length);
    for (let i = 0; i < data.length; i += 1) {
      const before = data[i] ?? 0;
      const after = decoded[i] ?? 0;
      if (Number.isNaN(before)) expect(Number.isNaN(after)).toBe(true);
      else expect(Object.is(after, before)).toBe(true);
    }
  });

  it('preserves string and boolean arrays', () => {
    expect(decodeColumnData(encodeColumnData(['a', 'b']))).toEqual(['a', 'b']);
    expect(decodeColumnData(encodeColumnData([true, false]))).toEqual([true, false]);
  });
});

describe('DataValue round-trip', () => {
  it('preserves table metadata, column types and values exactly', () => {
    const table = createDataTable(
      't1',
      [
        { name: 'x', type: 'f64', data: new Float64Array([1.25, -0, Number.NaN]), unit: 'm' },
        { name: 'n', type: 'i32', data: new Int32Array([-1, 0, 7]) },
        { name: 's', type: 'string', data: ['a', 'b', 'c'] },
        { name: 'flag', type: 'boolean', data: [true, false, true] },
      ],
      { tags: ['raw'], provenance: 'import' },
    );
    const encoded = encodeDataValue(table);
    expect(encoded).not.toBeNull();
    const decoded = decodeDataValue(encoded!);
    expect(isDataTable(decoded)).toBe(true);
    if (!isDataTable(decoded)) throw new Error('expected a table');
    expect(decoded.id).toBe('t1');
    expect(decoded.tags).toEqual(['raw']);
    expect(decoded.provenance).toBe('import');
    expect(decoded.columns[0]?.unit).toBe('m');
    expect(decoded.getColumn('x')).toBeInstanceOf(Float64Array);
    expect(decoded.getColumn('n')).toBeInstanceOf(Int32Array);
    expect(decoded.getColumn('s')).toEqual(['a', 'b', 'c']);
    // Content hash is unchanged, so cached downstream keys stay valid.
    expect(hashTable(decoded as unknown as typeof table)).toBe(hashTable(table));
    expect(hashDataValue(decoded)).toBe(hashDataValue(table));
  });

  it('round-trips a dataset with typed axis coordinates and attrs', () => {
    const ds: Dataset = {
      kind: 'dataset',
      id: 'd',
      name: 'cube',
      dims: [2, 2],
      data: new Float32Array([1, 2, 3, 4]),
      axes: [
        { name: 'ra', unit: 'deg', values: new Float64Array([10, 20]) },
        { name: 'dec', values: [1, 2] },
      ],
      unit: 'Jy',
      attrs: { telescope: 'JWST', calibration: { gain: 1.5, flags: new Uint32Array([1, 2]) } },
      provenance: 'fits',
    };
    const decoded = decodeDataValue(encodeDataValue(ds)!);
    expect(isDataset(decoded)).toBe(true);
    if (!isDataset(decoded)) throw new Error('expected a dataset');
    expect(decoded).toEqual(ds);
    expect(hashDataValue(decoded)).toBe(hashDataValue(ds));
  });

  it('round-trips scalars and refuses rendered views', () => {
    const scalar: DataValue = { kind: 'scalar', value: 'ok' };
    expect(decodeDataValue(encodeDataValue(scalar)!)).toEqual(scalar);
    expect(
      encodeDataValue({ kind: 'rendered-view', id: 'v1', viewType: 'scatter' }),
    ).toBeNull();
  });

  it('estimates a non-zero serialized size', () => {
    const table = createDataTable('t', [
      { name: 'x', type: 'f64', data: new Float64Array(100) },
    ]);
    expect(estimateEncodedSize(encodeDataValue(table)!)).toBeGreaterThan(400);
  });
});

describe('unknown metadata codec', () => {
  it('preserves special numbers, dates, typed arrays, maps and sets', () => {
    const value = {
      nan: Number.NaN,
      inf: Number.NEGATIVE_INFINITY,
      date: new Date('2020-01-02T03:04:05.000Z'),
      typed: new Int32Array([1, -2]),
      map: new Map<string, unknown>([['k', 1]]),
      set: new Set([1, 2]),
      nested: [{ big: 10n }],
    };
    const decoded = decodeUnknown(encodeUnknown(value)) as typeof value;
    expect(Number.isNaN(decoded.nan)).toBe(true);
    expect(decoded.inf).toBe(Number.NEGATIVE_INFINITY);
    expect(decoded.date.getTime()).toBe(value.date.getTime());
    expect(decoded.typed).toBeInstanceOf(Int32Array);
    expect([...decoded.typed]).toEqual([1, -2]);
    expect(decoded.map.get('k')).toBe(1);
    expect(decoded.set.has(2)).toBe(true);
    expect(decoded.nested[0]?.big).toBe(10n);
  });

  it('survives an empty column-free metadata object', () => {
    expect(decodeUnknown(encodeUnknown({}))).toEqual({});
    const data: ColumnData = new Float64Array(0);
    expect(decodeColumnData(encodeColumnData(data)).length).toBe(0);
  });
});
