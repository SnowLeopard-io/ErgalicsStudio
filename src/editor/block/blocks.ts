// ==========================================================================
// Ergalics Studio — Blockly block definitions (block mode)
//
// Custom Scratch-like blocks aligned 1:1 with the IR node kinds in
// `@/editor/ir`. Each block carries a JSON definition (registered via
// `Blockly.defineBlocksWithJsonArray`) and the field/input names that the
// JSON⇄IR converter (`convert.ts`) reads. Labels are Chinese-first (the
// primary learner audience); i18n via `message`/`tooltip` keyed by locale is
// a follow-up (block-code-modes.md §10.8).
// ==========================================================================

/** Blockly block-definition JSON objects. */
export interface BlockDef {
  type: string;
  message0?: string;
  args0?: unknown[];
  output?: string | null;
  previousStatement?: string | null;
  nextStatement?: string | null;
  colour?: string;
  style?: string;
  tooltip?: string;
  [key: string]: unknown;
}

const DATA_COLOUR = '#4C97FF';
const VAR_COLOUR = '#FF8C1A';
const OP_COLOUR = '#59C059';
const CONTROL_COLOUR = '#FFAB19';
const TRANSFORM_COLOUR = '#CF63CF';
const STAT_COLOUR = '#9966FF';
const VIZ_COLOUR = '#FF6680';
const UTIL_COLOUR = '#8A97A8';

function value(name: string): { type: string; name: string } {
  return { type: 'input_value', name };
}

function field(name: string, text: string): { type: string; name: string; text: string } {
  return { type: 'field_input', name, text };
}

function dropdown(name: string, options: [string, string][]): { type: string; name: string; options: [string, string][] } {
  return { type: 'field_dropdown', name, options };
}

function num(name: string, val: number): { type: string; name: string; value: number } {
  return { type: 'field_number', name, value: val };
}

const MATH_OPS: [string, string][] = [['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['%', '%']];
const COMPARE_OPS: [string, string][] = [['=', '=='], ['≠', '!='], ['<', '<'], ['≤', '<='], ['>', '>'], ['≥', '>=']];
const LOGIC_OPS: [string, string][] = [['且', 'and'], ['或', 'or']];

export const BLOCK_DEFS: BlockDef[] = [
  // ---- literals ----
  { type: 'studio_number', message0: '%1', args0: [num('NUM', 0)], output: null, colour: OP_COLOUR, tooltip: '数字' },
  { type: 'studio_string', message0: '%1', args0: [field('STR', '')], output: null, colour: OP_COLOUR, tooltip: '文本' },
  { type: 'studio_boolean', message0: '%1', args0: [dropdown('BOOL', [['真', 'true'], ['假', 'false']])], output: null, colour: OP_COLOUR, tooltip: '真/假' },

  // ---- variables ----
  { type: 'studio_var', message0: '变量 %1', args0: [field('NAME', 'x')], output: null, colour: VAR_COLOUR, tooltip: '读取变量' },
  { type: 'studio_var_assign', message0: '设 %1 = %2', args0: [field('NAME', 'x'), value('VALUE')], previousStatement: null, nextStatement: null, colour: VAR_COLOUR, tooltip: '给变量赋值' },

  // ---- data sources ----
  { type: 'studio_load_csv', message0: '载入 CSV %1', args0: [field('PATH', 'data.csv')], output: null, colour: DATA_COLOUR, tooltip: '从项目文件载入 CSV' },
  { type: 'studio_load_xyz', message0: '载入 XYZ %1', args0: [field('PATH', 'data.xyz')], output: null, colour: DATA_COLOUR, tooltip: '从项目文件载入 XYZ' },
  { type: 'studio_random', message0: '随机数 %1 个（种子 %2）', args0: [value('COUNT'), value('SEED')], output: null, colour: DATA_COLOUR, tooltip: '生成随机数表' },
  { type: 'studio_range', message0: '从 %1 到 %2 步长 %3', args0: [value('START'), value('STOP'), value('STEP')], output: null, colour: DATA_COLOUR, tooltip: '等差数列' },
  { type: 'studio_list', message0: '列表 %1', args0: [field('VALUES', '1,2,3')], output: null, colour: DATA_COLOUR, tooltip: '数字列表（逗号分隔）' },
  { type: 'studio_list_index', message0: '列表 %1 的第 %2 项', args0: [value('LIST'), value('INDEX')], output: null, colour: DATA_COLOUR, tooltip: '取列表第 i 项' },

  // ---- operators ----
  { type: 'studio_math_op', message0: '%1 %2 %3', args0: [value('A'), dropdown('OP', MATH_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '算术运算' },
  { type: 'studio_compare', message0: '%1 %2 %3', args0: [value('A'), dropdown('OP', COMPARE_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '比较运算' },
  { type: 'studio_logic_op', message0: '%1 %2 %3', args0: [value('A'), dropdown('OP', LOGIC_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '逻辑运算' },
  { type: 'studio_unary', message0: '%1 %2', args0: [dropdown('OP', [['非', 'not'], ['取负', '-']]), value('A')], output: null, colour: OP_COLOUR, tooltip: '取非 / 取负' },

  // ---- transforms ----
  { type: 'studio_normalize', message0: '标准化 %1 列 %2 方式 %3', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('MODE', [['min-max', 'minmax'], ['z-score', 'zscore']])], output: null, colour: TRANSFORM_COLOUR, tooltip: '归一化一列' },
  { type: 'studio_sort', message0: '排序 %1 列 %2 %3', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('DIR', [['升序', 'asc'], ['降序', 'desc']])], output: null, colour: TRANSFORM_COLOUR, tooltip: '按列排序' },
  { type: 'studio_select', message0: '选列 %1 %2', args0: [value('DATA'), field('COLUMNS', 'x,y')], output: null, colour: TRANSFORM_COLOUR, tooltip: '保留指定列（逗号分隔）' },
  { type: 'studio_filter', message0: '过滤 %1 列 %2 %3 %4', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('OP', COMPARE_OPS), value('VALUE')], output: null, colour: TRANSFORM_COLOUR, tooltip: '按条件过滤行' },

  // ---- statistics ----
  { type: 'studio_summary', message0: '统计摘要 %1 列 %2', args0: [value('DATA'), field('COLUMN', 'x')], output: null, colour: STAT_COLOUR, tooltip: '均值/标准差/最值/中位数' },
  { type: 'studio_histogram', message0: '直方图 %1 列 %2 分箱 %3', args0: [value('DATA'), field('COLUMN', 'x'), value('BINS')], output: null, colour: STAT_COLOUR, tooltip: '数值列分箱计数' },

  // ---- visualization (statements) ----
  { type: 'studio_plot_scatter', message0: '画散点图 %1 X:%2 Y:%3 颜色:%4', args0: [value('DATA'), field('X', 'x'), field('Y', 'y'), field('COLOR', '')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '二维散点图' },
  { type: 'studio_plot_histogram', message0: '画直方图 %1 列 %2', args0: [value('DATA'), field('COLUMN', 'x')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '直方图' },
  { type: 'studio_plot_pointcloud', message0: '画点云 %1 X:%2 Y:%3 Z:%4', args0: [value('DATA'), field('X', 'x'), field('Y', 'y'), field('Z', 'z')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '三维点云' },
  { type: 'studio_line', message0: '画折线图 %1 X:%2 Y:%3', args0: [value('DATA'), field('X', 'x'), field('Y', 'y')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '折线图' },

  // ---- control ----
  { type: 'studio_run', message0: '运行时', args0: [], nextStatement: null, colour: '#22C55E', tooltip: '程序从这里开始运行（唯一入口）' },
  { type: 'studio_while', message0: '当 %1 循环 %2', args0: [value('COND'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '条件成立时重复执行' },
  { type: 'studio_for_each', message0: '对 %1 里的每个 %2 执行 %3', args0: [value('LIST'), field('VAR', 'item'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '遍历列表' },
  { type: 'studio_repeat', message0: '重复 %1 次 %2', args0: [value('COUNT'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '重复执行' },
  { type: 'studio_if', message0: '如果 %1 则 %2 否则 %3', args0: [value('COND'), { type: 'input_statement', name: 'DO' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '条件分支' },

  // ---- util / host ----
  { type: 'studio_print', message0: '输出 %1', args0: [value('TEXT')], previousStatement: null, nextStatement: null, colour: UTIL_COLOUR, tooltip: '在控制台输出' },
  { type: 'studio_raw', message0: '原始代码 %1', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], previousStatement: null, nextStatement: null, colour: UTIL_COLOUR, tooltip: '无法用积木表达的原始代码' },
];
