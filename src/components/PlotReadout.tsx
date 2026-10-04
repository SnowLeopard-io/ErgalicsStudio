// ==========================================================================
// Interactive plot readout: crosshair + monospace data readout
//
// Wraps an SVG plot (any panel drawn by renderSVG) and, while the pointer is
// over the axes, draws a hairline crosshair and pins a mono readout card just
// below the cursor — flipped above when near the bottom edge so it never runs
// off the canvas. Coordinates map back to data space via plotGeometry/fromPixel
// so the readout always matches the rendered scales.
// ==========================================================================

import { useRef, useState, type ReactNode } from 'react';
import type { PlotGeometry } from '@/core/plot/geometry';
import { fromPixel } from '@/core/plot/geometry';
import { formatTick } from '@/core/plot/scale';

interface HoverState {
  /** Cursor position in SVG viewBox coordinates. */
  sx: number;
  sy: number;
  dataX: number;
  dataY: number;
  inside: boolean;
  /** Wrapper CSS-px position of the pointer — crosshair and card both anchor
   *  here so they always sit exactly under the cursor, even when the SVG is
   *  CSS-scaled away from its viewBox aspect. */
  cssX: number;
  cssY: number;
}

interface PlotReadoutProps {
  geometry: PlotGeometry | null;
  children: ReactNode;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  /** Optional nearest-point lookup: given pointer data coords, return a point
   *  on a series (in data space) to emphasize in the readout. */
  nearest?: (x: number, y: number) => { x: number; y: number } | null;
}

export function PlotReadout({
  geometry,
  children,
  formatX = formatTick,
  formatY = formatTick,
  nearest,
}: PlotReadoutProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const geom = geometry;
    const wrap = wrapRef.current;
    if (!geom || !wrap) {
      setHover(null);
      return;
    }
    const svg = wrap.querySelector('svg');
    const svgRect = svg ? svg.getBoundingClientRect() : wrap.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;
    // Client → viewBox coordinates (the SVG may be CSS-scaled).
    const sx = (e.clientX - svgRect.left) * (geom.width / svgRect.width);
    const sy = (e.clientY - svgRect.top) * (geom.height / svgRect.height);
    const inside =
      sx >= geom.left &&
      sx <= geom.left + geom.plotW &&
      sy >= geom.topV &&
      sy <= geom.topV + geom.plotH;
    if (!inside) {
      setHover(null);
      return;
    }
    const dataX = fromPixel(geom.xScaleKind, geom.xDom, [geom.left, geom.left + geom.plotW], sx);
    const dataY = fromPixel(geom.yScaleKind, geom.yDom, [geom.topV + geom.plotH, geom.topV], sy);
    // viewBox → wrapper CSS-px (SVG may be CSS-scaled; the crosshair and card
    // are absolutely positioned in the wrapper, so the cursor must be mapped
    // into the same space).
    const wrapRect = wrap.getBoundingClientRect();
    const cssX = svgRect.left - wrapRect.left + sx * (svgRect.width / geom.width);
    const cssY = svgRect.top - wrapRect.top + sy * (svgRect.height / geom.height);
    setHover({ sx, sy, dataX, dataY, inside, cssX, cssY });
  };

  const geom = geometry;
  const crossX = hover && geom ? hover.cssX : 0;
  const crossY = hover && geom ? hover.cssY : 0;
  const pt = hover && nearest ? nearest(hover.dataX, hover.dataY) : null;

  const card = hover && geom ? { left: hover.cssX, top: hover.cssY } : null;
  const flipUp = card ? card.top > (wrapRef.current?.clientHeight ?? 0) * 0.62 : false;

  return (
    <div className="plot-readout" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {children}
      {hover && geom && (
        <>
          {/* Crosshair spans the whole wrapper so it stays visible across the
              axes box without clipping. */}
          <div className="plot-crosshair" style={{ left: crossX, top: 0, height: '100%' }} />
          <div className="plot-crosshair" style={{ top: crossY, left: 0, width: '100%' }} />
          {card && (
            <div
              className={`plot-readout-card${flipUp ? ' is-flipped' : ''}`}
              style={{ left: card.left, top: card.top }}
            >
              <div className="plot-readout-row">
                <span className="plot-readout-key">x</span>
                <span className="plot-readout-val">{formatX(hover.dataX)}</span>
              </div>
              <div className="plot-readout-row">
                <span className="plot-readout-key">y</span>
                <span className="plot-readout-val">{formatY(hover.dataY)}</span>
              </div>
              {pt && (
                <div className="plot-readout-row plot-readout-nearest">
                  <span className="plot-readout-key">●</span>
                  <span className="plot-readout-val">
                    {formatX(pt.x)}, {formatY(pt.y)}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
