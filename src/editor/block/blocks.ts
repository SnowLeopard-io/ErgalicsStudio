// ==========================================================================
// Ergalics Studio — Blockly block definitions (block mode)
//
// Custom Scratch-like blocks aligned 1:1 with the IR node kinds in
// `@/editor/ir`. Labels/tooltips use `%{BKY_XXX}` references resolved against
// `Blockly.Msg` (see `i18n.ts`) so blocks re-label when the app language
// switches (editor architecture §10.8).
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

const MATH_OPS: [string, string][] = [
  ['%{BKY_OP_ADD}', '+'], ['%{BKY_OP_SUB}', '-'], ['%{BKY_OP_MUL}', '*'],
  ['%{BKY_OP_DIV}', '/'], ['%{BKY_OP_MOD}', '%'],
];
const COMPARE_OPS: [string, string][] = [
  ['%{BKY_CMP_EQ}', '=='], ['%{BKY_CMP_NE}', '!='], ['%{BKY_CMP_LT}', '<'],
  ['%{BKY_CMP_LE}', '<='], ['%{BKY_CMP_GT}', '>'], ['%{BKY_CMP_GE}', '>='],
];
const LOGIC_OPS: [string, string][] = [
  ['%{BKY_LOGIC_AND}', 'and'], ['%{BKY_LOGIC_OR}', 'or'],
];

export const BLOCK_DEFS: BlockDef[] = [
  // ---- literals ----
  { type: 'studio_number', message0: '%{BKY_STUDIO_NUMBER}', args0: [num('NUM', 0)], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_NUMBER_TOOLTIP}' },
  { type: 'studio_string', message0: '%{BKY_STUDIO_STRING}', args0: [field('STR', '')], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_STRING_TOOLTIP}' },
  { type: 'studio_boolean', message0: '%{BKY_STUDIO_BOOLEAN}', args0: [dropdown('BOOL', [['%{BKY_BOOL_TRUE}', 'true'], ['%{BKY_BOOL_FALSE}', 'false']])], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_BOOLEAN_TOOLTIP}' },

  // ---- variables ----
  { type: 'studio_var', message0: '%{BKY_STUDIO_VAR}', args0: [field('NAME', 'x')], output: null, colour: VAR_COLOUR, tooltip: '%{BKY_STUDIO_VAR_TOOLTIP}' },
  { type: 'studio_var_assign', message0: '%{BKY_STUDIO_VAR_ASSIGN}', args0: [field('NAME', 'x'), value('VALUE')], previousStatement: null, nextStatement: null, colour: VAR_COLOUR, tooltip: '%{BKY_STUDIO_VAR_ASSIGN_TOOLTIP}' },

  // ---- data sources ----
  { type: 'studio_load_csv', message0: '%{BKY_STUDIO_LOAD_CSV}', args0: [field('PATH', 'data.csv')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_LOAD_CSV_TOOLTIP}' },
  { type: 'studio_load_xyz', message0: '%{BKY_STUDIO_LOAD_XYZ}', args0: [field('PATH', 'data.xyz')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_LOAD_XYZ_TOOLTIP}' },
  { type: 'studio_random', message0: '%{BKY_STUDIO_RANDOM}', args0: [value('COUNT'), value('SEED')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_RANDOM_TOOLTIP}' },
  { type: 'studio_range', message0: '%{BKY_STUDIO_RANGE}', args0: [value('START'), value('STOP'), value('STEP')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_RANGE_TOOLTIP}' },
  { type: 'studio_list', message0: '%{BKY_STUDIO_LIST}', args0: [field('VALUES', '1,2,3')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_LIST_TOOLTIP}' },
  { type: 'studio_list_index', message0: '%{BKY_STUDIO_LIST_INDEX}', args0: [value('LIST'), value('INDEX')], output: null, colour: DATA_COLOUR, tooltip: '%{BKY_STUDIO_LIST_INDEX_TOOLTIP}' },

  // ---- operators ----
  { type: 'studio_math_op', message0: '%{BKY_STUDIO_MATH_OP}', args0: [value('A'), dropdown('OP', MATH_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_MATH_OP_TOOLTIP}' },
  { type: 'studio_compare', message0: '%{BKY_STUDIO_COMPARE}', args0: [value('A'), dropdown('OP', COMPARE_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_COMPARE_TOOLTIP}' },
  { type: 'studio_logic_op', message0: '%{BKY_STUDIO_LOGIC_OP}', args0: [value('A'), dropdown('OP', LOGIC_OPS), value('B')], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_LOGIC_OP_TOOLTIP}' },
  { type: 'studio_unary', message0: '%{BKY_STUDIO_UNARY}', args0: [dropdown('OP', [['%{BKY_UNARY_NOT}', 'not'], ['%{BKY_UNARY_NEG}', '-']]), value('A')], output: null, colour: OP_COLOUR, tooltip: '%{BKY_STUDIO_UNARY_TOOLTIP}' },

  // ---- transforms ----
  { type: 'studio_normalize', message0: '%{BKY_STUDIO_NORMALIZE}', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('MODE', [['%{BKY_MODE_MINMAX}', 'minmax'], ['%{BKY_MODE_ZSCORE}', 'zscore']])], output: null, colour: TRANSFORM_COLOUR, tooltip: '%{BKY_STUDIO_NORMALIZE_TOOLTIP}' },
  { type: 'studio_sort', message0: '%{BKY_STUDIO_SORT}', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('DIR', [['%{BKY_DIR_ASC}', 'asc'], ['%{BKY_DIR_DESC}', 'desc']])], output: null, colour: TRANSFORM_COLOUR, tooltip: '%{BKY_STUDIO_SORT_TOOLTIP}' },
  { type: 'studio_select', message0: '%{BKY_STUDIO_SELECT}', args0: [value('DATA'), field('COLUMNS', 'x,y')], output: null, colour: TRANSFORM_COLOUR, tooltip: '%{BKY_STUDIO_SELECT_TOOLTIP}' },
  { type: 'studio_filter', message0: '%{BKY_STUDIO_FILTER}', args0: [value('DATA'), field('COLUMN', 'x'), dropdown('OP', COMPARE_OPS), value('VALUE')], output: null, colour: TRANSFORM_COLOUR, tooltip: '%{BKY_STUDIO_FILTER_TOOLTIP}' },

  // ---- statistics ----
  { type: 'studio_summary', message0: '%{BKY_STUDIO_SUMMARY}', args0: [value('DATA'), field('COLUMN', 'x')], output: null, colour: STAT_COLOUR, tooltip: '%{BKY_STUDIO_SUMMARY_TOOLTIP}' },
  { type: 'studio_histogram', message0: '%{BKY_STUDIO_HISTOGRAM}', args0: [value('DATA'), field('COLUMN', 'x'), value('BINS')], output: null, colour: STAT_COLOUR, tooltip: '%{BKY_STUDIO_HISTOGRAM_TOOLTIP}' },

  // ---- visualization (statements) ----
  { type: 'studio_plot_scatter', message0: '%{BKY_STUDIO_PLOT_SCATTER}', args0: [value('DATA'), field('X', 'x'), field('Y', 'y'), field('COLOR', '')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '%{BKY_STUDIO_PLOT_SCATTER_TOOLTIP}' },
  { type: 'studio_plot_histogram', message0: '%{BKY_STUDIO_PLOT_HISTOGRAM}', args0: [value('DATA'), field('COLUMN', 'x')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '%{BKY_STUDIO_PLOT_HISTOGRAM_TOOLTIP}' },
  { type: 'studio_plot_pointcloud', message0: '%{BKY_STUDIO_PLOT_POINTCLOUD}', args0: [value('DATA'), field('X', 'x'), field('Y', 'y'), field('Z', 'z')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '%{BKY_STUDIO_PLOT_POINTCLOUD_TOOLTIP}' },
  { type: 'studio_line', message0: '%{BKY_STUDIO_LINE}', args0: [value('DATA'), field('X', 'x'), field('Y', 'y')], previousStatement: null, nextStatement: null, colour: VIZ_COLOUR, tooltip: '%{BKY_STUDIO_LINE_TOOLTIP}' },

  // ---- control ----
  { type: 'studio_run', message0: '%{BKY_STUDIO_RUN}', args0: [], nextStatement: null, colour: '#22C55E', tooltip: '%{BKY_STUDIO_RUN_TOOLTIP}' },
  { type: 'studio_while', message0: '%{BKY_STUDIO_WHILE}', args0: [value('COND'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '%{BKY_STUDIO_WHILE_TOOLTIP}' },
  { type: 'studio_for_each', message0: '%{BKY_STUDIO_FOR_EACH}', args0: [value('LIST'), field('VAR', 'item'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '%{BKY_STUDIO_FOR_EACH_TOOLTIP}' },
  { type: 'studio_repeat', message0: '%{BKY_STUDIO_REPEAT}', args0: [value('COUNT'), { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '%{BKY_STUDIO_REPEAT_TOOLTIP}' },
  { type: 'studio_if', message0: '%{BKY_STUDIO_IF}', args0: [value('COND'), { type: 'input_statement', name: 'DO' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: CONTROL_COLOUR, tooltip: '%{BKY_STUDIO_IF_TOOLTIP}' },

  // ---- util / host ----
  { type: 'studio_print', message0: '%{BKY_STUDIO_PRINT}', args0: [value('TEXT')], previousStatement: null, nextStatement: null, colour: UTIL_COLOUR, tooltip: '%{BKY_STUDIO_PRINT_TOOLTIP}' },
  { type: 'studio_raw', message0: '%{BKY_STUDIO_RAW}', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], previousStatement: null, nextStatement: null, colour: UTIL_COLOUR, tooltip: '%{BKY_STUDIO_RAW_TOOLTIP}' },
  // Expression variant of `studio_raw`: a *value* block (with an `output`
  // connection) so unexpressible expressions can legally sit in a value input
  // without triggering Blockly's "missing output connection" warning.
  { type: 'studio_raw_value', message0: '%{BKY_STUDIO_RAW}', args0: [{ type: 'field_input', name: 'TEXT', text: '' }], output: null, colour: UTIL_COLOUR, tooltip: '%{BKY_STUDIO_RAW_TOOLTIP}' },
];
