// ==========================================================================
// Experimental vector PDF export (FR-9)
//
// The default PDF path embeds a 600-dpi raster for font compatibility. This
// path draws the same SVG markup as vectors via svg2pdf.js so text stays
// selectable. Both modes consume one markup string — never two renderers.
// ==========================================================================

import { svgAspectRatio, fitSvgBox } from './svg';

export async function buildVectorPDF(
  svg: string,
  widthMm = 180,
  heightMm?: number,
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('buildVectorPDF is only available in a browser environment');
  }
  const jspdfMod = (await import('jspdf' as any)) as {
    jsPDF: new (opts: { orientation: string; unit: string; format: [number, number] }) => {
      output: (type: string) => ArrayBuffer;
    };
  };
  const svg2pdfMod = (await import('svg2pdf.js' as any)) as {
    svg2pdf: (
      el: Element,
      doc: unknown,
      opts: { x: number; y: number; width: number; height: number },
    ) => Promise<void>;
  };

  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const svgEl = parsed.querySelector('svg');
  if (!svgEl) throw new Error('invalid SVG markup');
  const aspect = svgAspectRatio(svgEl);
  const pageHeight = heightMm ?? widthMm / aspect;
  const doc = new jspdfMod.jsPDF({
    orientation: pageHeight >= widthMm ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [widthMm, pageHeight],
  });
  const box = fitSvgBox(aspect, widthMm, pageHeight);
  await svg2pdfMod.svg2pdf(svgEl, doc, {
    x: (widthMm - box.width) / 2,
    y: (pageHeight - box.height) / 2,
    width: box.width,
    height: box.height,
  });
  return new Uint8Array(doc.output('arraybuffer'));
}
