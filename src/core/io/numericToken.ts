// ==========================================================================
// Numeric token classification for the delimited text parsers.
//
// Shared by the whole-file parser (blocks/fileData.ts) and the chunked
// reader (core/chunked/reader.ts) so header detection and cell typing can
// never diverge between the two entry points (EG1-105 / EG2-20).
// ==========================================================================

/**
 * True when `t` counts as a numeric cell in delimited scientific data:
 * an empty (missing) cell, any finite number, or an explicitly spelled
 * non-finite value — `NaN` (incl. the `NaN(ind)` form), `±Infinity` in
 * short or long form, and decimal/scientific literals that overflow to
 * ±Infinity (e.g. `1e999`).
 *
 * `Number.isFinite(Number(t))` alone is wrong here: `Number('NaN')`,
 * `Number('inf')` and `Number('1e999')` are all non-finite, which used to
 * make legitimate data lines look like headers and got whole rows dropped.
 */
export function isNumericToken(t: string): boolean {
  if (t === '') return true;
  if (Number.isFinite(Number(t))) return true;
  return (
    /^[+-]?nan(\(ind\))?$/i.test(t) ||
    /^[+-]?inf(inity)?$/i.test(t) ||
    // Overflowing decimal/scientific literal (no letters beyond e/E).
    /^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/.test(t)
  );
}
