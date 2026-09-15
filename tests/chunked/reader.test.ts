// ==========================================================================
// Ergalics Studio — chunked reader tests (core)
//
// Chunk boundaries, column projection, header handling, preview sampling and
// fingerprinting. Semantics mirror the whole-file delimited parser.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { chunkedRead, previewSample, fingerprint, isChunkable } from '@/core/chunked/reader';

async function collect(text: string, opts?: { chunkRows?: number; columns?: string[] }) {
  const chunks = [];
  for await (const c of chunkedRead(text, opts)) chunks.push(c);
  return chunks;
}

describe('chunkedRead — boundaries', () => {
  const csv = Array.from({ length: 10 }, (_, i) => `${i},${i * 2}`).join('\n');

  it('splits 10 rows into 4 chunks with chunkRows=3 (3/3/3/1)', async () => {
    const chunks = await collect(csv, { chunkRows: 3 });
    expect(chunks.map((c) => c.rows)).toEqual([3, 3, 3, 1]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(chunks[chunks.length - 1]!.done).toBe(true);
    // cumulative totals
    expect(chunks.map((c) => c.totalRows)).toEqual([3, 6, 9, 10]);
  });

  it('emits one done-marker for an empty file', async () => {
    const chunks = await collect('');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.rows).toBe(0);
    expect(chunks[0]!.done).toBe(true);
  });

  it('handles a lone trailing newline without inventing rows', async () => {
    const chunks = await collect('1,2\n3,4\n', { chunkRows: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.rows).toBe(2);
  });

  it('skips malformed rows and counts only data rows', async () => {
    const text = ['x,y', '1,2', 'oops,not-a-number', '3,4', '5,6,7', '5,', ''].join('\n');
    const chunks = await collect(text, { chunkRows: 100 });
    expect(chunks[0]!.rows).toBe(3); // 1,2 · 3,4 · 5,(NaN)
    const y = chunks[0]!.table!.getColumn('y') as Float64Array;
    expect(y[2]).toBeNaN();
  });
});

describe('chunkedRead — header & columns', () => {
  it('detects a header line and names columns', async () => {
    const chunks = await collect('a,b\n1,2\n3,4', { chunkRows: 10 });
    expect(chunks[0]!.table!.columnNames()).toEqual(['a', 'b']);
    const a = chunks[0]!.table!.getColumn('a') as Float64Array;
    expect(Array.from(a)).toEqual([1, 3]);
  });

  it('falls back to x/y/z defaults without a header', async () => {
    const chunks = await collect('1,2\n3,4', { chunkRows: 10 });
    expect(chunks[0]!.table!.columnNames()).toEqual(['x', 'y']);
  });

  it('projects requested columns only (source order preserved)', async () => {
    const chunks = await collect('a,b,c\n1,2,3\n4,5,6', { chunkRows: 10, columns: ['c', 'a'] });
    const table = chunks[0]!.table!;
    expect(table.columnNames()).toEqual(['a', 'c']);
    expect(Array.from(table.getColumn('c') as Float64Array)).toEqual([3, 6]);
    expect(Array.from(table.getColumn('a') as Float64Array)).toEqual([1, 4]);
  });

  it('supports whitespace-delimited data and quoted CSV names', async () => {
    const ws = await collect('1 2\n3 4', { chunkRows: 10 });
    expect(ws[0]!.table!.columnNames()).toEqual(['x', 'y']);
    const quoted = await collect('"a,b",c\n1.5,3', { chunkRows: 10 });
    const first = quoted[0]!.table!.getColumn('a,b') as Float64Array;
    expect(Array.from(first)).toEqual([1.5]);
  });

  it('yields chunks lazily (consumers can stop early)', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => `${i}`).join('\n');
    let count = 0;
    for await (const c of chunkedRead(rows, { chunkRows: 10 })) {
      count += 1;
      if (count === 2) break; // stop after two windows
      void c;
    }
    expect(count).toBe(2);
  });
});

describe('previewSample', () => {
  it('returns the first n data rows as a table', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `${i},${i * 10}`).join('\n');
    const preview = await previewSample(text, 5);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBe(5);
    expect(preview!.columnNames()).toEqual(['x', 'y']);
  });

  it('returns null for dataless input', async () => {
    expect(await previewSample('', 5)).toBeNull();
    expect(await previewSample('x,y\n', 5)).toBeNull();
  });
});

describe('fingerprint & chunkability', () => {
  it('is stable for identical content and differs across sizes', () => {
    const a = fingerprint('1,2,3');
    expect(fingerprint('1,2,3')).toBe(a);
    expect(fingerprint('1,2,3\n')).not.toBe(a);
  });

  it('stays deterministic and cheap on large inputs', () => {
    const head = 'a,b\n1,2\n3,4\n';
    const big = head + 'x'.repeat(200_000);
    expect(fingerprint(big)).toBe(fingerprint(big)); // deterministic
    expect(fingerprint(big)).not.toBe(fingerprint(head));
  });

  it('classifies chunkable vs whole-file formats', () => {
    expect(isChunkable('big.csv')).toBe(true);
    expect(isChunkable('trace.tsv')).toBe(true);
    expect(isChunkable('scan.dat')).toBe(true);
    expect(isChunkable('points.xyz')).toBe(true);
    expect(isChunkable('notes.txt')).toBe(true);
    expect(isChunkable('model.json')).toBe(false);
    expect(isChunkable('table.parquet')).toBe(false);
    expect(isChunkable('data.h5')).toBe(false);
  });
});
