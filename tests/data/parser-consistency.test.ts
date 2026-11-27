// ==========================================================================
// One CSV, three entry points: workbench import, editor StudioApi, and the
// Python/Notebook `studio` module. The parser rules live in exactly one place
// (src/core/data/parseDelimited.ts); these tests pin the observable result so
// a future "small fix" in one entry point cannot silently change n or a plot's
// point count in the others.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDataText } from '@/blocks/fileData';
import {
  defaultDelimitedName,
  parseDelimitedColumns,
  toPortableDelimitedTable,
  type PortableDelimitedTable,
} from '@/core/data/parseDelimited';
import { STUDIO_PYTHON_SOURCE } from '@/core/pyodide/studio.py';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import type { DataTable } from '@ergalics/plugin-sdk/types';

// Equivalent to the reported missing-4.csv: a provenance comment, Chinese
// header names, a quoted comma, trailing/empty cells and a missing row.
const CSV = [
  '# 示例数据：第 2、3 行含缺失值',
  '时间,样本,数值,备注',
  '1,"A,1",3.5,"ok"',
  '2,,,"缺测"',
  '3,中文,,""',
].join('\n');

interface Snapshot {
  names: string[];
  rows: number;
  cells: (number | string | boolean | null)[][];
}

function snapshotTable(table: DataTable): Snapshot {
  return {
    names: table.columns.map((column) => column.name),
    rows: table.length,
    cells: table.columns.map((column) => {
      const values = table.getColumn(column.name)! as ArrayLike<number | string | boolean>;
      return Array.from(values, (value) =>
        typeof value === 'number' && Number.isNaN(value) ? null : value,
      );
    }),
  };
}

function snapshotPortable(payload: PortableDelimitedTable): Snapshot {
  return {
    names: payload.columns.map((column) => column.name),
    rows: payload.rows,
    cells: payload.columns.map((column) => column.data),
  };
}

const host: StudioApiHost = {
  loadText: async () => CSV,
  renderView: async () => undefined,
  notify: () => undefined,
  print: () => undefined,
};

const shared = toPortableDelimitedTable(parseDelimitedColumns(CSV, defaultDelimitedName));
const expected: Snapshot = {
  names: ['时间', '样本', '数值', '备注'],
  rows: 3,
  cells: [
    [1, 2, 3],
    ['A,1', '', '中文'],
    [3.5, null, null],
    ['ok', '缺测', ''],
  ],
};

describe('delimited parser consistency across entry points', () => {

  it('applies the canonical header/comment/empty/quoted rules', () => {
    expect(snapshotPortable(shared)).toEqual(expected);
  });

  it('workbench import (parseDataText) matches the shared parser', () => {
    expect(snapshotTable(parseDataText(CSV, 'missing-4.csv'))).toEqual(expected);
  });

  it('editor StudioApi import matches the shared parser', () => {
    const api = createStudioApi(host);
    expect(snapshotTable(api.loadCSV(CSV))).toEqual(expected);
    // The path-based editor entry goes through the same dispatcher.
    return expect(api.load('missing-4.csv')).resolves.toEqual(
      expect.objectContaining({ length: expected.rows, columns: expect.any(Array) }),
    );
  });
});

// The Python module is a Python string evaluated by Pyodide. Under CPython we
// exercise the same glue with a bridge stub that replays the canonical
// parser's portable payload, plus an empty numpy stub (parsing never uses it).
// This checks that `studio.load_csv` preserves names, row count and missing
// cells instead of silently reimplementing its own CSV rules.
let pythonAvailable = true;
try {
  execFileSync('python', ['-c', 'pass'], { stdio: 'ignore' });
} catch {
  pythonAvailable = false;
}

describe.skipIf(!pythonAvailable)('Python/Notebook entry', () => {
  it('studio.load_csv consumes the shared parser payload unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ergalics-parser-'));
    const payloadPath = join(dir, 'payload.json');
    writeFileSync(payloadPath, JSON.stringify(shared), 'utf8');
    writeFileSync(
      join(dir, 'studio_bridge.py'),
      [
        'import json',
        'import os',
        '',
        'def parseDelimited(text, name_scheme):',
        '    with open(os.environ["PARSE_PAYLOAD"], encoding="utf-8") as handle:',
        '        return json.load(handle)',
        '',
        'def plot(*args, **kwargs):',
        '    pass',
        '',
        'def log(*args, **kwargs):',
        '    pass',
        '',
        'def notify(*args, **kwargs):',
        '    pass',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'numpy.py'), '', 'utf8');

    const script = `${STUDIO_PYTHON_SOURCE}
import json
df = studio.load_csv(${JSON.stringify(CSV)})
print(json.dumps({
    "names": df.column_names(),
    "rows": len(df),
    "cells": [[None if (isinstance(v, float) and v != v) else v for v in data]
              for _, data in df.columns],
}, ensure_ascii=False))`;
    const out = execFileSync('python', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: dir, PARSE_PAYLOAD: payloadPath },
    });
    const snapshot = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1)!) as Snapshot;
    expect(snapshot).toEqual(expected);
  });
});
