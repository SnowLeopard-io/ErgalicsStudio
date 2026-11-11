// ==========================================================================
// Regression tests for the terminal window geometry.
//
// The window behaves like a desktop window: dragging an edge moves THAT
// edge, the opposite one stays put, and the window can never leave the
// viewport. The old implementation assumed a docked window and inverted the
// directions as soon as the window was dragged somewhere else.
// ==========================================================================

import { describe, expect, it } from 'vitest';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EDGE_MARGIN = 8;
const SIZE_MIN = { w: 360, h: 200 };

/** Mirrors resizeRect() in the terminal panel. */
function resizeRect(start: Rect, dir: string, dx: number, dy: number): Rect {
  const minW = Math.min(SIZE_MIN.w, window.innerWidth - 2 * EDGE_MARGIN);
  const minH = Math.min(SIZE_MIN.h, window.innerHeight - 2 * EDGE_MARGIN);
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;

  if (dir.includes('n')) {
    top = Math.min(Math.max(start.top + dy, EDGE_MARGIN), bottom - minH);
  }
  if (dir.includes('s')) {
    bottom = Math.max(Math.min(start.top + start.height + dy, window.innerHeight - EDGE_MARGIN), top + minH);
  }
  if (dir.includes('w')) {
    left = Math.min(Math.max(start.left + dx, EDGE_MARGIN), right - minW);
  }
  if (dir.includes('e')) {
    right = Math.max(Math.min(start.left + start.width + dx, window.innerWidth - EDGE_MARGIN), left + minW);
  }
  return { left, top, width: right - left, height: bottom - top };
}

const START: Rect = { left: 300, top: 200, width: 560, height: 340 };

describe('resizeRect — each edge moves its own side', () => {
  it('dragging the top edge up moves the TOP edge (bottom stays)', () => {
    const next = resizeRect(START, 'n', 0, -100);
    expect(next.top).toBe(100);
    expect(next.height).toBe(440);
    expect(next.left).toBe(START.left);
  });

  it('dragging the bottom edge down moves the BOTTOM edge', () => {
    const next = resizeRect(START, 's', 0, 60);
    expect(next.top).toBe(START.top);
    expect(next.height).toBe(400);
  });

  it('dragging the left edge left moves the LEFT edge (right stays)', () => {
    const next = resizeRect(START, 'w', -100, 0);
    expect(next.left).toBe(200);
    expect(next.width).toBe(660);
  });

  it('dragging the right edge right moves the RIGHT edge', () => {
    const next = resizeRect(START, 'e', 80, 0);
    expect(next.width).toBe(640);
    expect(next.left).toBe(START.left);
  });

  it('the corners combine both axes', () => {
    const next = resizeRect(START, 'nw', -50, -40);
    expect(next.left).toBe(250);
    expect(next.top).toBe(160);
    expect(next.width).toBe(610);
    expect(next.height).toBe(380);
  });

  it('the opposite corners work too', () => {
    const next = resizeRect(START, 'se', 30, 20);
    expect(next.left).toBe(START.left);
    expect(next.top).toBe(START.top);
    expect(next.width).toBe(590);
    expect(next.height).toBe(360);
  });
});

describe('resizeRect — the window stays usable', () => {
  it('never shrinks below the minimum size', () => {
    const next = resizeRect(START, 'e', -5000, 0);
    expect(next.width).toBe(SIZE_MIN.w);
    const tall = resizeRect(START, 's', 0, -5000);
    expect(tall.height).toBe(SIZE_MIN.h);
  });

  it('never leaves the viewport', () => {
    const up = resizeRect(START, 'n', 0, -5000);
    expect(up.top).toBeGreaterThanOrEqual(EDGE_MARGIN);
    const left = resizeRect(START, 'w', -5000, 0);
    expect(left.left).toBeGreaterThanOrEqual(EDGE_MARGIN);
    const right = resizeRect(START, 'e', 5000, 0);
    expect(right.left + right.width).toBeLessThanOrEqual(window.innerWidth - EDGE_MARGIN);
    const down = resizeRect(START, 's', 0, 5000);
    expect(down.top + down.height).toBeLessThanOrEqual(window.innerHeight - EDGE_MARGIN);
  });
});
