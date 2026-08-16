// ==========================================================================
// Ergalics Studio — Blockly toolbox (block mode)
//
// Categories aligned with the Scratch convention (data=blue, control=yellow,
// ops=green, viz=pink) from block-code-modes.md §6.6. Value inputs get shadow
// blocks so blocks are runnable the moment they're dragged out.
// ==========================================================================

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
      colour: '#22C55E',
      contents: [block('studio_run')],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_DATA}',
      colour: '#4C97FF',
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
      colour: '#FF8C1A',
      contents: [block('studio_var'), block('studio_var_assign', { VALUE: { shadow: shadowNumber(0) } })],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_OPERATORS}',
      colour: '#59C059',
      contents: [
        block('studio_number'),
        block('studio_string'),
        block('studio_boolean'),
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
      colour: '#CF63CF',
      contents: [
        block('studio_normalize'),
        block('studio_sort'),
        block('studio_select'),
        block('studio_filter', { VALUE: { shadow: shadowNumber(0) } }),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_STATS}',
      colour: '#9966FF',
      contents: [block('studio_summary'), block('studio_histogram', { BINS: { shadow: shadowNumber(10) } })],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_VIZ}',
      colour: '#FF6680',
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
      colour: '#FFAB19',
      contents: [
        block('studio_repeat', { COUNT: { shadow: shadowNumber(10) } }),
        block('studio_while', { COND: { shadow: shadowBoolean('true') } }),
        block('studio_for_each', { LIST: { shadow: { type: 'studio_list', fields: { VALUES: '1,2,3' } } } }),
        block('studio_if', { COND: { shadow: shadowBoolean('true') } }),
      ],
    },
    {
      kind: 'category',
      name: '%{BKY_CAT_UTILITY}',
      colour: '#8A97A8',
      contents: [block('studio_print', { TEXT: { shadow: shadowString('你好') } })],
    },
  ] as ToolboxCategory[],
};
