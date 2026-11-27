// ==========================================================================
// Ergalics Studio — shared SVG sizing for PDF embedding
//
// Charts are rasterized (see `@/core/plot/export`) before they reach jsPDF, so
// the exporter only needs to fit the SVG's intrinsic aspect ratio into the
// printable area without distortion.
// ==========================================================================

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
