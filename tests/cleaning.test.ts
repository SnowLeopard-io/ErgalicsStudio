// ==========================================================================
// FR-14 data-cleaning wizard — core tests
//
// Covers the row-table parser (CSV/TSV/whitespace/JSON, missing tokens),
// every CleaningStep kind through applySteps (correctness + affected-row
// counts), step JSON round-trips and structural validation, previewStep
// sampling, validateSteps dependency warnings, and the deterministic
// studio.* script generator. Also guards zh/en key parity for the new
// `cleaning` dictionary (the merge into modules.ts is owned by the app).
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  isMissing,
  mean,
  median,
  parseTableText,
  quantile,
  tableToCsv,
  toBoolean,
  toNumber,
  type Cell,
  type CleaningTable,
} from '@/core/cleaning/table';
import {
  applySteps,
  CleaningStepError,
  DEFAULT_IQR_MULTIPLIER,
  DEFAULT_ZSCORE_CUTOFF,
  outlierFlagColumn,
  previewStep,
  stepsFromJson,
  stepsToJson,
  validateSteps,
  type CleaningStep,
} from '@/core/cleaning/steps';
import { generateScript } from '@/core/cleaning/script';
import { cleaningEn, cleaningZh } from '@/i18n/dicts/cleaning';

// ---- helpers ----------------------------------------------------------------

function table(columns: string[], rows: Cell[][]): CleaningTable {
  return { columns, rows };
}

function col(table_: CleaningTable, name: string): Cell[] {
  const idx = table_.columns.indexOf(name);
  return table_.rows.map((r) => r[idx] ?? null);
}

function errCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof CleaningStepError ? err.code : `plain:${String(err)}`;
  }
  return undefined;
}

// ---- table model --------------------------------------------------------------

describe('cleaning table model', () => {
  it('recognises missing cells', () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing('')).toBe(true);
    expect(isMissing('  ')).toBe(true);
    for (const token of ['NA', 'n/a', 'NaN', 'null', 'None', '.', '-']) {
      expect(isMissing(token)).toBe(true);
    }
    expect(isMissing(0)).toBe(false);
    expect(isMissing(Number.NaN)).toBe(true);
    expect(isMissing(false)).toBe(false);
  });

  it('coerces cells to numbers and booleans', () => {
    expect(toNumber('42')).toBe(42);
    expect(toNumber('1e3')).toBe(1000);
    expect(toNumber('x')).toBeNull();
    expect(toNumber(true)).toBe(1);
    expect(toNumber(null)).toBeNull();
    expect(toBoolean('yes')).toBe(true);
    expect(toBoolean('0')).toBe(false);
    expect(toBoolean('maybe')).toBeNull();
  });

  it('parses delimited CSV with header and missing tokens', () => {
    const t = parseTableText('temp,pressure\n20,101.3\nNA,99\n', 'data.csv');
    expect(t.columns).toEqual(['temp', 'pressure']);
    expect(t.rows).toEqual([
      ['20', '101.3'],
      [null, '99'],
    ]);
  });

  it('names columns c0.. when the first line is numeric', () => {
    const t = parseTableText('1 2\n3 4\n', 'points.dat');
    expect(t.columns).toEqual(['c0', 'c1']);
    expect(t.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('parses semicolon-delimited text', () => {
    const t = parseTableText('a;b\n1;2', 's.txt');
    expect(t.columns).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2']]);
  });

  it('keeps quoted commas inside fields', () => {
    const t = parseTableText('name,note\n"Doe, J.",ok', 'q.csv');
    expect(t.rows).toEqual([['Doe, J.', 'ok']]);
  });

  it('parses JSON row records and column payloads', () => {
    const records = parseTableText('[{"a":1,"b":null},{"a":2,"c":"x"}]', 'r.json');
    expect(records.columns).toEqual(['a', 'b', 'c']);
    expect(records.rows).toEqual([
      [1, null, null],
      [2, null, 'x'],
    ]);
    const cols = parseTableText('{"columns":[{"name":"v","data":[1,null]},{"name":"w","data":["x"]}]}', 'c.json');
    expect(cols.columns).toEqual(['v', 'w']);
    expect(cols.rows).toEqual([
      [1, 'x'],
      [null, null],
    ]);
  });

  it('rejects empty or unsupported input', () => {
    expect(() => parseTableText('   \n\n', 'empty.csv')).toThrow(/empty/);
    expect(() => parseTableText('[1,2]', 'bad.json')).toThrow(/unsupported JSON/);
  });

  it('round-trips through CSV serialization', () => {
    const t = table(['a', 'b'], [['x,y', 2], [null, 'plain']]);
    const csv = tableToCsv(t);
    expect(csv).toBe('a,b\n"x,y",2\n,plain');
    const back = parseTableText(csv, 'rt.csv');
    expect(back.columns).toEqual(['a', 'b']);
    expect(back.rows[0]).toEqual(['x,y', '2']);
    expect(back.rows[1]).toEqual([null, 'plain']);
  });

  it('computes type-7 quantiles, mean and median', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(median([4, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 12);
    expect(mean([2, 4])).toBe(3);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

// ---- step engine ----------------------------------------------------------------

describe('applySteps — convert', () => {
  const step: CleaningStep = { id: 's1', kind: 'convert', column: 'v', target: 'number' };

  it('converts numeric strings and reports changed cells', () => {
    const t = table(['v'], [['1'], ['2'], ['x'], [null]]);
    const { table: out, outcomes } = applySteps(t, [step]);
    expect(col(out, 'v')).toEqual([1, 2, null, null]);
    expect(outcomes[0]?.affected).toBe(3);
    expect(outcomes[0]?.rowsBefore).toBe(4);
    expect(outcomes[0]?.rowsAfter).toBe(4);
  });

  it('converts to boolean and trimmed string', () => {
    const boolStep: CleaningStep = { id: 'b', kind: 'convert', column: 'v', target: 'boolean' };
    const out1 = applySteps(table(['v'], [['true'], ['0'], ['yes'], ['bogus']]), [boolStep]).table;
    expect(col(out1, 'v')).toEqual([true, false, true, null]);

    const strStep: CleaningStep = { id: 's', kind: 'convert', column: 'v', target: 'string' };
    const out2 = applySteps(table(['v'], [[' 1 '], [2]]), [strStep]).table;
    expect(col(out2, 'v')).toEqual(['1', '2']);
  });

  it('throws unknown-column for a missing column', () => {
    const bad: CleaningStep = { id: 'x', kind: 'convert', column: 'zzz', target: 'number' };
    try {
      applySteps(table(['v'], [['1']]), [bad]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CleaningStepError);
      const e = err as CleaningStepError;
      expect(e.code).toBe('unknown-column');
      expect(e.column).toBe('zzz');
      expect(e.stepId).toBe('x');
    }
  });
});

describe('applySteps — missing-value policies', () => {
  const withHoles = () => table(['v'], [[2], [null], [4], ['NA'], [100]]);

  it('drop removes the missing rows', () => {
    const r = applySteps(withHoles(), [{ id: 'm', kind: 'missing', column: 'v', strategy: 'drop' }]);
    expect(col(r.table, 'v')).toEqual([2, 4, 100]);
    expect(r.outcomes[0]?.affected).toBe(2);
    expect(r.outcomes[0]?.rowsBefore).toBe(5);
    expect(r.outcomes[0]?.rowsAfter).toBe(3);
  });

  it('mean / median / zero fill the holes', () => {
    const fill = (strategy: 'mean' | 'median' | 'zero') =>
      applySteps(withHoles(), [{ id: 'm', kind: 'missing', column: 'v', strategy }]);
    const meanFilled = col(fill('mean').table, 'v');
    expect(meanFilled[0]).toBe(2);
    expect(meanFilled[1]).toBeCloseTo(106 / 3, 9);
    expect(meanFilled[2]).toBe(4);
    expect(meanFilled[3]).toBeCloseTo(106 / 3, 9);
    expect(meanFilled[4]).toBe(100);
    expect(fill('mean').outcomes[0]?.affected).toBe(2);
    expect(col(fill('median').table, 'v')).toEqual([2, 4, 4, 4, 100]);
    expect(col(fill('zero').table, 'v')).toEqual([2, 0, 4, 0, 100]);
  });

  it('ffill carries the previous value and keeps leading holes', () => {
    const t = table(['v'], [[null], [1], [null], [null], [2]]);
    const r = applySteps(t, [{ id: 'm', kind: 'missing', column: 'v', strategy: 'ffill' }]);
    expect(col(r.table, 'v')).toEqual([null, 1, 1, 1, 2]);
    expect(r.outcomes[0]?.affected).toBe(2);
    expect(r.outcomes[0]?.rowsAfter).toBe(5);
  });

  it('fills with 0 when the column has no numeric values', () => {
    const r = applySteps(table(['v'], [['a'], [null]]), [
      { id: 'm', kind: 'missing', column: 'v', strategy: 'mean' },
    ]);
    expect(col(r.table, 'v')).toEqual(['a', 0]);
  });
});

describe('applySteps — outlier flagging', () => {
  it('IQR fence flags beyond q1/q3 ± threshold·IQR and appends a flag column', () => {
    const t = table(['v'], [[1], [2], [3], [4], [100]]);
    const r = applySteps(t, [
      { id: 'o', kind: 'outlier', column: 'v', method: 'iqr', threshold: DEFAULT_IQR_MULTIPLIER },
    ]);
    expect(outlierFlagColumn('v')).toBe('v_outlier');
    expect(r.table.columns).toEqual(['v', 'v_outlier']);
    expect(col(r.table, 'v_outlier')).toEqual([false, false, false, false, true]);
    expect(r.outcomes[0]?.affected).toBe(1);
    expect(r.outcomes[0]?.rowsAfter).toBe(5);
  });

  it('z-score uses the population std and the configured cutoff', () => {
    const t = table(['v'], [[0], [0], [0], [10]]);
    const strict = applySteps(t, [
      { id: 'o', kind: 'outlier', column: 'v', method: 'zscore', threshold: 1.5 },
    ]);
    expect(col(strict.table, 'v_outlier')).toEqual([false, false, false, true]);
    const loose = applySteps(t, [
      { id: 'o', kind: 'outlier', column: 'v', method: 'zscore', threshold: DEFAULT_ZSCORE_CUTOFF },
    ]);
    expect(loose.outcomes[0]?.affected).toBe(0);
  });

  it('constant columns (zero std) and empty numeric sets flag nothing', () => {
    const flat = applySteps(table(['v'], [[5], [5], [5]]), [
      { id: 'o', kind: 'outlier', column: 'v', method: 'zscore', threshold: 1 },
    ]);
    expect(flat.outcomes[0]?.affected).toBe(0);
    const nonNum = applySteps(table(['v'], [['a'], ['b']]), [
      { id: 'o', kind: 'outlier', column: 'v', method: 'iqr', threshold: 1.5 },
    ]);
    expect(nonNum.outcomes[0]?.affected).toBe(0);
  });

  it('rejects non-positive thresholds', () => {
    expect(
      errCode(() =>
        applySteps(table(['v'], [[1]]), [
          { id: 'o', kind: 'outlier', column: 'v', method: 'iqr', threshold: 0 },
        ]),
      ),
    ).toBe('invalid-threshold');
  });
});

describe('applySteps — dedupe and rename', () => {
  it('whole-row dedupe keeps the first occurrence', () => {
    const t = table(['a', 'b'], [[1, 'x'], [1, 'x'], [2, 'y'], [1, 'x']]);
    const r = applySteps(t, [{ id: 'd', kind: 'dedupe', columns: [] }]);
    expect(r.table.rows).toEqual([[1, 'x'], [2, 'y']]);
    expect(r.outcomes[0]?.affected).toBe(2);
    expect(r.outcomes[0]?.rowsAfter).toBe(2);
  });

  it('key-column dedupe ignores non-key differences', () => {
    const t = table(['id', 'v'], [[1, 'a'], [1, 'b'], [2, 'c']]);
    const r = applySteps(t, [{ id: 'd', kind: 'dedupe', columns: ['id'] }]);
    expect(r.table.rows).toEqual([[1, 'a'], [2, 'c']]);
    expect(r.outcomes[0]?.affected).toBe(1);
  });

  it('dedupe on an unknown key column throws', () => {
    expect(
      errCode(() => applySteps(table(['a'], [[1]]), [{ id: 'd', kind: 'dedupe', columns: ['zz'] }])),
    ).toBe('unknown-column');
  });

  it('rename changes the header without touching rows', () => {
    const t = table(['a', 'b'], [[1, 2]]);
    const r = applySteps(t, [{ id: 'r', kind: 'rename', from: 'a', to: 'temp' }]);
    expect(r.table.columns).toEqual(['temp', 'b']);
    expect(r.table.rows).toEqual([[1, 2]]);
    expect(r.outcomes[0]?.affected).toBe(0);
  });

  it('rename to an existing column throws duplicate-column; self-rename is a no-op', () => {
    const t = table(['a', 'b'], [[1, 2]]);
    expect(
      errCode(() => applySteps(t, [{ id: 'r', kind: 'rename', from: 'a', to: 'b' }])),
    ).toBe('duplicate-column');
    const same = applySteps(t, [{ id: 'r', kind: 'rename', from: 'a', to: 'a' }]);
    expect(same.table.columns).toEqual(['a', 'b']);
  });
});

describe('applySteps — composition', () => {
  it('runs steps in order and returns one outcome per step', () => {
    const t = table(['v'], [['1'], ['2'], ['x'], [null]]);
    const steps: CleaningStep[] = [
      { id: '1', kind: 'convert', column: 'v', target: 'number' },
      { id: '2', kind: 'missing', column: 'v', strategy: 'drop' },
      { id: '3', kind: 'rename', from: 'v', to: 'value' },
    ];
    const r = applySteps(t, steps);
    expect(r.outcomes.map((o) => o.step.id)).toEqual(['1', '2', '3']);
    expect(r.table.columns).toEqual(['value']);
    expect(r.table.rows).toEqual([[1], [2]]);
    expect(r.outcomes[1]?.affected).toBe(2);
  });

  it('does not mutate the input table', () => {
    const t = table(['v'], [[1], [null]]);
    applySteps(t, [{ id: 'm', kind: 'missing', column: 'v', strategy: 'drop' }]);
    expect(t.rows).toEqual([[1], [null]]);
  });
});

// ---- serialization ---------------------------------------------------------------

describe('step serialization', () => {
  const allKinds: CleaningStep[] = [
    { id: 'a', kind: 'convert', column: 'v', target: 'number' },
    { id: 'b', kind: 'missing', column: 'v', strategy: 'median' },
    { id: 'c', kind: 'outlier', column: 'v', method: 'zscore', threshold: 2.5 },
    { id: 'd', kind: 'dedupe', columns: ['v', 'w'] },
    { id: 'e', kind: 'rename', from: 'v', to: 'value' },
  ];

  it('round-trips through JSON', () => {
    expect(stepsFromJson(stepsToJson(allKinds))).toEqual(allKinds);
  });

  it('rejects malformed documents with bad-step', () => {
    expect(() => stepsFromJson('not json')).toThrow(CleaningStepError);
    expect(errCode(() => stepsFromJson('{"kind":"convert"}'))).toBe('bad-step');
    expect(errCode(() => stepsFromJson('[{"kind":"nope","id":"x"}]'))).toBe('bad-step');
    expect(errCode(() => stepsFromJson('[{"kind":"convert","id":"x","column":"v","target":"blob"}]'))).toBe(
      'bad-step',
    );
    expect(errCode(() => stepsFromJson('[{"kind":"convert","column":"v","target":"number"}]'))).toBe(
      'bad-step',
    );
  });

  it('falls back to default thresholds for invalid outlier thresholds', () => {
    const revived = stepsFromJson(
      '[{"id":"o","kind":"outlier","column":"v","method":"iqr","threshold":-1},' +
        '{"id":"z","kind":"outlier","column":"v","method":"zscore","threshold":"abc"}]',
    );
    const [iq, zs] = revived;
    expect(iq?.kind === 'outlier' && iq.threshold).toBe(DEFAULT_IQR_MULTIPLIER);
    expect(zs?.kind === 'outlier' && zs.threshold).toBe(DEFAULT_ZSCORE_CUTOFF);
  });
});

// ---- preview ------------------------------------------------------------------------

describe('previewStep', () => {
  const big = table(['v'], Array.from({ length: 10 }, (_, i) => [i + 1]));

  it('samples the head of both tables and reports the impact', () => {
    const p = previewStep(big, { id: 'm', kind: 'missing', column: 'v', strategy: 'drop' }, 3);
    expect(p.before).toEqual([[1], [2], [3]]);
    expect(p.after).toEqual([[1], [2], [3]]);
    expect(p.affected).toBe(0);
    expect(p.rowsBefore).toBe(10);
    expect(p.rowsAfter).toBe(10);
  });

  it('reflects header changes for rename and outlier steps', () => {
    const rename = previewStep(big, { id: 'r', kind: 'rename', from: 'v', to: 'w' });
    expect(rename.afterColumns).toEqual(['w']);
    const outlier = previewStep(big, { id: 'o', kind: 'outlier', column: 'v', method: 'iqr', threshold: 1.5 });
    expect(outlier.afterColumns).toEqual(['v', 'v_outlier']);
    expect(outlier.after[0]).toEqual([1, false]);
  });

  it('drop preview shortens the sampled head', () => {
    const t = table(['v'], [[1], [null], [3], [4], [5], [6]]);
    const p = previewStep(t, { id: 'm', kind: 'missing', column: 'v', strategy: 'drop' }, 5);
    expect(p.before).toHaveLength(5);
    expect(p.after).toEqual([[1], [3], [4], [5], [6]]);
    expect(p.affected).toBe(1);
  });
});

// ---- validation ------------------------------------------------------------------------

describe('validateSteps', () => {
  it('flags steps left dangling by a rename', () => {
    const warnings = validateSteps(
      [
        { id: 'r', kind: 'rename', from: 'a', to: 'c' },
        { id: 'x', kind: 'convert', column: 'a', target: 'number' },
      ],
      ['a', 'b'],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ stepIndex: 1, stepId: 'x', code: 'unknown-column', column: 'a' });
  });

  it('flags a rename onto an existing column', () => {
    const warnings = validateSteps([{ id: 'r', kind: 'rename', from: 'a', to: 'b' }], ['a', 'b']);
    expect(warnings[0]?.code).toBe('duplicate-column');
  });

  it('accepts later steps that consume the outlier flag column', () => {
    const warnings = validateSteps(
      [
        { id: 'o', kind: 'outlier', column: 'a', method: 'iqr', threshold: 1.5 },
        { id: 'c', kind: 'convert', column: 'a_outlier', target: 'boolean' },
      ],
      ['a'],
    );
    expect(warnings).toEqual([]);
  });

  it('checks dedupe key columns', () => {
    const warnings = validateSteps([{ id: 'd', kind: 'dedupe', columns: ['nope'] }], ['a']);
    expect(warnings[0]).toMatchObject({ code: 'unknown-column', column: 'nope' });
  });
});

// ---- script generation ---------------------------------------------------------------------

describe('generateScript', () => {
  const steps: CleaningStep[] = [
    { id: 'a', kind: 'convert', column: 'v', target: 'number' },
    { id: 'b', kind: 'missing', column: 'v', strategy: 'drop' },
    { id: 'c', kind: 'missing', column: 'w', strategy: 'ffill' },
    { id: 'd', kind: 'outlier', column: 'v', method: 'iqr', threshold: 1.5 },
    { id: 'e', kind: 'dedupe', columns: ['w'] },
    { id: 'f', kind: 'rename', from: 'v', to: 'value' },
  ];

  it('is deterministic for the same input', () => {
    const a = generateScript(steps, { fileName: 'data.csv' });
    const b = generateScript(steps, { fileName: 'data.csv' });
    expect(a).toBe(b);
  });

  it('loads the source through studio.load and rebuilds a DataTable', () => {
    const script = generateScript(steps, { fileName: 'data.csv' });
    expect(script).toContain('df = studio.load("data.csv")');
    expect(script).toContain("DataTable('cleaned', [(c, T[c]) for c in order], provenance='cleaning-wizard')");
    expect(script).toContain('studio.print(');
    expect(script).toContain('_MISSING_TOKENS');
  });

  it('emits one commented block per step with kind-specific code', () => {
    const script = generateScript(steps, { fileName: 'data.csv' });
    expect(script).toContain('# step 1: convert');
    expect(script).toContain('T["v"] = [None if _missing(v) else _num(v) for v in T["v"]]');
    expect(script).toContain('# step 2: missing');
    expect(script).toContain('T = _keep_rows(T, order, keep)');
    expect(script).toContain('# step 3: missing');
    expect(script).toContain('_prev = None');
    expect(script).toContain('# step 4: outlier');
    expect(script).toContain('T["v_outlier"]');
    expect(script).toContain('order = order + ["v_outlier"]');
    expect(script).toContain('# step 5: dedupe');
    expect(script).toContain('_keys = ["w"]');
    expect(script).toContain('# step 6: rename');
    expect(script).toContain('T["value"] = T.pop("v")');
  });

  it('honours a custom output name and empty step lists', () => {
    const script = generateScript([], { fileName: 'x.tsv', outputName: 'tidy' });
    expect(script).toContain("df = studio.load(\"x.tsv\")");
    expect(script).toContain("tidy = DataTable('tidy'");
    // No step blocks are emitted — only the header, helpers and the result.
    expect(script).not.toContain('# step 1');
    expect(script).toContain('# ---- result: tidy ----');
  });

  it('uses the whole-row key set for an empty dedupe column list', () => {
    const script = generateScript([{ id: 'd', kind: 'dedupe', columns: [] }], { fileName: 'a.csv' });
    expect(script).toContain('_keys = order');
  });
});

// ---- dictionary parity ----------------------------------------------------------------------

describe('cleaning dictionary', () => {
  it('keeps zh and en key sets identical', () => {
    const zh = Object.keys(cleaningZh).sort();
    const en = Object.keys(cleaningEn).sort();
    expect(zh).toEqual(en);
    expect(zh.length).toBeGreaterThan(40);
  });

  it('every clean. key uses the documented prefix', () => {
    for (const key of Object.keys(cleaningZh)) {
      expect(key.startsWith('clean.') || key.startsWith('tool.')).toBe(true);
    }
  });
});
