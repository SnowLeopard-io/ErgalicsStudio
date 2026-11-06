// ==========================================================================
// Ergalics Studio — plot export (SVG file + PDF, browser only)
//
// SVG exports are trivial (the markup is already a string). PDF relies on
// `jspdf` + `svg2pdf.js`, both loaded *dynamically* so they never enter the
// Standard-mode initial bundle. PDF export is skipped in non-DOM (test/node)
// environments by design.
// ==========================================================================

import { logger } from '@/core/logger';
import {
  CJK_FONT_FAMILY,
  NON_LATIN1,
  ensureFontFace,
  registerFont,
} from '@/core/pdf/font';

/** Trigger a browser download of the given text content. */
export function downloadText(
  content: string,
  filename: string,
  mime: string,
): void {
  if (typeof document === 'undefined') return;
  downloadBytes(new TextEncoder().encode(content), filename, mime);
}

/** Trigger a browser download of raw bytes. */
export function downloadBytes(
  data: Uint8Array,
  filename: string,
  mime: string,
): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on next tick so the navigation has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download a plot as a standalone .svg file. */
export function exportSVG(svg: string, filename = 'plot.svg'): void {
  downloadText(svg, filename, 'image/svg+xml');
}

/**
 * Pixel dimensions an SVG rasterizes to at a given scale. Pure helper so the
 * math is testable without a canvas implementation.
 */
export function computeRasterSize(
  svg: string,
  scale: number,
): { width: number; height: number } {
  const wMatch = /<svg[^>]*\bwidth="([\d.]+)"/.exec(svg);
  const hMatch = /<svg[^>]*\bheight="([\d.]+)"/.exec(svg);
  const w = wMatch ? Number(wMatch[1]) : 640;
  const h = hMatch ? Number(hMatch[1]) : 420;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Rasterize an SVG string to PNG and download it. `scale` multiplies the
 * SVG's pixel dimensions — 600 dpi print quality is `600/96 ≈ 6.25`.
 * Browser-only (canvas); throws in non-DOM environments.
 */
export function exportPNG(svg: string, filename = 'plot.png', scale = 600 / 96): void {
  if (typeof document === 'undefined') {
    throw new Error('exportPNG is only available in a browser environment');
  }
  const { width, height } = computeRasterSize(svg, scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
    }, 'image/png');
  };
  // A rasterization failure (tainted/malformed SVG) used to leave the blob
  // URL referenced forever — revoke it so the browser can reclaim the memory.
  img.onerror = () => {
    URL.revokeObjectURL(url);
    logger.error('plot', `PNG export failed for ${filename}`);
  };
  img.src = url;
}

/**
 * Rasterize an SVG string to PNG **bytes** (no download). Same rendering
 * pipeline as `exportPNG`; resolves once the bitmap is encoded.
 */
export function rasterizePNG(svg: string, scale = 600 / 96): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('rasterizePNG is only available in a browser environment'));
      return;
    }
    const { width, height } = computeRasterSize(svg, scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('canvas 2d context unavailable'));
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG encoding failed'));
          return;
        }
        void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG rasterization failed'));
    };
    img.src = url;
  });
}

interface Svg2PdfModule {
  svg2pdf: (
    element: SVGElement,
    pdf: unknown,
    options?: { x?: number; y?: number; width?: number; height?: number },
  ) => Promise<void>;
}
interface JsPdfModule {
  jsPDF: new (opts: {
    orientation?: 'portrait' | 'landscape';
    unit?: string;
    format?: string | number[];
  }) => {
    save: (name: string) => void;
    addFileToVFS: (filename: string, data: string) => void;
    addFont: (filename: string, family: string, style?: string) => void;
    addImage?: unknown;
    output?: (type: string) => unknown;
  };
}

/** A4 landscape page used for standalone chart PDFs (mm). */
const PDF_PAGE_WIDTH_MM = 297;
const PDF_PAGE_HEIGHT_MM = 210;
const PDF_MARGIN_MM = 15;

/** Intrinsic width/height ratio from `viewBox`, falling back to the attributes. */
function svgAspectRatio(svgEl: Element): number {
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
 * Render an SVG string into a vector PDF and return the **bytes** (no
 * download). Lazily imports `jspdf` + `svg2pdf.js`; throws if unavailable.
 */
export async function buildPDF(
  svg: string,
  widthMm = 180,
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('buildPDF is only available in a browser environment');
  }
  // `as any` on the specifier keeps tsc from demanding type declarations for
  // these optional, browser-only deps (they are loaded lazily at runtime).
  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const svg2pdfMod = (await import('svg2pdf.js' as any)) as Svg2PdfModule;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('invalid SVG markup');

  // Greek letters / CJK in labels cannot be encoded by jsPDF's built-in
  // fonts (π used to come out as ¼). Embed the Unicode font and point the
  // affected text nodes at it; Latin-only charts keep the compact base fonts.
  const unicodeNodes = Array.from(svgEl.querySelectorAll('text, tspan')).filter((el) =>
    NON_LATIN1.test(el.textContent ?? ''),
  );
  const fontStyles = new Set<string>(['normal']);
  for (const el of unicodeNodes) fontStyles.add(svgFontStyle(el));
  if (unicodeNodes.length > 0) await ensureFontFace();

  // Attach to the live document before rendering: svg2pdf measures text and
  // element geometry via `getBBox`, which only works on elements that are part
  // of the rendered tree (Firefox throws on detached elements). The clone must
  // keep its real `width`/`height` attributes — clamping the box to 1px makes
  // svg2pdf collapse the whole figure into a 1px layout box (blank PDF).
  svgEl.setAttribute('style', 'position:absolute;left:-99999px;top:0');
  document.body.appendChild(svgEl);
  try {
    const pdf = new jspdfMod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const fontReady = await registerFont(pdf, unicodeNodes.length > 0, [...fontStyles]);
    if (fontReady) {
      for (const el of unicodeNodes) el.setAttribute('font-family', CJK_FONT_FAMILY);
    }

    // svg2pdf ignores the SVG's viewBox when sizing unless an explicit height
    // is supplied: passing only `width` made it use the pixel height as
    // millimetres, vertically centring a 420 mm-tall box on a 210 mm page and
    // clipping most of the chart. Fit to the printable area instead.
    const aspect = svgAspectRatio(svgEl);
    const maxWidth = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM * 2;
    const maxHeight = PDF_PAGE_HEIGHT_MM - PDF_MARGIN_MM * 2;
    let outWidth = Math.min(widthMm, maxWidth);
    let outHeight = outWidth / aspect;
    if (outHeight > maxHeight) {
      outHeight = maxHeight;
      outWidth = outHeight * aspect;
    }
    await svg2pdfMod.svg2pdf(svgEl as unknown as SVGElement, pdf, {
      x: (PDF_PAGE_WIDTH_MM - outWidth) / 2,
      y: (PDF_PAGE_HEIGHT_MM - outHeight) / 2,
      width: outWidth,
      height: outHeight,
    });
    const raw = pdf.output?.('arraybuffer');
    if (!(raw instanceof ArrayBuffer)) throw new Error('jsPDF arraybuffer output unavailable');
    return new Uint8Array(raw);
  } finally {
    svgEl.remove();
  }
}

/**
 * Render an SVG string into a vector PDF and download it.
 * Thin wrapper over `buildPDF`.
 */
export async function exportPDF(
  svg: string,
  filename = 'plot.pdf',
  widthMm = 180,
): Promise<void> {
  const bytes = await buildPDF(svg, widthMm);
  downloadBytes(bytes, filename, 'application/pdf');
}
