// ==========================================================================
// Ergalics Studio — Blockly toolbox (block mode)
//
// Categories mirror the block palette (see BLOCK_PALETTE in ./blocks) so the
// flyout chips and the blocks share one muted, technical colour system.
// Value inputs get shadow blocks so blocks are runnable the moment they're
// dragged out.
// ==========================================================================

import { BLOCK_PALETTE } from './blocks';

function shadowNumber(value: number): unknown {
  return { type: 'studio_number', fields: { NUM: value } };
}

function shadowBoolean(value: string): unknown {
  return { type: 'studio_boolean', fields: { BOOL: value } };
}

function shadowString(value: string): unknown {
  return { type: 'studio_string', fields: { STR: value } };
}

interface ToolboxBlock {
  kind: 'block';
  type: string;
  inputs?: Record<string, { shadow?: unknown }>;
}

interface ToolboxCategory {
  kind: 'category';
  name: string;
  colour: string;
  contents: ToolboxBlock[];
}

function block(type: string, inputs?: Record<string, { shadow?: unknown }>): ToolboxBlock {
  return { kind: 'block', type, inputs };
}

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: '%{BKY_CAT_START}',
      colour: BLOCK_PALETTE.run,
      contents: [block('studio_run')],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_DATA}',
      colour: BLOCK_PALETTE.data,
      contents: [
        block('studio_load_csv'),
        block('studio_load_xyz'),
        block('studio_random', {
          COUNT: { shadow: shadowNumber(100) },
          SEED: { shadow: shadowNumber(1) },
        }),
        block('studio_range', {
          START: { shadow: shadowNumber(0) },
          STOP: { shadow: shadowNumber(10) },
          STEP: { shadow: shadowNumber(1) },
        }),
        block('studio_list'),
        block('studio_list_index', {
          LIST: { shadow: { type: 'studio_list', fields: { VALUES: '1,2,3' } } },
          INDEX: { shadow: shadowNumber(0) },
        }),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_VARIABLES}',
      colour: BLOCK_PALETTE.variable,
      contents: [block('studio_var'), block('studio_var_assign', { VALUE: { shadow: shadowNumber(0) } })],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_OPERATORS}',
      colour: BLOCK_PALETTE.operation,
      contents: [
        block('studio_number'),
        block('studio_string'),
        block('studio_boolean'),
        block('studio_null'),
        block('studio_math_op', {
          A: { shadow: shadowNumber(1) },
          B: { shadow: shadowNumber(1) },
        }),
        block('studio_compare', {
          A: { shadow: shadowNumber(1) },
          B: { shadow: shadowNumber(1) },
        }),
        block('studio_logic_op', {
          A: { shadow: shadowBoolean('true') },
          B: { shadow: shadowBoolean('true') },
        }),
        block('studio_unary', { A: { shadow: shadowNumber(1) } }),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_TRANSFORM}',
      colour: BLOCK_PALETTE.transform,
      contents: [
        block('studio_normalize'),
        block('studio_sort'),
        block('studio_select'),
        block('studio_filter', { VALUE: { shadow: shadowNumber(0) } }),
        block('studio_add_column', { VALUES: { shadow: shadowNumber(0) } }),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_STATS}',
      colour: BLOCK_PALETTE.statistic,
      contents: [block('studio_summary'), block('studio_histogram', { BINS: { shadow: shadowNumber(10) } })],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_VIZ}',
      colour: BLOCK_PALETTE.visualization,
      contents: [
        block('studio_plot_scatter'),
        block('studio_line'),
        block('studio_plot_histogram'),
        block('studio_plot_pointcloud'),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_CONTROL}',
      colour: BLOCK_PALETTE.control,
      contents: [
        block('studio_repeat', { COUNT: { shadow: shadowNumber(10) } }),
        // A `false` shadow: a constant `1 < 10` compare is always true, so a
        // freshly dragged `while` would loop until the interpreter's iteration
        // cap trips. `false` terminates immediately and is a safe default.
        block('studio_while', { COND: { shadow: shadowBoolean('false') } }),
        block('studio_for_each', { LIST: { shadow: { type: 'studio_list', fields: { VALUES: '1,2,3' } } } }),
        block('studio_if', { COND: { shadow: shadowBoolean('true') } }),
        block('studio_break'),
        block('studio_continue'),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_FUNCTIONS}',
      colour: BLOCK_PALETTE.statistic,
      contents: [
        block('studio_function_def'),
        block('studio_return'),
        block('studio_call'),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_UTILITY}',
      colour: BLOCK_PALETTE.util,
      contents: [block('studio_print', { TEXT: { shadow: shadowString('你好') } })],
    },
  ] as ToolboxCategory[],
};
