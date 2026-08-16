// Shared data-file parsing tests (flow + block/code modes).
import { describe, it, expect } from 'vitest';
import { parseDataText, loadJSON } from '@/blocks/fileData';

describe('parseDataText', () => {
  it('parses CSV with a header into named f64 columns', () => {
    const t = parseDataText('time,temp\n0,19.3\n5,20.1\n10,20.8', 'telemetry.csv');
    expect(t.length).toBe(3);
    expect(t.columnNames()).toEqual(['time', 'temp']);
    expect(t.columns[0]!.type).toBe('f64');
  });

  it('parses headerless numeric data with x/y/z/w defaults', () => {
    const t = parseDataText('1 2 3 4\n5 6 7 8', 'data.dat');
    expect(t.columnNames()).toEqual(['x', 'y', 'z', 'w']);
    expect(t.length).toBe(2);
  });

  it('parses XYZ into x/y/z columns', () => {
    const t = parseDataText('0 0 0\n1 2 3', 'cloud.xyz');
    expect(t.columnNames()).toEqual(['x', 'y', 'z']);
  });

  it('skips malformed / ragged rows', () => {
    const t = parseDataText('1 2\nfoo bar\n3 4 5\n6 7', 'mixed.dat');
    expect(t.length).toBe(2);
    expect(t.columnNames()).toEqual(['x', 'y']);
  });

  it('throws when there is no numeric data', () => {
    expect(() => parseDataText('hello world', 'junk.csv')).toThrow(/no numeric data/);
  });
});

describe('loadJSON', () => {
  it('parses an array of row records', () => {
    const t = loadJSON('[{"x":1,"y":2},{"x":3,"y":4}]');
    expect(t.length).toBe(2);
    expect(t.columnNames()).toEqual(['x', 'y']);
    expect(t.columns[0]!.type).toBe('f64');
  });

  it('parses a columnar object', () => {
    const t = loadJSON('{"columns":[{"name":"a","data":[1,2,3]},{"name":"b","data":[4,5,6]}]}');
    expect(t.length).toBe(3);
    expect(t.columnNames()).toEqual(['a', 'b']);
  });

  it('keeps non-numeric row-record fields as string columns', () => {
    const t = loadJSON('[{"name":"alpha","v":1},{"name":"beta","v":2}]');
    expect(t.columnNames()).toEqual(['name', 'v']);
    expect(t.columns.find((c) => c.name === 'name')!.type).toBe('string');
  });

  it('throws on malformed JSON', () => {
    expect(() => loadJSON('not json')).toThrow(/invalid JSON/);
  });
});
