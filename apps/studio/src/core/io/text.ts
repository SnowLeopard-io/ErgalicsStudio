// ==========================================================================
// Ergalics Studio — small text helpers shared by the file parsers
// ==========================================================================

/** Drop a leading UTF-8 BOM so it can't poison the first header token. */
export function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
