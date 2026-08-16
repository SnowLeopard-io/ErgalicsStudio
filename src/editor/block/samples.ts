// ==========================================================================
// Ergalics Studio — block-mode sample programs (积木示例)
//
// Ready-to-load example programs shown in the BlockEditor's "示例" picker so
// new users can explore a working pipeline without assembling blocks from
// scratch. Bodies are IR (not Blockly JSON) — the editor round-trips them
// through convert.ts into live blocks.
// ==========================================================================

import { makeProgram, type IRNode, type IRProgram } from '../ir/types';

export interface BlockSample {
  id: string;
  name: string;
  nameI18n: Record<string, string>;
  description: string;
  descriptionI18n: Record<string, string>;
  body: IRNode[];
}

const ref = (name: string): IRNode => ({ kind: 'VarRef', name });
const num = (n: number): IRNode => ({ kind: 'Number', value: n });
const str = (s: string): IRNode => ({ kind: 'String', value: s });

export const BLOCK_SAMPLES: BlockSample[] = [
  {
    id: 'galaxy-scatter',
    name: '星系散点图',
    nameI18n: { 'en-US': 'Galaxy Scatter' },
    description: '载入 galaxy.dat，画出星系位置的散点图',
    descriptionI18n: { 'en-US': 'Load galaxy.dat and plot a scatter of positions' },
    body: [
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadXYZ', path: 'galaxy.dat' }, declare: true },
      { kind: 'PlotScatter', data: ref('df'), x: 'x', y: 'y' },
    ],
  },
  {
    id: 'telemetry-line',
    name: '温度折线图',
    nameI18n: { 'en-US': 'Temperature Line' },
    description: '载入 telemetry.csv，画出温度随时间的变化折线',
    descriptionI18n: { 'en-US': 'Load telemetry.csv and plot temperature over time' },
    body: [
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadCSV', path: 'telemetry.csv' }, declare: true },
      { kind: 'PlotLine', data: ref('df'), x: 'time', y: 'temp' },
    ],
  },
  {
    id: 'random-histogram',
    name: '随机数直方图',
    nameI18n: { 'en-US': 'Random Histogram' },
    description: '生成 1000 个随机数并统计直方图',
    descriptionI18n: { 'en-US': 'Generate 1000 random numbers and bin them' },
    body: [
      { kind: 'VarAssign', name: 'df', value: { kind: 'Random', count: num(1000), seed: num(1) }, declare: true },
      { kind: 'PlotHistogram', data: ref('df'), column: 'x' },
    ],
  },
  {
    id: 'normalize-scatter',
    name: '标准化后散点',
    nameI18n: { 'en-US': 'Normalize & Scatter' },
    description: '标准化温度列后，与时间做散点（min-max）',
    descriptionI18n: { 'en-US': 'Normalize temperature, then scatter against time' },
    body: [
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadCSV', path: 'telemetry.csv' }, declare: true },
      { kind: 'VarAssign', name: 'n', value: { kind: 'Normalize', data: ref('df'), column: 'temp', mode: 'minmax' }, declare: true },
      { kind: 'PlotScatter', data: ref('n'), x: 'time', y: 'temp_minmax' },
    ],
  },
  {
    id: 'repeat-print',
    name: '循环打招呼',
    nameI18n: { 'en-US': 'Loop & Print' },
    description: '重复 5 次在控制台输出「你好」',
    descriptionI18n: { 'en-US': 'Print "hello" 5 times' },
    body: [
      {
        kind: 'Repeat',
        count: num(5),
        body: [{ kind: 'StudioCall', method: 'print', args: [str('你好，积木！')] }],
      },
    ],
  },
];

/** Build an IR program from a sample's body. */
export function sampleProgram(sample: BlockSample): IRProgram {
  return makeProgram(sample.body, [], 'js');
}

export function sampleName(sample: BlockSample, locale: string): string {
  return sample.nameI18n[locale] ?? sample.name;
}

export function sampleDescription(sample: BlockSample, locale: string): string {
  return sample.descriptionI18n[locale] ?? sample.description;
}
