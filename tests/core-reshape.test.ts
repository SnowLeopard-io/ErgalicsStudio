import { describe, expect, it } from 'vitest';
import { createDataTable } from '@/types/datatable';
import { pivotLonger, pivotWider } from '@/core/dataeng/reshape';

function wide() {
  return createDataTable('wide', [
    { name: 'id', type: 'i32', data: new Int32Array([1, 2, 3]) },
    { name: 'group', type: 'string', data: ['a', 'a', 'b'] },
    { name: 't0', type: 'f64', data: new Float64Array([10, 20, 30]) },
    { name: 't1', type: 'f64', data: new Float64Array([11, 21, 31]) },
  ]);
}

describe('dataeng/reshape — pivotLonger', () => {
  it('stacks measure columns and repeats ids', () => {
    const long = pivotLonger(wide(), {
      idCols: ['id', 'group'],
      measureCols: ['t0', 't1'],
      namesTo: 'time',
      valuesTo: 'score',
    });
    expect(long.length).toBe(6);
    expect(long.columnNames()).toEqual(['id', 'group', 'time', 'score']);
    expect(Array.from(long.getColumn('id') as Int32Array)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(Array.from(long.getColumn('score') as Float64Array)).toEqual([10, 11, 20, 21, 30, 31]);
    expect(long.getColumn('time')).toEqual(['t0', 't1', 't0', 't1', 't0', 't1']);
  });

  it('drops missing values consistently across ids', () => {
    const table = createDataTable('t', [
      { name: 'id', type: 'i32', data: new Int32Array([1, 2]) },
      { name: 'a', type: 'f64', data: new Float64Array([1, NaN]) },
      { name: 'b', type: 'f64', data: new Float64Array([NaN, 4]) },
    ]);
    const long = pivotLonger(table, { idCols: ['id'], dropNA: true });
    expect(long.length).toBe(2);
    expect(Array.from(long.getColumn('id') as Int32Array)).toEqual([1, 2]);
    expect(Array.from(long.getColumn('value') as Float64Array)).toEqual([1, 4]);
  });

  it('rejects mixed measure types and bad column names', () => {
    const table = createDataTable('t', [
      { name: 'id', type: 'i32', data: new Int32Array([1, 2]) },
      { name: 'num', type: 'f64', data: new Float64Array([1, 2]) },
      { name: 'txt', type: 'string', data: ['a', 'b'] },
    ]);
    expect(() => pivotLonger(table, { idCols: ['id'], measureCols: ['num', 'txt'] })).toThrow();
    expect(() => pivotLonger(table, { idCols: ['missing'] })).toThrow();
  });
});

describe('dataeng/reshape — pivotWider', () => {
  it('inverts pivotLonger for a complete grid', () => {
    const long = pivotLonger(wide(), {
      idCols: ['id', 'group'],
      measureCols: ['t0', 't1'],
      namesTo: 'time',
      valuesTo: 'score',
    });
    const back = pivotWider(long, {
      idCols: ['id', 'group'],
      namesFrom: 'time',
      valuesFrom: 'score',
    });
    expect(back.length).toBe(3);
    expect(back.columnNames()).toEqual(['id', 'group', 't0', 't1']);
    expect(Array.from(back.getColumn('id') as Int32Array)).toEqual([1, 2, 3]);
    expect(Array.from(back.getColumn('t0') as Float64Array)).toEqual([10, 20, 30]);
    expect(Array.from(back.getColumn('t1') as Float64Array)).toEqual([11, 21, 31]);
  });

  it('fills incomplete combinations with NaN and supports a prefix', () => {
    const long = createDataTable('long', [
      { name: 'id', type: 'i32', data: new Int32Array([1, 1, 2]) },
      { name: 'time', type: 'string', data: ['t0', 't1', 't0'] },
      { name: 'score', type: 'f64', data: new Float64Array([1, 2, 3]) },
    ]);
    const wideTable = pivotWider(long, {
      idCols: ['id'],
      namesFrom: 'time',
      valuesFrom: 'score',
      namesPrefix: 'visit_',
    });
    expect(wideTable.columnNames()).toEqual(['id', 'visit_t0', 'visit_t1']);
    const t1 = Array.from(wideTable.getColumn('visit_t1') as Float64Array);
    expect(Number.isNaN(t1[1])).toBe(true);
    expect(t1[0]).toBe(2);
  });

  it('rejects duplicate (id, level) pairs', () => {
    const table = createDataTable('dupe', [
      { name: 'id', type: 'i32', data: new Int32Array([1, 1]) },
      { name: 'time', type: 'string', data: ['t0', 't0'] },
      { name: 'score', type: 'f64', data: new Float64Array([1, 2]) },
    ]);
    expect(() =>
      pivotWider(table, { idCols: ['id'], namesFrom: 'time', valuesFrom: 'score' }),
    ).toThrow();
  });
});
