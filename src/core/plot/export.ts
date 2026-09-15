// ==========================================================================
// Ergalics Studio — plot export (SVG file + PDF, browser only)
//
// SVG exports are trivial (the markup is already a string). PDF relies on
// `jspdf` + `svg2pdf.js`, both loaded *dynamically* so they never enter the
// Standard-mode initial bundle. PDF export is skipped in non-DOM (test/node)
// environments by design.
// ==========================================================================

/** Trigger a browser download of the given text content. */
export function downloadText(
  content: string,
  filename: string,
  mime: string,
): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
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
  img.src = url;
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
  };
}

/**
 * Render an SVG string into a vector PDF and download it.
 * Lazily imports `jspdf` + `svg2pdf.js`; throws if unavailable.
 */
export async function exportPDF(
  svg: string,
  filename = 'plot.pdf',
  widthMm = 180,
): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('exportPDF is only available in a browser environment');
  }
  // `as any` on the specifier keeps tsc from demanding type declarations for
  // these optional, browser-only deps (they are loaded lazily at runtime).
  const jspdfMod = (await import('jspdf' as any)) as JsPdfModule;
  const svg2pdfMod = (await import('svg2pdf.js' as any)) as Svg2PdfModule;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('invalid SVG markup');
  // Attach to the live document before rendering: svg2pdf measures text via
  // `getBBox`, which only works on elements that are part of the rendered tree.
  // Some browsers (e.g. Firefox) throw on detached elements otherwise.
  svgEl.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden');
  document.body.appendChild(svgEl);
  try {
    const pdf = new jspdfMod.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await svg2pdfMod.svg2pdf(svgEl as unknown as SVGElement, pdf, {
      x: (297 - widthMm) / 2,
      y: 15,
      width: widthMm,
    });
    pdf.save(filename);
  } finally {
    svgEl.remove();
  }
}
