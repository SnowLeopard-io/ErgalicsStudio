// ==========================================================================
// Regression tests for the second audit round.
//
//   * The sweep executor published only a `value` metric, so a plan whose
//     "Metric path" named anything else failed in EVERY cell.
//   * The report builder's CSV parser treated `,`, `;` AND tab as
//     delimiters at once, shifting every following row by one cell.
//   * The epidemic plugin's model-config JSON skipped every parameter clamp,
//     so a population of 0 turned the whole trajectory into NaN.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { extractMetric } from '@/core/sweep/design';
import { parseCsv, detectCsvDelimiter } from '@/core/report/builder';
import { simulateEpidemic } from '@/plugins/builtin/med/epidemic/epidemic';
import type { ModelConfig } from '@/plugins/builtin/med/epidemic/epidemic';

describe('sweep: the configured metric path resolves', () => {
  const outcome = { metrics: { value: 42, rmse: 42 } };

  it('finds the default `value` metric', () => {
    expect(extractMetric(outcome, 'value')).toBe(42);
    expect(extractMetric(outcome, 'metrics.value')).toBe(42);
  });

  it('finds a metric published under its own name', () => {
    // The executor publishes the evaluated number under the plan's metric
    // path as well — this is what makes a renamed metric work.
    expect(extractMetric({ metrics: { rmse: 7 } }, 'rmse')).toBe(7);
    expect(extractMetric({ metrics: { rmse: 7 } }, 'metrics.rmse')).toBe(7);
  });

  it('returns NaN for a metric that was never published', () => {
    expect(Number.isNaN(extractMetric({ metrics: { value: 1 } }, 'loss'))).toBe(true);
  });
});

describe('report: the CSV delimiter is detected, not guessed', () => {
  it('splits a comma file on commas only', () => {
    const csv = 'name,note\nalpha,"a; b"\nbeta,c\n';
    const { columns, rows } = parseCsv(csv);
    expect(columns).toEqual(['name', 'note']);
    expect(rows[0]).toEqual(['alpha', 'a; b']);
    expect(rows[1]).toEqual(['beta', 'c']);
  });

  it('keeps a semicolon inside an unquoted cell of a comma file', () => {
    // The old parser split on the semicolon too → the row gained a column
    // and every later row was shifted by one.
    const csv = 'a,b\n1,2;3\n4,5\n';
    const { columns, rows } = parseCsv(csv);
    expect(columns).toEqual(['a', 'b']);
    expect(rows[0]).toEqual(['1', '2;3']);
    expect(rows[1]).toEqual(['4', '5']);
  });

  it('detects a semicolon-delimited file', () => {
    expect(detectCsvDelimiter('a;b;c\n1;2;3')).toBe(';');
    const { columns, rows } = parseCsv('a;b\n1;2\n');
    expect(columns).toEqual(['a', 'b']);
    expect(rows[0]).toEqual(['1', '2']);
  });

  it('detects a tab-delimited file', () => {
    expect(detectCsvDelimiter('a\tb\n1\t2')).toBe('\t');
  });

  it('defaults to a comma when there is no delimiter', () => {
    expect(detectCsvDelimiter('single')).toBe(',');
  });
});

describe('epidemic: the trajectory stays finite', () => {
  const base: ModelConfig = {
    model: 'SIR',
    r0: 2.5,
    infectiousDays: 5,
    latentDays: 3,
    population: 1000,
    initialInfected: 10,
    initialExposed: 0,
    days: 30,
    timeStep: 0.1,
  };

  it('produces finite values for a normal configuration', () => {
    const traj = simulateEpidemic(base);
    expect(traj.susceptible.every(Number.isFinite)).toBe(true);
    expect(traj.infectious.every(Number.isFinite)).toBe(true);
  });

  it('survives a zero population (the clamp must apply inside the kernel)', () => {
    // population 0 → the infection term became 0/0 = NaN.
    const traj = simulateEpidemic({ ...base, population: 0 });
    expect(traj.susceptible.every(Number.isFinite)).toBe(true);
    expect(traj.infectious.every(Number.isFinite)).toBe(true);
  });

  it('survives a zero infectious period (γ = 1/0)', () => {
    const traj = simulateEpidemic({ ...base, infectiousDays: 0 });
    expect(traj.infectious.every(Number.isFinite)).toBe(true);
  });
});
