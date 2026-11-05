// ==========================================================================
// Ergalics Studio — manuscript PDF export
//
// The LaTeX preview is already rendered to semantic HTML. There is no TeX
// distribution in the browser, so this module lays that rendered content out
// with jsPDF's text API: title, authors, headings, paragraphs, lists and
// captions become a real, downloadable PDF alongside the .tex/.bib sources.
//
// jsPDF is imported lazily so it never enters the Standard-mode initial
// bundle, mirroring `@/core/plot/export`.
// ==========================================================================

import { latexPreviewBody, type LatexPreviewOptions } from './latex';

interface JsPdfDoc {
  setFont(family: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string, x: number, y: number): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  addPage(): void;
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

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Render a `.tex` source into PDF bytes.
 *
 * Browser-only: the preview parser needs a DOM (DOMParser) and jsPDF needs a
 * document to attach its output blob lifecycle to.
 */
export async function buildManuscriptPdf(
  source: string,
  options: LatexPreviewOptions = {},
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

  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const doc = new jspdfMod.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
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
  ) => {
    const text = cleanText(value);
    if (!text) return;
    doc.setFont('times', style);
    doc.setFontSize(sizePt);
    doc.setTextColor(28, 30, 34);
    const lines = doc.splitTextToSize(text, maxWidth - indentMm);
    const lineHeight = sizePt * PT_TO_MM * 1.45;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN_MM + indentMm, y);
      y += lineHeight;
    }
  };

  for (const node of Array.from(container.children)) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'header') {
      write(node.querySelector('h1')?.textContent ?? '', 18, 'bold');
      const authors = Array.from(node.querySelectorAll('.lp-author'))
        .map((el) => cleanText(el.textContent))
        .filter(Boolean)
        .join(' · ');
      if (authors) {
        y += 1.5;
        doc.setTextColor(90, 94, 100);
        write(authors, 10);
      }
      y += 5;
      continue;
    }
    if (tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5') {
      y += 3;
      const size = tag === 'h2' ? 14 : tag === 'h3' ? 12 : 11;
      write(node.textContent ?? '', size, 'bold');
      y += 1;
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      Array.from(node.querySelectorAll(':scope > li')).forEach((li, index) => {
        write(`${ordered ? `${index + 1}.` : '•'} ${li.textContent ?? ''}`, 10, 'normal', 5);
      });
      y += 2;
      continue;
    }
    if (tag === 'figure') {
      const caption = node.querySelector('figcaption')?.textContent;
      write(caption ?? '', 9, 'italic', 2);
      y += 1;
      continue;
    }
    if (tag === 'pre') {
      write(node.textContent ?? '', 9);
      y += 2;
      continue;
    }
    if (tag === 'table') {
      write(node.textContent ?? '', 9);
      y += 2;
      continue;
    }
    write(node.textContent ?? '', 10);
    y += 2;
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
