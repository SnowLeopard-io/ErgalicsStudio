// ==========================================================================
// Ergalics Studio — math block catalog (block system)
//
// Element-wise numeric math. Binary ops accept either a scalar or a second
// column; unary ops apply to a single column. All output as a new f64 column.
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import { addColumn, asFloat64, binaryColumn, unaryColumn } from '../ops';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const MATH_COLOR = '#E53935';

function makeBinaryMath(
  id: string,
  name: string,
  nameEn: string,
  description: string,
  descriptionEn: string,
  opName: string,
  op: (a: number, b: number) => number,
): BlockDefinition {
  return defineBlock(
    {
      id,
      category: 'math',
      name,
      nameI18n: { 'en-US': nameEn },
      description,
      descriptionI18n: { 'en-US': descriptionEn },
      color: MATH_COLOR,
      ...dataTableInOut(),
      defaultParams: { column: '', value: 0, otherColumn: '' },
    },
    async (ctx) => {
      const input = ctx.getInput('data') as DataTable;
      const column = String(ctx.getParam('column') ?? '');
      const other = ctx.getParam('otherColumn');
      const value = Number(ctx.getParam('value') ?? 0);
      const a = asFloat64(input, column);
      const result = other
        ? binaryColumn(a, asFloat64(input, String(other)), op)
        : binaryColumn(a, value, op);
      return addColumn(input, `${column}_${opName}`, 'f64', result);
    },
  );
}

function makeUnaryMath(
  id: string,
  name: string,
  nameEn: string,
  description: string,
  descriptionEn: string,
  opName: string,
  op: (v: number) => number,
): BlockDefinition {
  return defineBlock(
    {
      id,
      category: 'math',
      name,
      nameI18n: { 'en-US': nameEn },
      description,
      descriptionI18n: { 'en-US': descriptionEn },
      color: MATH_COLOR,
      ...dataTableInOut(),
      defaultParams: { column: '' },
    },
    async (ctx) => {
      const input = ctx.getInput('data') as DataTable;
      const column = String(ctx.getParam('column') ?? '');
      const result = unaryColumn(asFloat64(input, column), op);
      return addColumn(input, `${column}_${opName}`, 'f64', result);
    },
  );
}

export const addBlock = makeBinaryMath(
  'math.add',
  '加法',
  'Add',
  '逐元素相加',
  'Element-wise addition',
  'add',
  (a, b) => a + b,
);
export const subtractBlock = makeBinaryMath(
  'math.subtract',
  '减法',
  'Subtract',
  '逐元素相减',
  'Element-wise subtraction',
  'sub',
  (a, b) => a - b,
);
export const multiplyBlock = makeBinaryMath(
  'math.multiply',
  '乘法',
  'Multiply',
  '逐元素相乘',
  'Element-wise multiplication',
  'mul',
  (a, b) => a * b,
);
export const divideBlock = makeBinaryMath(
  'math.divide',
  '除法',
  'Divide',
  '逐元素相除',
  'Element-wise division',
  'div',
  (a, b) => a / b,
);
export const sqrtBlock = makeUnaryMath(
  'math.sqrt',
  '平方根',
  'Square Root',
  '逐元素平方根',
  'Element-wise square root',
  'sqrt',
  Math.sqrt,
);
export const absBlock = makeUnaryMath(
  'math.abs',
  '绝对值',
  'Absolute Value',
  '逐元素绝对值',
  'Element-wise absolute value',
  'abs',
  Math.abs,
);

export const mathBlocks: BlockDefinition[] = [
  addBlock,
  subtractBlock,
  multiplyBlock,
  divideBlock,
  sqrtBlock,
  absBlock,
];
