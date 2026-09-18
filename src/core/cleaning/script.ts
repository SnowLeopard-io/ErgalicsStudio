// ==========================================================================
// Ergalics Studio — FR-14 data-cleaning wizard: script generator (pure TS)
//
// Renders a step list as a re-runnable Python script for code mode. The
// script loads the source file through `studio.load()` (the real code-mode
// API — see @/core/pyodide/studio.py.ts), applies every cleaning step with
// local pure-Python helpers whose semantics mirror `applySteps` cell for
// cell (missing tokens, numeric coercion, quantile interpolation, forward
// fill, IQR/z-score fences, first-wins dedupe), then rebuilds a DataTable
// (the class lives in the Pyodide worker's shared __main__ namespace, which
// is exactly how the studio module itself rebuilds tables) and prints it.
//
// The text is plain Python: unparseable-for-IR lines survive as RawCode in
// the editor session round-trip, so saving the script as a code session
// keeps it byte-identical.
// ==========================================================================

import { DEFAULT_IQR_MULTIPLIER, DEFAULT_ZSCORE_CUTOFF, type CleaningStep } from './steps';
import { outlierFlagColumn } from './steps';

export interface GenerateScriptOptions {
  /** Project data file name passed to studio.load(). */
  fileName: string;
  /** Name of the resulting table variable (default `cleaned`). */
  outputName?: string;
}

/** Quote a string as a Python literal (double quotes, JSON escaping is a subset). */
function pyStr(value: string): string {
  return JSON.stringify(value);
}

function pyNum(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/** Python source of the shared helper block (emitted once per script). */
function helpers(): string {
  return [
    '# ---- cleaning helpers (mirror the wizard engine cell-for-cell) ----',
    "_MISSING_TOKENS = {'na', 'n/a', 'nan', 'null', 'none', '.', '-'}",
    '',
    'def _missing(v):',
    '    if v is None:',
    '        return True',
    '    if isinstance(v, bool):',
    '        return False',
    '    if isinstance(v, float):',
    "        return v != v or v in (float('inf'), float('-inf'))",
    '    if isinstance(v, str):',
    '        s = v.strip()',
    "        return s == '' or s.lower() in _MISSING_TOKENS",
    '    return False',
    '',
    'def _num(v):',
    '    if _missing(v):',
    '        return None',
    '    if isinstance(v, bool):',
    '        return 1.0 if v else 0.0',
    '    if isinstance(v, (int, float)):',
    '        return float(v)',
    '    try:',
    '        return float(str(v).strip())',
    '    except ValueError:',
    '        return None',
    '',
    'def _bool(v):',
    '    if _missing(v):',
    '        return None',
    '    if isinstance(v, bool):',
    '        return v',
    '    if isinstance(v, (int, float)):',
    '        return None if v != v else (False if v == 0 else True)',
    '    s = str(v).strip().lower()',
    "    if s in ('true', '1', 'yes', 'y'):",
    '        return True',
    "    if s in ('false', '0', 'no', 'n'):",
    '        return False',
    '    return None',
    '',
    'def _quantile(values, q):',
    '    s = sorted(values)',
    '    if not s:',
    "        return float('nan')",
    '    pos = (len(s) - 1) * q',
    '    lo, hi = int(pos // 1), int(-(-pos // 1))',
    '    lo = min(lo, hi)',
    '    if lo == hi:',
    '        return s[lo]',
    '    return s[lo] + (s[hi] - s[lo]) * (pos - lo)',
    '',
    'def _mean(values):',
    '    return sum(values) / len(values) if values else float("nan")',
    '',
    'def _median(values):',
    '    return _quantile(values, 0.5)',
    '',
    'def _rows(T, order):',
    '    return len(T[order[0]]) if order else 0',
    '',
    'def _keep_rows(T, order, keep):',
    '    return {c: [T[c][i] for i in keep] for c in order}',
    '',
  ].join('\n');
}

/** Python source for one step, operating on `T` (dict col→list) + `order`. */
function stepSource(step: CleaningStep, index: number): string {
  const comment = `# step ${index + 1}: ${step.kind}`;
  switch (step.kind) {
    case 'convert': {
      const conv =
        step.target === 'number' ? '_num(v)' : step.target === 'boolean' ? '_bool(v)' : 'str(v).strip()';
      return [
        comment,
        `T[${pyStr(step.column)}] = [None if _missing(v) else ${conv} for v in T[${pyStr(step.column)}]]`,
      ].join('\n');
    }
    case 'missing': {
      const col = pyStr(step.column);
      if (step.strategy === 'drop') {
        return [
          comment,
          `keep = [i for i in range(_rows(T, order)) if not _missing(T[${col}][i])]`,
          `T = _keep_rows(T, order, keep)`,
        ].join('\n');
      }
      if (step.strategy === 'ffill') {
        return [
          comment,
          `_prev = None`,
          `_col = list(T[${col}])`,
          'for _i in range(len(_col)):',
          '    if _missing(_col[_i]):',
          '        if _prev is not None:',
          '            _col[_i] = _prev',
          '    else:',
          '        _prev = _col[_i]',
          `T[${col}] = _col`,
        ].join('\n');
      }
      const stat =
        step.strategy === 'zero'
          ? '0'
          : step.strategy === 'mean'
            ? `_mean([x for x in (_num(v) for v in T[${col}]) if x is not None] or [0])`
            : `_median([x for x in (_num(v) for v in T[${col}]) if x is not None] or [0])`;
      return [
        comment,
        `_fill = ${stat}`,
        `T[${col}] = [_fill if _missing(v) else v for v in T[${col}]]`,
      ].join('\n');
    }
    case 'outlier': {
      const col = pyStr(step.column);
      const flag = pyStr(outlierFlagColumn(step.column));
      const threshold = pyNum(
        Number.isFinite(step.threshold) && step.threshold > 0
          ? step.threshold
          : step.method === 'iqr'
            ? DEFAULT_IQR_MULTIPLIER
            : DEFAULT_ZSCORE_CUTOFF,
      );
      const bounds =
        step.method === 'iqr'
          ? [
              `_nums = [x for x in (_num(v) for v in T[${col}]) if x is not None]`,
              `if _nums:`,
              `    _q1 = _quantile(_nums, 0.25)`,
              `    _q3 = _quantile(_nums, 0.75)`,
              `    _fence = ${threshold} * (_q3 - _q1)`,
              `    _lo, _hi = _q1 - _fence, _q3 + _fence`,
              `else:`,
              `    _lo, _hi = float('inf'), float('-inf')`,
            ]
          : [
              `_nums = [x for x in (_num(v) for v in T[${col}]) if x is not None]`,
              `if _nums:`,
              `    _m = _mean(_nums)`,
              `    _sd = (sum((v - _m) ** 2 for v in _nums) / len(_nums)) ** 0.5`,
              `    _lo, _hi = (_m - ${threshold} * _sd, _m + ${threshold} * _sd) if _sd > 0 else (float('-inf'), float('inf'))`,
              `else:`,
              `    _lo, _hi = float('inf'), float('-inf')`,
            ];
      return [
        comment,
        ...bounds,
        `T[${flag}] = [(_num(v) is not None and (_num(v) < _lo or _num(v) > _hi)) for v in T[${col}]]`,
        `order = order + [${flag}]`,
      ].join('\n');
    }
    case 'dedupe': {
      const keys =
        step.columns.length === 0
          ? 'order'
          : `[${step.columns.map((c) => pyStr(c)).join(', ')}]`;
      return [
        comment,
        `_keys = ${keys}`,
        `_seen = set()`,
        `keep = []`,
        'for _i in range(_rows(T, order)):',
        '    _k = tuple([None if _missing(T[c][_i]) else T[c][_i] for c in _keys])',
        '    if _k in _seen:',
        '        continue',
        '    _seen.add(_k)',
        '    keep.append(_i)',
        `T = _keep_rows(T, order, keep)`,
      ].join('\n');
    }
    case 'rename': {
      return [
        comment,
        `T[${pyStr(step.to)}] = T.pop(${pyStr(step.from)})`,
        `order = [${pyStr(step.to)} if c == ${pyStr(step.from)} else c for c in order]`,
      ].join('\n');
    }
  }
}

/**
 * Generate the equivalent re-runnable `studio.*` cleaning script. The output
 * is deterministic for a given (fileName, steps) pair so it can be snapshot
 * tested and diffed across runs.
 */
export function generateScript(steps: CleaningStep[], options: GenerateScriptOptions): string {
  const outputName = options.outputName?.trim() || 'cleaned';
  const lines: string[] = [
    '# ==========================================================================',
    '# Ergalics Studio — data cleaning script (generated by the cleaning wizard)',
    `# Source file: ${options.fileName}`,
    '# Re-run in code mode to reproduce the cleaned table exactly.',
    '# ==========================================================================',
    '',
    `df = studio.load(${pyStr(options.fileName)})`,
    'order = [name for name, _ in df.columns]',
    'T = {name: list(values) for name, values in df.columns}',
    '',
    helpers(),
  ];
  steps.forEach((step, i) => {
    lines.push(stepSource(step, i), '');
  });
  lines.push(
    `# ---- result: ${outputName} ----`,
    `${outputName} = DataTable('${outputName}', [(c, T[c]) for c in order], provenance='cleaning-wizard')`,
    `studio.print('${outputName}: %d rows x %d cols' % (_rows(T, order), len(order)))`,
    '',
  );
  return lines.join('\n');
}
