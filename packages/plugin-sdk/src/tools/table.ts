/**
 * Relaxed delimited-text reader: splits into rows on newlines, cells on
 * commas (semicolon/tab also accepted), skips blank lines and `#` comments.
 * Returns trimmed string cells; the caller converts types.
 */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    rows.push(line.split(/[,;\t]+/).map((c) => c.trim()));
  }
  return rows;
}

/** Drop a leading header row when no cell parses as a finite number. */
export function stripHeaderIfNonNumeric(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const looksNumeric = rows[0]!.some((c) => c !== '' && Number.isFinite(Number(c)));
  return looksNumeric ? rows : rows.slice(1);
}
