// ==========================================================================
// Ergalics Studio — publication figure composition (core)
//
// A FigureSpec is a multi-panel container of PlotSpecs laid out on a journal
// template grid (IEEE/Elsevier column sizes, colorblind-safe palettes).
// composeFigure renders one standalone SVG (nested per-panel `<svg>` viewports
// + a/b/c panel tags); exportFigure handles svg/pdf/png600 downloads. The
// PlotSpec itself is NOT modified — composition only re-sizes panels.
// ==========================================================================

import { renderSVG, exportSVG, rasterizePNG, buildPDF, downloadBytes } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import { saveTextArtifact, saveBinaryArtifact } from '@/core/workspace-artifacts';
import {
  buildSidecar,
  downloadSidecar,
  hashBinaryArtifact,
  hashTextArtifact,
  saveSidecarToWorkspace,
} from '@/core/result/sidecar';
import type { ResultRecord } from '@/core/result/types';
import { buildVectorPDF } from '@/core/pdf/vector';
import type { Project } from '@/types/project';

/** Provenance attached to every figure export (FR-4). */
export interface FigureExportProvenance {
  record?: ResultRecord;
  sourceResultIds?: string[];
  colorSpace?: 'rgb' | 'cmyk';
  /** Experimental vector PDF; default is the font-compatible raster path. */
  pdfMode?: 'raster' | 'vector';
}

/** One panel of a composed figure, placed on a row/col grid. */
export interface FigurePanel {
  /** Grid position, 0-based row-major. */
  row: number;
  col: number;
  /** Panel tag (a, b, c, …). Auto-assigned in compose order when empty. */
  tag?: string;
  /** Id of the immutable ResultRecord this panel's numbers came from (FR-2). */
  sourceResultId?: string;
  spec: PlotSpec;
}

/** Journal template: single-column panel size @96dpi + typographic scale. */
export interface JournalTemplate {
  id: string;
  name: string;
  /** Single-panel (one column) size in px at 96 dpi. */
  panelWidth: number;
  panelHeight: number;
  /** Multiplier applied to panel axis labels/ticks. */
  fontScale: number;
  /** Colorblind-safe categorical palette (Okabe-Ito derivatives). */
  palette: string[];
  /** Gap between panels, px. */
  gap: number;
  /** Physical single-column width in mm (for PDF export). */
  columnWidthMm: number;
}

/** px @96dpi → mm. */
export function pxToMm(px: number): number {
  return (px * 25.4) / 96;
}

// Okabe–Ito colorblind-safe hues, reordered for dark-on-white plots.
const OKABE_ITO = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000'];

export const JOURNAL_TEMPLATES: JournalTemplate[] = [
  {
    id: 'ieee_single',
    name: 'IEEE single column',
    panelWidth: 336, // 3.5 in
    panelHeight: 252, // ~2.6 in
    fontScale: 0.85,
    palette: OKABE_ITO,
    gap: 16,
    columnWidthMm: 88.9,
  },
  {
    id: 'ieee_double',
    name: 'IEEE double column',
    panelWidth: 336,
    panelHeight: 252,
    fontScale: 0.85,
    palette: OKABE_ITO,
    gap: 16,
    columnWidthMm: 181.6,
  },
  {
    id: 'elsevier_single',
    name: 'Elsevier single column',
    panelWidth: 340, // 90 mm
    panelHeight: 272,
    fontScale: 0.9,
    palette: OKABE_ITO,
    gap: 18,
    columnWidthMm: 90,
  },
  {
    id: 'elsevier_double',
    name: 'Elsevier double column',
    panelWidth: 340,
    panelHeight: 272,
    fontScale: 0.9,
    palette: OKABE_ITO,
    gap: 18,
    columnWidthMm: 190,
  },
  {
    id: 'console',
    name: 'Console (screen)',
    panelWidth: 640,
    panelHeight: 420,
    fontScale: 1,
    palette: OKABE_ITO,
    gap: 24,
    columnWidthMm: 160,
  },
];

export function templateById(id: string): JournalTemplate {
  return JOURNAL_TEMPLATES.find((t) => t.id === id) ?? JOURNAL_TEMPLATES[0]!;
}

export interface FigureSpec {
  panels: FigurePanel[];
  templateId: string;
  /** Grid shape; defaults to the tight bounding box of the panels. */
  rows?: number;
  cols?: number;
  /** Caption rendered beneath the panels ('\n' = forced line break). */
  caption?: string;
}

export interface ComposedFigure {
  /** Standalone SVG markup of the whole figure. */
  markup: string;
  width: number;
  height: number;
  /** Per-panel placement actually used (tags resolved). */
  placed: Array<{ tag: string; row: number; col: number; x: number; y: number }>;
}

/** Spreadsheet-style column tag: a..z, aa, ab, … */
function tagFor(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Cell size + gap for a template. Single source for both composeFigure and
 * the interactive figure readout (which needs the same numbers to map pointer
 * positions onto panel plot areas).
 */
export function panelCellSize(templateId: string): { cellW: number; cellH: number; gap: number } {
  const tpl = templateById(templateId);
  // Double-column templates split the template width across cells, so a
  // 2-column figure spans exactly one full double-column width.
  const isDouble = tpl.id.endsWith('double');
  return {
    cellW: isDouble ? Math.round((tpl.columnWidthMm / 2) * (96 / 25.4)) : tpl.panelWidth,
    cellH: tpl.panelHeight,
    gap: tpl.gap,
  };
}

/**
 * Compose panels onto a template grid. Each panel is rendered at the template
 * cell size (its own spec width/height is overridden for layout only) and
 * embedded as a nested `<svg>` viewport; tags auto-assign a, b, c, … in
 * row-major compose order unless the panel carries an explicit tag.
 */
export function composeFigure(fs: FigureSpec): ComposedFigure {
  const tpl = templateById(fs.templateId);
  const panels = [...fs.panels].sort((a, b) => a.row - b.row || a.col - b.col);

  // Guard against non-finite / absurd grid extents from untrusted specs so a
  // hostile `.clproj` cannot produce a multi-gigapixel SVG.
  const clampExtent = (v: number | undefined): number =>
    Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v as number), 1), 20) : 1;
  const rows = clampExtent(Math.max(fs.rows ?? 0, ...panels.map((p) => p.row + 1), 1));
  const cols = clampExtent(Math.max(fs.cols ?? 0, ...panels.map((p) => p.col + 1), 1));

  const { cellW, cellH, gap } = panelCellSize(fs.templateId);

  const width = cols * cellW + (cols - 1) * gap;
  const captionLines = fs.caption ? fs.caption.split('\n') : [];
  const captionBlockH = captionLines.length > 0 ? 18 + captionLines.length * 14 : 0;
  const height = rows * cellH + (rows - 1) * gap + captionBlockH;

  const placed: ComposedFigure['placed'] = [];
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  panels.forEach((panel, i) => {
    // Row/col may be fractional or absurd from an untrusted spec — clamp to
    // the grid so x/y stay finite and on-canvas.
    const row = clampExtent(panel.row + 1) - 1;
    const col = clampExtent(panel.col + 1) - 1;
    const x = col * (cellW + gap);
    const y = row * (cellH + gap);
    // `panel.tag` is user-authored and flows straight into the SVG markup —
    // escape it so a tag like `a<b` cannot break out of the <text> element.
    const tag = escapeXml(panel.tag ?? tagFor(i));
    placed.push({ tag, row, col, x, y });

    const spec: PlotSpec = {
      ...panel.spec,
      width: cellW,
      height: cellH,
      title: panel.spec.title, // figure panels usually rely on the tag, keep title if authored
    };
    // Render at cell size, then convert the standalone svg into a positioned
    // nested viewport. Injecting x/y onto the root <svg> keeps the markup
    // valid SVG 1.1 (nested svg elements are legal children of the root).
    const inner = renderSVG(spec).replace(/<svg\b/, `<svg x="${x}" y="${y}"`);
    parts.push(inner);

    // Panel tag, top-left outside the axes.
    parts.push(
      `<text x="${x + 4}" y="${y + 14}" font-size="${Math.round(13 * tpl.fontScale)}" ` +
        `font-family="Helvetica, Arial, sans-serif" font-weight="bold" fill="#000000">${tag}</text>`,
    );
  });

  if (captionLines.length > 0) {
    const capY = rows * cellH + (rows - 1) * gap + 16;
    captionLines.forEach((line, i) => {
      parts.push(
        `<text x="0" y="${capY + i * 14}" font-size="11" font-family="Helvetica, Arial, sans-serif" fill="#000000">` +
          escapeXml(line) +
          '</text>',
      );
    });
  }

  parts.push('</svg>');
  return { markup: parts.join('\n'), width, height, placed };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type FigureExportFormat = 'svg' | 'pdf' | 'png600';

/**
 * Export a composed figure. `png600` rasterizes at the requested dpi (print
 * quality); PDF scales the figure to its physical template width and carries
 * a raster of the same dpi.
 */
export async function exportFigure(
  fs: FigureSpec,
  format: FigureExportFormat,
  filename = 'figure',
  dpi = 600,
  provenance: FigureExportProvenance = {},
): Promise<void> {
  const composed = composeFigure(fs);
  const tpl = templateById(fs.templateId);
  const emitSidecar = (artifactName: string, hash: string) => {
    if (!provenance.record) return;
    downloadSidecar(
      buildSidecar(
        provenance.record,
        { name: artifactName, hash },
        {
          format: format === 'pdf' && provenance.pdfMode === 'vector' ? 'pdf-vector' : format,
          template: fs.templateId,
          dpi,
          colorSpace: provenance.colorSpace ?? 'rgb',
        },
        provenance.sourceResultIds,
      ),
    );
  };
  if (format === 'svg') {
    const name = `${filename}.svg`;
    exportSVG(composed.markup, name);
    emitSidecar(name, hashTextArtifact(composed.markup));
    return;
  }
  if (format === 'pdf') {
    const cols = Math.max(...fs.panels.map((p) => p.col + 1), 1);
    const widthMm = tpl.columnWidthMm * (cols > 1 && !tpl.id.endsWith('double') ? cols : 1);
    const bytes =
      provenance.pdfMode === 'vector'
        ? await buildVectorPDF(composed.markup, Math.min(widthMm, 277))
        : await buildPDF(composed.markup, Math.min(widthMm, 277), dpi);
    const name = `${filename}.pdf`;
    downloadBytes(bytes, name, 'application/pdf');
    emitSidecar(name, hashBinaryArtifact(bytes));
    return;
  }
  const bytes = await rasterizePNG(composed.markup, Math.max(1, dpi) / 96);
  const name = `${filename}.png`;
  downloadBytes(bytes, name, 'image/png');
  emitSidecar(name, hashBinaryArtifact(bytes));
}

/**
 * Save a composed figure into the project workspace `figures/` dir (no
 * download). Same composition/rasterization pipeline as `exportFigure`;
 * resolves to the repo-relative path written. Duplicates get " (2)"… names.
 */
export async function saveFigureToWorkspace(
  project: Project,
  fs: FigureSpec,
  format: FigureExportFormat,
  filename = 'figure',
  dpi = 600,
  provenance: FigureExportProvenance = {},
): Promise<string> {
  const composed = composeFigure(fs);
  const tpl = templateById(fs.templateId);
  const safe = filename.replace(/[^\w.-]+/g, '-');
  const persistSidecar = async (artifactName: string, hash: string) => {
    if (!provenance.record) return;
    await saveSidecarToWorkspace(
      project,
      `figures/${artifactName}`,
      buildSidecar(
        provenance.record,
        { name: artifactName, hash },
        {
          format: format === 'pdf' && provenance.pdfMode === 'vector' ? 'pdf-vector' : format,
          template: fs.templateId,
          dpi,
          colorSpace: provenance.colorSpace ?? 'rgb',
        },
        provenance.sourceResultIds,
      ),
    );
  };
  if (format === 'svg') {
    const name = `${safe}.svg`;
    const path = await saveTextArtifact(project, 'figures', name, composed.markup);
    await persistSidecar(name, hashTextArtifact(composed.markup));
    return path;
  }
  if (format === 'pdf') {
    const cols = Math.max(...fs.panels.map((p) => p.col + 1), 1);
    const widthMm = tpl.columnWidthMm * (cols > 1 && !tpl.id.endsWith('double') ? cols : 1);
    const bytes =
      provenance.pdfMode === 'vector'
        ? await buildVectorPDF(composed.markup, Math.min(widthMm, 277))
        : await buildPDF(composed.markup, Math.min(widthMm, 277), dpi);
    const name = `${safe}.pdf`;
    const path = await saveBinaryArtifact(project, 'figures', name, bytes);
    await persistSidecar(name, hashBinaryArtifact(bytes));
    return path;
  }
  const bytes = await rasterizePNG(composed.markup, Math.max(1, dpi) / 96);
  const name = `${safe}.png`;
  const path = await saveBinaryArtifact(project, 'figures', name, bytes);
  await persistSidecar(name, hashBinaryArtifact(bytes));
  return path;
}
