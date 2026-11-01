// ==========================================================================
// Ergalics Studio — bridges from publishing to Figure Studio / Git / VFS
//
// Manuscripts reference figures by the name of the SVG file they *will* be
// exported as. This module owns that naming and the reverse mapping, so the
// LaTeX editor, the arXiv packager and the preview all agree on which
// FigureSheet a `figures/<slug>.svg` include refers to.
// ==========================================================================

import { composeFigure } from '@/core/figure/compose';
import { sanitizeSvg } from '@/core/sanitize/sanitizeSvg';
import type { FigureSheet } from '@/types/project';

/** File-name-safe slug shared by figure export and LaTeX includes. */
export function figureSlug(name: string, fallback = 'figure'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/** Repo-relative path used by `\includesvg{...}` for a FigureSheet. */
export function figureSheetPath(sheet: FigureSheet): string {
  return `figures/${figureSlug(sheet.name, sheet.id.slice(0, 8))}.svg`;
}

/**
 * Render a FigureSheet to one standalone, sanitized SVG. The caption is left
 * out by default because LaTeX supplies its own `\caption{}`.
 */
export function figureSheetSvg(sheet: FigureSheet, includeCaption = false): string {
  const composed = composeFigure({
    panels: sheet.panels,
    templateId: sheet.templateId,
    caption: includeCaption ? sheet.caption : undefined,
  });
  return sanitizeSvg(composed.markup);
}

/** Figure files referenced by a `.tex` source. */
export function referencedFigures(source: string): string[] {
  const names = new Set<string>();
  const re = /\\(?:includesvg|includegraphics)(?:\[[^\]]*\])?\{([^{}]+)\}/g;
  for (const match of source.matchAll(re)) {
    const file = (match[1] ?? '').trim().replace(/^figures\//, '');
    if (file) names.add(file);
  }
  return [...names];
}

/**
 * Resolve a `.tex` figure include to its SVG: matches by exported file path
 * first, then by slug, then by sheet id. Returns null when the project has no
 * such sheet (the preview then shows a placeholder).
 */
export function makeFigureResolver(
  sheets: FigureSheet[],
): (file: string) => string | null {
  const byPath = new Map<string, FigureSheet>();
  const bySlug = new Map<string, FigureSheet>();
  for (const sheet of sheets) {
    byPath.set(figureSheetPath(sheet).replace(/^figures\//, ''), sheet);
    bySlug.set(figureSlug(sheet.name, sheet.id.slice(0, 8)), sheet);
    bySlug.set(figureSlug(sheet.name, sheet.id.slice(0, 8)) + '.svg', sheet);
    bySlug.set(sheet.id, sheet);
  }
  return (file: string) => {
    const name = file.trim().replace(/^figures\//, '').replace(/\.svg$/i, '');
    const sheet = byPath.get(name) ?? byPath.get(`${name}.svg`) ?? bySlug.get(name);
    if (!sheet) return null;
    try {
      return figureSheetSvg(sheet);
    } catch {
      return null;
    }
  };
}
