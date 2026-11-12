// ==========================================================================
// Ergalics Studio — plot export (SVG file + PDF, browser only)
//
// SVG exports are trivial (the markup is already a string). PDF rasterizes the
// SVG at print resolution and embeds a PNG, so the PDF matches the on-screen
// chart exactly (svg2pdf re-flowed bars and mapped π onto its Symbol font).
// `jspdf` is loaded *dynamically* so it never enters the Standard-mode initial
// bundle. PDF export is skipped in non-DOM (test/node) environments by design.
// ==========================================================================

import { logger } from '@/core/logger';
import { fitSvgBox, svgAspectRatio } from '@/core/pdf/svg';

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

/** Base64 data URL for rasterized PNG bytes (jsPDF's accepted image source). */
function pngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
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
    addImage: (
      imageData: string,
      format: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => void;
    output?: (type: string) => unknown;
  };
}

/** A4 landscape page used for standalone chart PDFs (mm). */
const PDF_PAGE_WIDTH_MM = 297;
const PDF_PAGE_HEIGHT_MM = 210;
const PDF_MARGIN_MM = 15;

/**
 * Render an SVG string into a PDF and return the **bytes** (no download).
 *
 * The SVG is rasterized at print resolution and embedded as a PNG instead of
 * being re-drawn with svg2pdf: svg2pdf maps Greek/symbol glyphs onto jsPDF's
 * built-in Symbol font (`π` became `¼`) and re-flows bar geometry, so a
 * rasterized bitmap is the only way to keep the PDF identical to the on-screen
 * preview. Lazily imports `jspdf`; throws if unavailable.
 */
export async function buildPDF(
  svg: string,
  widthMm = 180,
  dpi = 300,
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('buildPDF is only available in a browser environment');
  }
  // `as any` on the specifier keeps tsc from demanding type declarations for
  // this optional, browser-only dep (loaded lazily at runtime).
  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const svgEl = parsed.querySelector('svg');
  if (!svgEl) throw new Error('invalid SVG markup');

  // Fit the intrinsic aspect ratio into the printable area (see the svg2pdf
  // note above: a 420 mm-tall box on a 210 mm page used to clip the chart).
  const aspect = svgAspectRatio(svgEl);
  const maxWidth = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM * 2;
  const maxHeight = PDF_PAGE_HEIGHT_MM - PDF_MARGIN_MM * 2;
  const { width, height } = fitSvgBox(aspect, Math.min(widthMm, maxWidth), maxHeight);

  // The PDF carries a RASTER, so its resolution is the rasterization dpi —
  // the caller's choice, not a hard-coded 300.
  const png = await rasterizePNG(svg, Math.max(1, dpi) / 96);
  const pdf = new jspdfMod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.addImage(
    pngDataUrl(png),
    'PNG',
    (PDF_PAGE_WIDTH_MM - width) / 2,
    (PDF_PAGE_HEIGHT_MM - height) / 2,
    width,
    height,
  );
  const raw = pdf.output?.('arraybuffer');
  if (!(raw instanceof ArrayBuffer)) throw new Error('jsPDF arraybuffer output unavailable');
  return new Uint8Array(raw);
}

/**
 * Render an SVG string into a vector PDF and download it.
 * Thin wrapper over `buildPDF`.
 */
export async function exportPDF(
  svg: string,
  filename = 'plot.pdf',
  widthMm = 180,
  dpi = 300,
): Promise<void> {
  const bytes = await buildPDF(svg, widthMm, dpi);
  downloadBytes(bytes, filename, 'application/pdf');
}
