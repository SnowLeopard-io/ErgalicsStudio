// ==========================================================================
// Ergalics Studio — delimited-text line splitting (single implementation)
//
// Five call sites used to carry their own copy of the RFC4180-ish splitter:
// the block/flow file loader, the chunked reader, the cleaning wizard, and
// the data-engine schema/synthesiser. They now share the two flavours that
// actually exist:
//
//   splitLooseTokens    comma OR whitespace separated (plain numeric data);
//                       whitespace runs collapse, a comma always closes a
//                       field, so `1,,3` keeps the empty middle field.
//   splitDelimitedLine  one explicit delimiter (CSV/TSV/…); quoted fields
//                       keep their delimiter, `""` is an escaped quote and
//                       a trailing delimiter promises one more (empty) field.
// ==========================================================================

/**
 * Split a line on commas AND whitespace runs (plain numeric data).
 *
 * Supports RFC4180-style double-quoted fields (`"a,b"` stays one token and
 * `""` is an escaped quote). A comma always closes a field — so `1,,3` yields
 * an explicit empty middle field — while runs of whitespace collapse into a
 * single separator (so `1   2` is two fields, not three).
 */
export function splitLooseTokens(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
  /** A comma just closed a field, so a trailing comma still promises one more. */
  let afterComma = false;

  const flush = (force: boolean) => {
    if (force || quoted || cur.length > 0) tokens.push(cur);
    cur = '';
    quoted = false;
    afterComma = false;
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ',') {
      flush(true);
      afterComma = true;
      continue;
    }
    if (/\s/.test(ch)) {
      // Collapse whitespace runs: only close a field that actually has content.
      if (cur.length > 0 || quoted) flush(false);
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || quoted || afterComma) tokens.push(cur);
  return tokens;
}

/**
 * CSV flavour of the splitter: every line yields at least one cell, so an
 * empty line is one empty cell (the data-engine parsers and the plugin
 * kernels expect that).
 */
export function splitCsvCells(line: string): string[] {
  const cells = splitDelimitedLine(line, ',');
  return cells.length ? cells : [''];
}

/**
 * Split a line on one explicit delimiter (RFC4180-ish): quoted fields keep
 * their delimiter, `""` escapes a quote, and a trailing delimiter promises
 * one more (empty) field.
 */
export function splitDelimitedLine(line: string, delimiter = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || quoted || line.endsWith(delimiter)) out.push(cur);
  return out;
}
