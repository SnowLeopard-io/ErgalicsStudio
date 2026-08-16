// ==========================================================================
// Ergalics Studio — block canvas geometry (block system)
//
// Pure coordinate/geometry math for the block canvas. Keeping this free of
// React/DOM lets the trickiest part of the editor — hit testing, viewport
// transforms, connection routing — be unit-tested directly.
// ==========================================================================

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const NODE_WIDTH = 180;
export const NODE_HEADER_HEIGHT = 34;
export const NODE_PORT_ROW = 24;
export const NODE_PARAM_ROW = 18;
export const NODE_PADDING_BOTTOM = 10;
export const PORT_RADIUS = 6;
export const MAX_PARAM_ROWS = 6;

/** Node height: header + param rows + port rows + padding. */
export function nodeHeight(
  inputCount: number,
  outputCount: number,
  paramCount = 0,
): number {
  const portRows = Math.max(inputCount, outputCount, 1);
  const paramRows = Math.min(paramCount, MAX_PARAM_ROWS);
  return (
    NODE_HEADER_HEIGHT +
    paramRows * NODE_PARAM_ROW +
    portRows * NODE_PORT_ROW +
    NODE_PADDING_BOTTOM
  );
}

export function screenToWorld(p: Point, viewport: Viewport): Point {
  return { x: (p.x - viewport.x) / viewport.zoom, y: (p.y - viewport.y) / viewport.zoom };
}

export function worldToScreen(p: Point, viewport: Viewport): Point {
  return { x: p.x * viewport.zoom + viewport.x, y: p.y * viewport.zoom + viewport.y };
}

/** Cubic Bézier path between two ports (horizontal control points). */
export function connectionPath(from: Point, to: Point): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

/** Port position relative to the node's top-left corner (unscaled screen px). */
export function portOffset(index: number, side: 'in' | 'out', paramRows = 0): Point {
  return {
    x: side === 'in' ? 0 : NODE_WIDTH,
    y: NODE_HEADER_HEIGHT + paramRows * NODE_PARAM_ROW + (index + 0.5) * NODE_PORT_ROW,
  };
}

export function hitTestPoint(p: Point, center: Point, radius: number): boolean {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function pointInRect(p: Point, rect: Rect): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
