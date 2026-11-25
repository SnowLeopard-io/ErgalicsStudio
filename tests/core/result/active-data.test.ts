import { describe, expect, it } from 'vitest';
import {
  appendMetricUnit,
  metricDisplayText,
} from '@/core/result/format';
import {
  getCurrentDataHash,
  getCurrentDataSource,
  resetCurrentDataSource,
  setCurrentDataHash,
  setCurrentDataSource,
} from '@/core/result/activeData';

describe('appendMetricUnit', () => {
  it('does not duplicate a unit already present in the value', () => {
    expect(appendMetricUnit('1135 ms', 'ms')).toBe('1135 ms');
    expect(metricDisplayText({ display: '1135 ms', value: '1135 ms', unit: 'ms' })).toBe('1135 ms');
  });

  it('appends the unit when the value does not carry it', () => {
    expect(appendMetricUnit('0.97', '')).toBe('0.97');
    expect(metricDisplayText({ display: '0.97', value: 0.97, unit: 'R²' })).toBe('0.97 R²');
  });

  it('falls back to the raw value string', () => {
    expect(metricDisplayText({ value: 42 })).toBe('42');
  });
});

describe('active data source (FR-1)', () => {
  it('starts empty and reports an empty hash', () => {
    resetCurrentDataSource();
    expect(getCurrentDataSource()).toBeNull();
    expect(getCurrentDataHash()).toBe('');
  });

  it('keeps the latest source and exposes hash + name', () => {
    resetCurrentDataSource();
    setCurrentDataSource({ name: 'samples.csv', hash: 'abc123', bytes: 10 });
    expect(getCurrentDataHash()).toBe('abc123');
    expect(getCurrentDataSource()).toMatchObject({ name: 'samples.csv', hash: 'abc123' });
  });

  it('supports hash-only updates and rejects empty hashes', () => {
    resetCurrentDataSource();
    setCurrentDataSource({ name: 'a.csv', hash: 'h1' });
    setCurrentDataHash('h2');
    expect(getCurrentDataSource()).toMatchObject({ name: 'a.csv', hash: 'h2' });
    setCurrentDataHash('');
    expect(getCurrentDataSource()).toBeNull();
    setCurrentDataSource({ name: 'b.csv', hash: '' });
    expect(getCurrentDataSource()).toBeNull();
  });
});
