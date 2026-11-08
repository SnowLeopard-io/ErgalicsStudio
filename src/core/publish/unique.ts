// ==========================================================================
// Ergalics Studio — workspace naming for exported manuscripts
//
// Each manuscript owns a bundle in `manuscript/` named after the manuscript
// itself (HELLO → manuscript/HELLO.tex + HELLO.pdf), so the LaTeX editor and
// the workspace file manager always show the same name. Re-saving overwrites
// that bundle; two manuscripts with the same name get `-2`, `-3`, ….
// ==========================================================================

/** Filesystem/LaTeX-safe stem derived from a manuscript name. */
export function manuscriptStem(name: string, fallback = 'manuscript'): string {
  const stem = name
    .normalize('NFKC')
    .trim()
    // eslint-disable-next-line no-control-regex -- strip control chars illegal in filenames
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
    .replace(/[-.]+$/g, '');
  return stem || fallback;
}

/**
 * Pick the stem for a manuscript: its sanitized name when free, otherwise the
 * next `-2`, `-3`, … suffix. Comparison is case-insensitive because Windows
 * and macOS filesystems are.
 */
export function nextWorkspaceStem(
  name: string,
  used: Iterable<string | undefined | null>,
): string {
  const taken = new Set<string>();
  for (const value of used) {
    if (typeof value === 'string' && value) taken.add(value.toLowerCase());
  }
  const base = manuscriptStem(name);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Repo-relative paths of a manuscript's `.tex` / `.pdf` bundle. */
export function manuscriptBundle(stem: string): { tex: string; pdf: string } {
  return { tex: `manuscript/${stem}.tex`, pdf: `manuscript/${stem}.pdf` };
}
