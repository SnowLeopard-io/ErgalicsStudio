// ==========================================================================
// Ergalics Studio — shared SVG → jsPDF rendering
//
// Used by standalone chart exports and by the manuscript exporter when it
// embeds resolved Figure Studio artwork. Handles the two things jsPDF cannot
// do on its own: embedding a Unicode font for non-Latin labels, and sizing
// from the SVG's intrinsic aspect ratio.
// ==========================================================================

import {
  CJK_FONT_FAMILY,
  NON_LATIN1,
  ensureFontFace,
  registerFont,
  type PdfFontDoc,
} from './font';

export interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Svg2PdfModule {
  svg2pdf: (element: SVGElement, pdf: unknown, options?: SvgBox) => Promise<void>;
}

/** Intrinsic width/height ratio from `viewBox`, falling back to the attributes. */
export function svgAspectRatio(svgEl: Element): number {
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    const vbWidth = parts[2];
    const vbHeight = parts[3];
    if (
      vbWidth !== undefined &&
      vbHeight !== undefined &&
      Number.isFinite(vbWidth) &&
      Number.isFinite(vbHeight) &&
      vbWidth > 0 &&
      vbHeight > 0
    ) {
      return vbWidth / vbHeight;
    }
  }
  const width = Number.parseFloat(svgEl.getAttribute('width') ?? '');
  const height = Number.parseFloat(svgEl.getAttribute('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width / height;
  }
  return 4 / 3;
}

/** Fit an aspect ratio into a box without distortion. */
export function fitSvgBox(
  aspect: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  let width = maxWidth;
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

/** Resolve the jsPDF font style svg2pdf will request for this element. */
function svgFontStyle(el: Element): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  let weight = '';
  let style = '';
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (!weight) weight = node.getAttribute('font-weight') ?? '';
    if (!style) style = node.getAttribute('font-style') ?? '';
  }
  const numericWeight = Number.parseInt(weight, 10);
  const bold = weight === 'bold' || weight === 'bolder' || numericWeight >= 600;
  const italic = style === 'italic' || style === 'oblique';
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/**
 * Draw SVG markup into an existing jsPDF document at `box` (millimetres).
 * The element is briefly attached to the live document because svg2pdf uses
 * `getBBox`, which needs a rendered tree.
 */
export async function drawSvgToPdf(
  svg: string,
  pdf: PdfFontDoc,
  box: SvgBox,
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('drawSvgToPdf is only available in a browser environment');
  }
  const svg2pdfMod = (await import('svg2pdf.js' as any)) as Svg2PdfModule;
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('invalid SVG markup');
  const svgEl = parsed.querySelector('svg');
  if (!svgEl) throw new Error('invalid SVG markup');

  // Greek letters / CJK in labels cannot be encoded by jsPDF's built-in
  // fonts (π used to come out as ¼). Embed the Unicode font and point the
  // affected text nodes at it; Latin-only artwork keeps the compact base fonts.
  const unicodeNodes = Array.from(svgEl.querySelectorAll('text, tspan')).filter((el) =>
    NON_LATIN1.test(el.textContent ?? ''),
  );
  const fontStyles = new Set<string>(['normal']);
  for (const el of unicodeNodes) fontStyles.add(svgFontStyle(el));
  if (unicodeNodes.length > 0) await ensureFontFace();

  svgEl.setAttribute('style', 'position:absolute;left:-99999px;top:0');
  document.body.appendChild(svgEl);
  try {
    const fontReady = await registerFont(pdf, unicodeNodes.length > 0, [...fontStyles]);
    if (fontReady) {
      for (const el of unicodeNodes) el.setAttribute('font-family', CJK_FONT_FAMILY);
    }
    await svg2pdfMod.svg2pdf(svgEl as unknown as SVGElement, pdf, box);
  } finally {
    svgEl.remove();
  }
}
