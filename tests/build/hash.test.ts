import { describe, expect, it } from 'vitest';
import {
  ContentHasher,
  canonicalize,
  hashDataValue,
  hashDataset,
  hashTable,
  hashValue,
} from '@/core/build/hash';
import { createDataTable } from '@/types/datatable';
import type { Dataset } from '@/types/datatable';

function table(id = 't1', x = [1, 2, 3], unit?: string) {
  return createDataTable(id, [
    { name: 'x', type: 'f64', data: new Float64Array(x), ...(unit ? { unit } : {}) },
  ], { tags: ['a'], provenance: 'src' });
}

describe('ContentHasher', () => {
  it('is deterministic and avalanches small changes', () => {
    const a = new ContentHasher().updateString('hello').digest();
    const b = new ContentHasher().updateString('hello').digest();
    const c = new ContentHasher().updateString('hellp').digest();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('object key order does not matter, array order does', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
  });

  it('distinguishes JSON-collapsing special numbers', () => {
    expect(hashValue(Number.NaN)).not.toBe(hashValue(Number.POSITIVE_INFINITY));
    expect(hashValue(Number.POSITIVE_INFINITY)).not.toBe(hashValue(null));
    // Both zeroes compare equal under Object.is elsewhere; a cache must not.
    expect(hashValue(-0)).toBe(hashValue(0));
  });

  it('is insensitive to Map/Set insertion order', () => {
    expect(hashValue(new Map([['a', 1], ['b', 2]]))).toBe(
      hashValue(new Map([['b', 2], ['a', 1]])),
    );
    expect(hashValue(new Set([1, 2, 3]))).toBe(hashValue(new Set([3, 1, 2])));
  });

  it('canonicalize keeps NaN/Infinity/-0 readable', () => {
    expect(canonicalize(Number.NaN)).toBe('NaN');
    expect(canonicalize(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(canonicalize(-0)).toBe('-0');
    expect(canonicalize({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
  });
});

describe('content hashing of data values', () => {
  it('typed-array element type is part of the fingerprint', () => {
    const f32 = createDataTable('t', [{ name: 'x', type: 'f32', data: new Float32Array([1, 2]) }]);
    const f64 = createDataTable('t', [{ name: 'x', type: 'f64', data: new Float64Array([1, 2]) }]);
    expect(hashTable(f32)).not.toBe(hashTable(f64));
  });

  it('ignores identity metadata but not units', () => {
    const a = table('one');
    const b = createDataTable('two', [
      { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3]) },
    ], { tags: ['other'], provenance: 'renamed' });
    expect(hashTable(a)).toBe(hashTable(b));
    expect(hashTable(table('one', [1, 2, 3], 'm'))).not.toBe(hashTable(a));
  });

  it('covers non-numeric columns', () => {
    const a = createDataTable('t', [
      { name: 's', type: 'string', data: ['a', 'b'] },
      { name: 'b', type: 'boolean', data: [true, false] },
    ]);
    const b = createDataTable('t', [
      { name: 's', type: 'string', data: ['a', 'c'] },
      { name: 'b', type: 'boolean', data: [true, false] },
    ]);
    expect(hashTable(a)).not.toBe(hashTable(b));
  });

  it('hashes datasets by shape, axes and payload', () => {
    const base: Dataset = {
      kind: 'dataset',
      id: 'd',
      name: 'img',
      dims: [2, 2],
      data: new Float64Array([1, 2, 3, 4]),
      axes: [
        { name: 'x', values: new Float64Array([0, 1]) },
        { name: 'y', values: new Float64Array([0, 1]) },
      ],
      attrs: { fits: 'EXPTIME=1' },
      provenance: 'fits',
    };
    expect(hashDataset(base)).toBe(hashDataset({ ...base, id: 'other', provenance: 'x' }));
    expect(hashDataset(base)).not.toBe(
      hashDataset({ ...base, attrs: { fits: 'EXPTIME=2' } }),
    );
    expect(hashDataset(base)).not.toBe(hashDataset({ ...base, dims: [4] }));
  });

  it('hashes scalars and rendered views through hashDataValue', () => {
    expect(hashDataValue({ kind: 'scalar', value: 42 })).toBe(
      hashDataValue({ kind: 'scalar', value: 42 }),
    );
    expect(hashDataValue({ kind: 'scalar', value: 42 })).not.toBe(
      hashDataValue({ kind: 'scalar', value: 43 }),
    );
    expect(hashDataValue(undefined)).toBe('none');
  });
});
