// Ergalics Studio — display-time localization for block executor/compiler errors.
//
// Executors and the compiler throw plain English Error messages and stay
// framework-free (no i18n dependency in core execution code). This module
// translates those messages at the UI boundary (BlockToolbar diagnostics):
//   1. EXACT_ERRORS — static executor messages, exact string match.
//   2. PATTERN_ERRORS — interpolated compiler/executor messages, regex with
//      capture groups passed to t() as params.
// Anything unmatched falls back to the raw message (e.g. nested parser
// errors), so new error strings degrade gracefully instead of disappearing.

/** Minimal translation contract — matches the signature of useT(). */
type Translate = (key: string, params?: Record<string, string>) => string;

/** Static executor error messages → i18n keys under `blocks.errors.*`. */
const EXACT_ERRORS: Record<string, string> = {
  'this block is not configured — pick a column first': 'blocks.errors.not_configured_column',
  'this block is not configured — select at least one column': 'blocks.errors.not_configured_columns',
  'this block is not configured — pick the column to rename': 'blocks.errors.not_configured_rename_col',
  'this block is not configured — set the new column name': 'blocks.errors.not_configured_rename_new',
  'this block is not configured — specify the source unit': 'blocks.errors.not_configured_unit_from',
  'this block is not configured — specify the target unit': 'blocks.errors.not_configured_unit_to',
  'this block is not configured — specify two units to compare': 'blocks.errors.not_configured_unit_pair',
  'this block is not configured — pick a project file': 'blocks.errors.not_configured_file',
  'column length mismatch': 'blocks.errors.length_mismatch',
  'bins must be >= 1': 'blocks.errors.bins_min',
  'no numeric data found': 'blocks.errors.no_numeric_data',
  'JSON dataset is empty': 'blocks.errors.json_empty',
  'JSON dataset has no columns': 'blocks.errors.json_no_columns',
  'unsupported JSON dataset shape (expected row records or { columns: [...] })': 'blocks.errors.json_shape',
  'transform.add_column: value must be a number': 'blocks.errors.add_column_number',
  'Mann-Whitney needs exactly two groups in the group column': 'blocks.errors.mann_whitney_groups',
  'contingency table needs at least two count columns': 'blocks.errors.contingency_columns',
  'MCMC estimation needs at least two observations': 'blocks.errors.mcmc_min_obs',
  'filter.range: min/max must be numbers': 'blocks.errors.filter_range_numbers',
  'filter.value: value must be a number': 'blocks.errors.filter_value_number',
};

/** Interpolated error patterns → i18n keys, with regex captures as params. */
const PATTERN_ERRORS: Array<{ re: RegExp; key: string; params?: string[] }> = [
  { re: /^duplicate node id "(.+)"$/, key: 'blocks.compile.dup_id', params: ['id'] },
  { re: /^unknown block "(.+)"$/, key: 'blocks.compile.unknown_block', params: ['id'] },
  { re: /^block "(.+)" has no executor \(nothing to run\)$/, key: 'blocks.compile.no_executor', params: ['id'] },
  { re: /^required input "(.+)" of node "(.+)" is not connected$/, key: 'blocks.compile.input_unconnected', params: ['port', 'node'] },
  { re: /^the block graph contains a cycle \(data-flow must be acyclic\)$/, key: 'blocks.compile.cycle' },
  { re: /^connection references unknown source node "(.+)"$/, key: 'blocks.compile.unknown_source', params: ['id'] },
  { re: /^connection references unknown target node "(.+)"$/, key: 'blocks.compile.unknown_target', params: ['id'] },
  { re: /^node "(.+)" has no output port "(.+)"$/, key: 'blocks.compile.no_output_port', params: ['node', 'port'] },
  { re: /^node "(.+)" has no input port "(.+)"$/, key: 'blocks.compile.no_input_port', params: ['node', 'port'] },
  { re: /^cannot connect (?:a )?(.+) output to (?:a )?(.+) input$/, key: 'blocks.compile.type_mismatch', params: ['from', 'to'] },
  { re: /^input port "(.+)" of node "(.+)" already has a source$/, key: 'blocks.compile.input_taken', params: ['port', 'node'] },
  { re: /^invalid JSON dataset: (.+)$/, key: 'blocks.errors.json_invalid', params: ['detail'] },
  { re: /^node "(.+)" \(block "(.+)"\) has no executor$/, key: 'blocks.errors.no_executor_node', params: ['node', 'block'] },
  { re: /^column "(.+)" does not exist$/, key: 'blocks.errors.column_missing', params: ['col'] },
  { re: /^column "(.+)" is not numeric$/, key: 'blocks.errors.column_not_numeric', params: ['col'] },
  { re: /^column "(.+)" is not a category\/string column$/, key: 'blocks.errors.column_not_category', params: ['col'] },
  { re: /^column "(.+)" already exists$/, key: 'blocks.errors.column_exists', params: ['col'] },
  { re: /^column length (\d+) != table length (\d+)$/, key: 'blocks.errors.length_mismatch_n', params: ['got', 'expected'] },
  { re: /^file "(.+)" not found in project$/, key: 'blocks.errors.file_not_found', params: ['file'] },
];

/**
 * Translate a block executor/compiler error message for display.
 * Falls back to the raw message when no rule matches.
 */
export function translateBlockError(message: string, t: Translate): string {
  const exact = EXACT_ERRORS[message];
  if (exact) return t(exact);
  for (const rule of PATTERN_ERRORS) {
    const m = rule.re.exec(message);
    if (m) {
      const params: Record<string, string> = {};
      rule.params?.forEach((name, i) => {
        params[name] = m[i + 1] ?? '';
      });
      return t(rule.key, params);
    }
  }
  return message;
}
