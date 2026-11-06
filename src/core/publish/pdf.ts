// ==========================================================================
// Ergalics Studio — manuscript PDF export
//
// The LaTeX preview is already rendered to semantic HTML. There is no TeX
// distribution in the browser, so this module lays that rendered content out
// with jsPDF's text API. The layout follows the selected journal template
// (two-column IEEE/ACM/Nature/Science, single-column APA/Chicago, their body
// sizes and leading) so the exported PDF resembles the live preview.
//
// Figures are rasterized from their SVG at print resolution before embedding:
// this keeps the exact rendering of the live preview (Greek labels, bar
// geometry, CJK) instead of relying on svg2pdf's built-in-font fallbacks.
//
// jsPDF is imported lazily so it never enters the Standard-mode initial
// bundle, mirroring `@/core/plot/export`.
// ==========================================================================

import {
  getLatexTemplate,
  latexPreviewBody,
  type LatexPreviewOptions,
  type LatexTemplateId,
} from './latex';
import { notebookToMarkdown, type CollabNote } from './collab';
import { CJK_FONT_FAMILY, NON_LATIN1, registerFont, winAnsiSafe } from '../pdf/font';
import { fitSvgBox, svgAspectRatio } from '../pdf/svg';
import { rasterizePNG } from '@/core/plot/export';

interface JsPdfDoc {
  setFont(family: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(
    text: string,
    x: number,
    y: number,
    options?: { align?: 'left' | 'center' | 'right'; baseline?: string },
  ): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, maxWidth: number): string[];
  addPage(): void;
  addImage(
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  addFileToVFS(filename: string, data: string): void;
  addFont(filename: string, family: string, style?: string): void;
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
  output(type: 'arraybuffer'): ArrayBuffer;
}

interface JsPdfModule {
  jsPDF: new (opts: {
    orientation?: 'portrait' | 'landscape';
    unit?: string;
    format?: string;
  }) => JsPdfDoc;
}

const MARGIN_MM = 18;
/** Points → millimetres (1 pt = 1/72 inch). */
const PT_TO_MM = 25.4 / 72;
const TEXT_COLOR: [number, number, number] = [28, 30, 34];
const MUTED_COLOR: [number, number, number] = [95, 99, 104];

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Base64 data URL for a rasterized figure. */
function pngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

// --------------------------------------------------------------------------
// Template typography
// --------------------------------------------------------------------------

interface TemplateMetrics {
  columns: 1 | 2;
  font: 'times' | 'helvetica';
  bodyPt: number;
  titlePt: number;
  authorPt: number;
  headingPt: { h2: number; h3: number; h4: number };
  captionPt: number;
  lineFactor: number;
  margin: { top: number; right: number; bottom: number; left: number };
  columnGap: number;
  abstractPt: number;
}

/**
 * Typography distilled from `.lp-tpl-*` in `latex.ts`: Times body, sans for
 * ACM, larger leading for APA/Chicago, and the two-column journal layouts.
 */
function templateMetrics(id: LatexTemplateId | undefined): TemplateMetrics {
  const columns = getLatexTemplate(id).columns;
  const journal = { top: 16, right: 15, bottom: 18, left: 15, columnGap: 6 };
  switch (id) {
    case 'acm':
      return {
        columns, font: 'helvetica', bodyPt: 9.2, titlePt: 18, authorPt: 9,
        headingPt: { h2: 11.5, h3: 10.2, h4: 9.4 }, captionPt: 8.2, lineFactor: 1.32,
        margin: journal, columnGap: 6, abstractPt: 9,
      };
    case 'nature':
    case 'science':
      return {
        columns, font: 'times', bodyPt: 9.5, titlePt: 22, authorPt: 9.5,
        headingPt: { h2: 12.5, h3: 10.8, h4: 10 }, captionPt: 8, lineFactor: 1.3,
        margin: { ...journal, top: 15 }, columnGap: 6, abstractPt: 9,
      };
    case 'apa':
      return {
        columns, font: 'times', bodyPt: 12, titlePt: 18, authorPt: 11,
        headingPt: { h2: 13, h3: 12, h4: 12 }, captionPt: 10, lineFactor: 1.9,
        margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
        columnGap: 0, abstractPt: 12,
      };
    case 'chicago':
      return {
        columns, font: 'times', bodyPt: 12, titlePt: 18, authorPt: 11,
        headingPt: { h2: 13.5, h3: 12.5, h4: 12 }, captionPt: 10, lineFactor: 1.7,
        margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
        columnGap: 0, abstractPt: 12,
      };
    case 'ieee':
    default:
      return {
        columns, font: 'times', bodyPt: 9.6, titlePt: 19, authorPt: 9,
        headingPt: { h2: 11.5, h3: 10.2, h4: 9.6 }, captionPt: 8.2, lineFactor: 1.34,
        margin: journal, columnGap: 6, abstractPt: 9,
      };
  }
}

// --------------------------------------------------------------------------
// Inline markup → styled runs
// --------------------------------------------------------------------------

interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  sup: boolean;
  sub: boolean;
}

interface InlineRun extends InlineStyle {
  text: string;
}

const BASE_INLINE_STYLE: InlineStyle = {
  bold: false,
  italic: false,
  code: false,
  sup: false,
  sub: false,
};

/**
 * Flatten a rendered HTML fragment into styled text runs. Handles the inline
 * markup the preview emits (`strong`, `em`, `code`, `sup`/`sub`, links and
 * KaTeX) so bold keywords and maths do not collapse into uniform body text.
 */
function collectInlineRuns(root: Node, base: InlineStyle = BASE_INLINE_STYLE): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (text: string, style: InlineStyle) => {
    if (text) runs.push({ text, ...style });
  };
  const walk = (node: Node, style: InlineStyle) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      push(node.nodeValue ?? '', style);
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      push('\n', style);
      return;
    }
    if (tag === 'svg' || tag === 'script' || tag === 'style') return;
    if (el.classList.contains('katex-mathml')) return;
    const next: InlineStyle = {
      bold: style.bold || tag === 'strong' || tag === 'b' || el.classList.contains('katex'),
      italic: style.italic || tag === 'em' || tag === 'i' || el.classList.contains('katex'),
      code: style.code || tag === 'code',
      sup: style.sup || tag === 'sup',
      sub: style.sub || tag === 'sub',
    };
    // KaTeX's visual HTML nests many spans; its textContent is the formula.
    if (el.classList.contains('katex')) {
      push(el.textContent ?? '', next);
      return;
    }
    el.childNodes.forEach((child) => walk(child, next));
  };
  walk(root, base);
  return runs;
}

interface InlineToken {
  text: string;
  style: InlineRun;
  space: boolean;
}

export type ManuscriptPdfOptions = LatexPreviewOptions;

/**
 * Render a `.tex` source into PDF bytes.
 *
 * Browser-only: the preview parser needs a DOM (DOMParser), figures are
 * rasterized through a canvas, and jsPDF needs a document for its output
 * blob lifecycle.
 */
export async function buildManuscriptPdf(
  source: string,
  options: ManuscriptPdfOptions = {},
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('buildManuscriptPdf is only available in a browser environment');
  }
  const fragment = latexPreviewBody(source, options);
  const parsed = new DOMParser().parseFromString(`<div>${fragment}</div>`, 'text/html');
  const container = parsed.body.firstElementChild;
  if (!container) throw new Error('empty manuscript');
  // KaTeX emits the same maths twice (semantic MathML + visual HTML). Keep the
  // visible one so equations are not duplicated in the extracted text.
  container.querySelectorAll('.katex-mathml').forEach((el) => el.remove());

  const layout = templateMetrics(options.templateId);
  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const doc = new jspdfMod.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const needsCjk = NON_LATIN1.test(container.textContent ?? '');
  const cjkReady = await registerFont(doc, needsCjk);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - layout.margin.left - layout.margin.right;
  const columnWidth =
    layout.columns === 2
      ? (contentWidth - layout.columnGap * (layout.columns - 1)) / layout.columns
      : contentWidth;
  const bottom = pageHeight - layout.margin.bottom;
  const colX = (index: number) =>
    layout.margin.left + index * (columnWidth + layout.columnGap);

  let y = layout.margin.top;
  /** Header (title/authors) spans the page; body flows in template columns. */
  let mode: 'full' | 'body' = 'full';
  let col = 0;
  let bodyTop = layout.margin.top;

  const flowX = () => (mode === 'full' ? layout.margin.left : colX(col));
  const flowWidth = () => (mode === 'full' ? contentWidth : columnWidth);

  const advanceFlow = () => {
    if (mode === 'body' && layout.columns === 2 && col === 0) {
      col = 1;
      y = bodyTop;
      return;
    }
    doc.addPage();
    col = 0;
    y = layout.margin.top;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= bottom) return;
    advanceFlow();
  };

  const applyFont = (run: InlineRun, sizePt: number) => {
    const cjk = cjkReady && NON_LATIN1.test(run.text);
    const family = cjk ? CJK_FONT_FAMILY : run.code ? 'courier' : layout.font;
    const style = cjk
      ? 'normal'
      : run.bold && run.italic
        ? 'bolditalic'
        : run.bold
          ? 'bold'
          : run.italic
            ? 'italic'
            : 'normal';
    doc.setFont(family, style);
    doc.setFontSize(run.sup || run.sub ? sizePt * 0.72 : sizePt);
    return { cjk, bold: cjk && run.bold };
  };

  const measureToken = (token: InlineToken, sizePt: number): number => {
    applyFont(token.style, sizePt);
    return doc.getTextWidth(token.text);
  };

  const tokenize = (runs: InlineRun[]): InlineToken[] => {
    const tokens: InlineToken[] = [];
    for (const run of runs) {
      // If the Unicode font could not be loaded, degrade unsupported glyphs to
      // `?` instead of letting jsPDF truncate them into mojibake.
      const normalized = (cjkReady ? run.text : winAnsiSafe(run.text)).replace(/\s+/g, ' ');
      for (const part of normalized.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          tokens.push({ text: ' ', style: run, space: true });
          continue;
        }
        // CJK has no word spaces; allow a line break between characters.
        if (NON_LATIN1.test(part) || run.code) {
          for (const char of part) {
            tokens.push({ text: char, style: run, space: false });
          }
        } else {
          tokens.push({ text: part, style: run, space: false });
        }
      }
    }
    return tokens;
  };

  const writeRuns = (
    runs: InlineRun[],
    sizePt: number,
    opts: {
      indentMm?: number;
      align?: 'left' | 'center';
      color?: [number, number, number];
      /** Hanging bullet/number drawn in the indentation of the first line. */
      marker?: string;
      justify?: boolean;
      lineFactor?: number;
    } = {},
  ) => {
    const indentMm = opts.indentMm ?? 0;
    const lineHeight = sizePt * PT_TO_MM * (opts.lineFactor ?? layout.lineFactor);
    const tokens = tokenize(runs);
    if (tokens.length === 0) return;

    const available = flowWidth() - indentMm;
    const lines: InlineToken[][] = [];
    let line: InlineToken[] = [];
    let lineWidth = 0;
    for (const token of tokens) {
      const width = measureToken(token, sizePt);
      if (token.space) {
        if (line.length > 0) {
          line.push(token);
          lineWidth += width;
        }
        continue;
      }
      if (lineWidth + width > available && line.some((t) => !t.space)) {
        while (line.length > 0 && line[line.length - 1]!.space) line.pop();
        lines.push(line);
        line = [];
        lineWidth = 0;
      }
      line.push(token);
      lineWidth += width;
    }
    if (line.length > 0) {
      while (line.length > 0 && line[line.length - 1]!.space) line.pop();
      lines.push(line);
    }

    doc.setTextColor(...(opts.color ?? TEXT_COLOR));
    let firstLine = true;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const current = lines[lineIndex]!;
      ensureSpace(lineHeight);
      if (firstLine && opts.marker) {
        const markerCjk = cjkReady && NON_LATIN1.test(opts.marker);
        doc.setFont(markerCjk ? CJK_FONT_FAMILY : layout.font, 'normal');
        doc.setFontSize(sizePt);
        doc.text(opts.marker, flowX() + Math.max(0, indentMm - 4.5), y);
        firstLine = false;
      }
      const widths = current.map((token) => measureToken(token, sizePt));
      const total = widths.reduce((sum, width) => sum + width, 0);
      const isLast = lineIndex === lines.length - 1;
      const spaces = current.filter((token) => token.space).length;
      const extraSpace =
        opts.justify && !isLast && spaces > 0
          ? Math.max(0, available - total) / spaces
          : 0;
      let x =
        opts.align === 'center'
          ? flowX() + indentMm + Math.max(0, (available - total) / 2)
          : flowX() + indentMm;
      for (let i = 0; i < current.length; i += 1) {
        const token = current[i]!;
        const { bold } = applyFont(token.style, sizePt);
        const shift = token.style.sup
          ? -sizePt * PT_TO_MM * 0.35
          : token.style.sub
            ? sizePt * PT_TO_MM * 0.18
            : 0;
        doc.text(token.text, x, y + shift);
        if (bold) doc.text(token.text, x + sizePt * PT_TO_MM * 0.03, y + shift);
        x += (widths[i] ?? 0) + (token.space ? extraSpace : 0);
      }
      y += lineHeight;
    }
  };

  const writeRich = (
    node: Node,
    sizePt: number,
    opts: {
      indentMm?: number;
      align?: 'left' | 'center';
      color?: [number, number, number];
      marker?: string;
      justify?: boolean;
      lineFactor?: number;
    } = {},
    base: InlineStyle = BASE_INLINE_STYLE,
  ) => {
    writeRuns(collectInlineRuns(node, base), sizePt, opts);
  };

  const write = (
    value: string,
    sizePt: number,
    style: 'normal' | 'bold' | 'italic' = 'normal',
    indentMm = 0,
    opts: {
      align?: 'left' | 'center';
      color?: [number, number, number];
      justify?: boolean;
      lineFactor?: number;
    } = {},
  ) => {
    const text = cleanText(value);
    if (!text) return;
    const runs: InlineRun[] = [
      { text, ...BASE_INLINE_STYLE, bold: style === 'bold', italic: style === 'italic' },
    ];
    writeRuns(runs, sizePt, { indentMm, ...opts });
  };

  const writeCode = (value: string) => {
    const sizePt = 8;
    const lineHeight = sizePt * PT_TO_MM * 1.35;
    doc.setTextColor(45, 48, 54);
    for (const rawLine of value.split(/\r?\n/)) {
      const cjk = cjkReady && NON_LATIN1.test(rawLine);
      doc.setFont(cjk ? CJK_FONT_FAMILY : 'courier', 'normal');
      doc.setFontSize(sizePt);
      const lines = doc.splitTextToSize(
        (cjkReady ? rawLine : winAnsiSafe(rawLine)).replace(/\t/g, '  ') || ' ',
        flowWidth() - 3,
      );
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, flowX() + 3, y);
        y += lineHeight;
      }
    }
  };

  const writeTable = (table: Element) => {
    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('td, th'))
        .map((cell) => cleanText(cell.textContent))
        .join('  |  '),
    );
    for (const row of rows) {
      if (row) write(row, Math.max(7.5, layout.bodyPt - 1.5), 'normal', 0, { lineFactor: 1.3 });
    }
  };

  for (const node of Array.from(container.children)) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'header') {
      write(node.querySelector('h1')?.textContent ?? '', layout.titlePt, 'bold', 0, {
        align: 'center',
        lineFactor: 1.16,
      });
      const authors = Array.from(node.querySelectorAll('.lp-author'))
        .map((el) => cleanText(el.textContent))
        .filter(Boolean)
        .join(' · ');
      if (authors) {
        y += 2.5;
        write(authors, layout.authorPt, 'normal', 0, {
          align: 'center',
          color: MUTED_COLOR,
          lineFactor: 1.2,
        });
      }
      y += 5;
      bodyTop = y;
      mode = 'body';
      col = 0;
      continue;
    }
    if (node.classList.contains('lp-abstract')) {
      y += 1.5;
      write('Abstract', layout.abstractPt, 'bold', 0, { lineFactor: 1.2 });
      y += 0.5;
      const paragraph = node.querySelector('p');
      if (paragraph) {
        writeRich(paragraph, layout.abstractPt, {
          color: MUTED_COLOR,
          justify: true,
          lineFactor: 1.28,
        });
      }
      y += 2.5;
      continue;
    }
    if (tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5') {
      const size =
        tag === 'h2'
          ? layout.headingPt.h2
          : tag === 'h3'
            ? layout.headingPt.h3
            : layout.headingPt.h4;
      y += tag === 'h2' ? 3.5 : 2.4;
      write(node.textContent ?? '', size, 'bold', 0, { lineFactor: 1.18 });
      y += 1.2;
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      Array.from(node.querySelectorAll(':scope > li')).forEach((li, index) => {
        // A hyphen keeps the marker inside WinAnsi when no Unicode font is
        // embedded; the pipeline otherwise renders it as `?`.
        const marker = ordered ? `${index + 1}.` : cjkReady ? '•' : '-';
        writeRich(li, layout.bodyPt, {
          indentMm: 5,
          marker,
          justify: true,
          lineFactor: 1.32,
        });
        y += 0.5;
      });
      y += 1.5;
      continue;
    }
    if (tag === 'figure') {
      const caption = node.querySelector('figcaption');
      const art = node.querySelector('.lp-figure-art svg, svg');
      if (art) {
        const aspect = svgAspectRatio(art);
        const maxHeight = bottom - layout.margin.top - 12;
        const box = fitSvgBox(aspect, flowWidth(), maxHeight);
        if (y + box.height + 10 > bottom) advanceFlow();
        try {
          const png = await rasterizePNG(
            new XMLSerializer().serializeToString(art),
            300 / 96,
          );
          doc.addImage(
            pngDataUrl(png),
            'PNG',
            flowX() + (flowWidth() - box.width) / 2,
            y,
            box.width,
            box.height,
          );
        } catch {
          write('[Figure could not be rendered]', layout.bodyPt, 'italic');
        }
        y += box.height + 2.5;
      } else {
        const placeholder = cleanText(node.querySelector('.lp-figure-placeholder')?.textContent);
        if (placeholder) {
          write(`[Figure not found: ${placeholder}]`, layout.captionPt, 'italic');
          y += 2;
        }
      }
      if (caption) {
        writeRich(
          caption,
          layout.captionPt,
          { align: 'center', color: MUTED_COLOR, lineFactor: 1.25 },
          { ...BASE_INLINE_STYLE, italic: true },
        );
      }
      const table = node.querySelector('table');
      if (table) {
        y += 1;
        writeTable(table);
      }
      y += 2.5;
      continue;
    }
    if (tag === 'div' && node.classList.contains('lp-equation')) {
      y += 2.5;
      write(node.textContent ?? '', layout.bodyPt, 'normal', 0, { align: 'center' });
      y += 2.5;
      continue;
    }
    if (tag === 'pre') {
      y += 1.5;
      writeCode(node.textContent ?? '');
      y += 1.5;
      continue;
    }
    if (tag === 'table') {
      writeTable(node);
      y += 2;
      continue;
    }
    if (tag === 'div' && node.classList.contains('lp-center')) {
      writeRich(node, layout.bodyPt, { align: 'center' });
      y += 2;
      continue;
    }
    writeRich(node, layout.bodyPt, { justify: true });
    y += 2.5;
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/** One laid-out block of a plain-text document (notebook / report). */
export interface PdfTextBlock {
  kind: 'heading' | 'text' | 'bullet' | 'code';
  text: string;
  /** 1–4 for headings. */
  level?: number;
}

// --------------------------------------------------------------------------
// Plain-text PDF (notebook)
// --------------------------------------------------------------------------

/**
 * Render ordered text blocks into PDF bytes. Used by the collaboration
 * notebook, whose export must produce a real PDF file (not a print dialog).
 */
export async function buildTextPdf(
  title: string,
  blocks: PdfTextBlock[],
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('buildTextPdf is only available in a browser environment');
  }
  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const doc = new jspdfMod.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const needsCjk = NON_LATIN1.test(title) || blocks.some((block) => NON_LATIN1.test(block.text));
  const cjkReady = await registerFont(doc, needsCjk);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - MARGIN_MM * 2;
  let y = MARGIN_MM;

  const ensureSpace = (height: number) => {
    if (y + height <= pageHeight - MARGIN_MM) return;
    doc.addPage();
    y = MARGIN_MM;
  };

  const write = (
    value: string,
    sizePt: number,
    style: 'normal' | 'bold' | 'italic' = 'normal',
    indentMm = 0,
    family = 'times',
  ) => {
    const text = cleanText(value);
    if (!text) return;
    const cjk = cjkReady && NON_LATIN1.test(text);
    doc.setFont(cjk ? CJK_FONT_FAMILY : family, cjk ? 'normal' : style);
    doc.setFontSize(sizePt);
    doc.setTextColor(28, 30, 34);
    const lines = doc.splitTextToSize(cjkReady ? text : winAnsiSafe(text), maxWidth - indentMm);
    const lineHeight = sizePt * PT_TO_MM * 1.45;
    const fakeBold = cjk && style === 'bold';
    const boldOffset = sizePt * PT_TO_MM * 0.03;
    for (const line of lines) {
      ensureSpace(lineHeight);
      const x = MARGIN_MM + indentMm;
      doc.text(line, x, y);
      if (fakeBold) doc.text(line, x + boldOffset, y);
      y += lineHeight;
    }
  };

  const writeCode = (value: string) => {
    const lineHeight = 8.5 * PT_TO_MM * 1.35;
    for (const rawLine of value.split(/\r?\n/)) {
      const cjk = cjkReady && NON_LATIN1.test(rawLine);
      doc.setFont(cjk ? CJK_FONT_FAMILY : 'courier', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(45, 48, 54);
      const lines = doc.splitTextToSize(
        rawLine.replace(/\t/g, '  ') || ' ',
        maxWidth - 4,
      );
      for (const line of lines) {
        ensureSpace(lineHeight);
        doc.text(line, MARGIN_MM + 4, y);
        y += lineHeight;
      }
    }
  };

  write(title, 18, 'bold');
  y += 5;

  for (const block of blocks) {
    if (block.kind === 'heading') {
      y += 2;
      const level = block.level ?? 1;
      const size = level <= 1 ? 15 : level === 2 ? 12.5 : 11;
      write(block.text, size, 'bold');
      y += 1;
    } else if (block.kind === 'bullet') {
      write(`• ${block.text}`, 10, 'normal', 5);
    } else if (block.kind === 'code') {
      y += 1;
      writeCode(block.text);
      y += 2;
    } else {
      write(block.text, 10);
      y += 2;
    }
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Render a collaboration notebook (Markdown + fenced code cells) into PDF
 * bytes. Keeps the README-style structure: headings, paragraphs, bullets and
 * code blocks survive the export.
 */
export async function buildNotebookPdf(note: CollabNote): Promise<Uint8Array> {
  const blocks: PdfTextBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ kind: 'text', text });
  };
  const flushCode = () => {
    if (code.length > 0) blocks.push({ kind: 'code', text: code.join('\n') });
    code = [];
    inCode = false;
  };

  for (const line of notebookToMarkdown(note).split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      if (inCode) flushCode();
      else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[2] ?? '', level: heading[1]?.length ?? 1 });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: bullet[1] ?? '' });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  if (inCode) flushCode();

  return buildTextPdf(note.title, blocks);
}
