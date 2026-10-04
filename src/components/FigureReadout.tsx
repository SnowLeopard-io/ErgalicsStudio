// ==========================================================================
// Multi-panel figure readout: crosshair + mono readout for composed figures
//
// Wraps the composed figure SVG (one inline svg root with nested per-panel viewports).
// Pointer hits are mapped to figure coordinates, then to the panel under the
// cursor (panels are placed at known x/y with per-panel plotGeometry). The
// crosshair stays inside the hit panel's axes box and the readout card follows
// the cursor — flipped above when near the bottom so it never clips.
// ==========================================================================

import { useRef, useState, type ReactNode } from 'react';
import type { PlotGeometry } from '@/core/plot/geometry';
import { fromPixel } from '@/core/plot/geometry';
import { formatTick } from '@/core/plot/scale';

export interface FigurePanelGeom {
  /** Panel origin in figure coordinates. */
  x: number;
  y: number;
  geometry: PlotGeometry;
}

interface HoverState {
  /** Hit panel origin + cursor position in figure coordinates. */
  panel: FigurePanelGeom;
  fx: number;
  fy: number;
  dataX: number;
  dataY: number;
  /** Crosshair geometry in wrapper CSS-px (converted from figure coords —
   *  the SVG may be CSS-scaled, and the crosshair is absolutely positioned
   *  in the wrapper, so figure coords must be mapped into the same space). */
  css: { left: number; top: number; width: number; height: number; x: number; y: number };
}

interface FigureReadoutProps {
  panels: FigurePanelGeom[];
  children: ReactNode;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
}

export function FigureReadout({
  panels,
  children,
  formatX = formatTick,
  formatY = formatTick,
}: FigureReadoutProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const hitTest = (fx: number, fy: number): FigurePanelGeom | null => {
    for (const p of panels) {
      const { left, topV, plotW, plotH } = p.geometry;
      if (fx >= p.x + left && fx <= p.x + left + plotW && fy >= p.y + topV && fy <= p.y + topV + plotH) {
        return p;
      }
    }
    return null;
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap || panels.length === 0) {
      setHover(null);
      return;
    }
    const svg = wrap.querySelector('svg');
    const svgRect = svg ? svg.getBoundingClientRect() : wrap.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;
    // Client → figure viewBox coordinates (the figure may be CSS-scaled).
    const svgViewW = svg ? Number(svg.getAttribute('viewBox')?.split(' ')[2]) || svgRect.width : svgRect.width;
    const svgViewH = svg ? Number(svg.getAttribute('viewBox')?.split(' ')[3]) || svgRect.height : svgRect.height;
    const fx = (e.clientX - svgRect.left) * (svgViewW / svgRect.width);
    const fy = (e.clientY - svgRect.top) * (svgViewH / svgRect.height);

    const panel = hitTest(fx, fy);
    if (!panel) {
      setHover(null);
      return;
    }
    const g = panel.geometry;
    const lx = fx - panel.x;
    const ly = fy - panel.y;
    const dataX = fromPixel(g.xScaleKind, g.xDom, [g.left, g.left + g.plotW], lx);
    const dataY = fromPixel(g.yScaleKind, g.yDom, [g.topV + g.plotH, g.topV], ly);
    // Figure viewBox → wrapper CSS-px for the crosshair (the composed SVG is
    // CSS-scaled into its container; the crosshair is absolutely positioned
    // in the wrapper so the mapping must be explicit).
    const wrapRect = wrap.getBoundingClientRect();
    const originX = svgRect.left - wrapRect.left;
    const originY = svgRect.top - wrapRect.top;
    const kx = svgRect.width / svgViewW;
    const ky = svgRect.height / svgViewH;
    setHover({
      panel,
      fx,
      fy,
      dataX,
      dataY,
      css: {
        left: originX + (panel.x + g.left) * kx,
        top: originY + (panel.y + g.topV) * ky,
        width: g.plotW * kx,
        height: g.plotH * ky,
        x: originX + fx * kx,
        y: originY + fy * ky,
      },
    });
  };

  // Crosshair box in wrapper CSS-px (the hit panel's plot area).
  let cross = { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0 };
  if (hover) cross = hover.css;

  const card = hover ? { left: hover.css.x, top: hover.css.y } : null;
  const flipUp = card ? card.top > (wrapRef.current?.clientHeight ?? 0) * 0.6 : false;

  return (
    <div className="plot-readout" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {children}
      {hover && cross.width > 0 && (
        <>
          <div
            className="plot-crosshair plot-crosshair-vertical"
            style={{ left: cross.x, top: cross.top, height: cross.height }}
          />
          <div
            className="plot-crosshair plot-crosshair-horizontal"
            style={{ top: cross.y, left: cross.left, width: cross.width }}
          />
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
