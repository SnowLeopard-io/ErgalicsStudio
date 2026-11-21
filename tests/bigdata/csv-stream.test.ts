// Tests for the incremental CSV parser (GB-scale ingestion core).
// Every path that the streaming import depends on: cross-chunk quoting,
// cross-chunk newlines, delimiter detection and header handling.

import { describe, expect, it } from 'vitest';
import { IncrementalCsvParser, detectDelimiter } from '@/core/bigdata/csv-stream';

function feed(parser: IncrementalCsvParser, text: string, chunkSize = 7): string[][] {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parser.pushBytes(bytes.subarray(i, i + chunkSize));
  }
  parser.end();
  return parser.takeRows();
}

describe('IncrementalCsvParser', () => {
  it('parses simple rows', () => {
    const p = new IncrementalCsvParser();
    const rows = feed(p, 'a,b\n1,2\n3,4\n');
    expect(p.headerRow).toEqual(['a', 'b']);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, 'x,y\n"a,b","say ""hi"""\n');
    expect(rows).toEqual([['a,b', 'say "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, 'x\n"line1\nline2"\n');
    expect(rows).toEqual([['line1\nline2']]);
  });

  it('keeps a row split across chunk boundaries intact', () => {
    const text = 'name,age\nAlice,30\nBob,25\n';
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, text, 1); // one byte at a time — worst case
    expect(p.headerRow).toEqual(['name', 'age']);
    expect(rows).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  it('keeps a quoted span split across chunks intact', () => {
    const text = 'a,b\n"multi\nline",2\n';
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, text, 3);
    expect(rows).toEqual([['multi\nline', '2']]);
  });

  it('decodes multi-byte UTF-8 split across chunks', () => {
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, '名\n张三,李四\n', 1);
    expect(p.headerRow).toEqual(['名']);
    expect(rows).toEqual([['张三', '李四']]);
  });

  it('flushes a final row without trailing newline', () => {
    const p = new IncrementalCsvParser({ delimiter: ',' });
    const rows = feed(p, 'a,b\n1,2');
    expect(rows).toEqual([['1', '2']]);
  });

  it('accepts CRLF and lone CR line endings', () => {
    const p1 = new IncrementalCsvParser({ delimiter: ',' });
    expect(feed(p1, 'a,b\r\n1,2\r\n')).toEqual([['1', '2']]);
    const p2 = new IncrementalCsvParser({ delimiter: ',' });
    expect(feed(p2, 'a,b\r1,2\r')).toEqual([['1', '2']]);
  });

  it('reports progress in bytes and rows', () => {
    const p = new IncrementalCsvParser({ delimiter: ',' });
    feed(p, 'a,b\n1,2\n3,4\n');
    expect(p.bytesRead).toBe(12);
    expect(p.rowsEmitted).toBe(2);
  });
});

describe('detectDelimiter', () => {
  it('prefers tab for TSV even when commas appear in fields', () => {
    const sample = 'name\ttags\tcity\nAlice\t"redux, react"\tBeijing\nBob\t"ts, ui"\tXiamen\n';
    expect(detectDelimiter(sample)).toBe('\t');
  });

  it('detects semicolons', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6\n')).toBe(';');
  });

  it('defaults to comma for plain CSV', () => {
    expect(detectDelimiter('a,b\n1,2\n')).toBe(',');
  });
});
