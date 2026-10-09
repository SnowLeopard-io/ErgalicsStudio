// ==========================================================================
// Ergalics Studio — plot export (SVG file + PDF, browser only)
//
// SVG exports are trivial (the markup is already a string). PDF relies on
// `jspdf` + `svg2pdf.js`, both loaded *dynamically* so they never enter the
// Standard-mode initial bundle. PDF export is skipped in non-DOM (test/node)
// environments by design.
// ==========================================================================

import { logger } from '@/core/logger';

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
    addImage?: unknown;
    output?: (type: string) => unknown;
  };
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
  // Attach to the live document before rendering: svg2pdf measures text and
  // element geometry via `getBBox`, which only works on elements that are part
  // of the rendered tree (Firefox throws on detached elements). The clone must
  // keep its real `width`/`height` attributes — clamping the box to 1px makes
  // svg2pdf collapse the whole figure into a 1px layout box (blank PDF).
  svgEl.setAttribute('style', 'position:absolute;left:-99999px;top:0');
  document.body.appendChild(svgEl);
  try {
    const pdf = new jspdfMod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await svg2pdfMod.svg2pdf(svgEl as unknown as SVGElement, pdf, {
      x: (297 - widthMm) / 2,
      y: 15,
      width: widthMm,
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
