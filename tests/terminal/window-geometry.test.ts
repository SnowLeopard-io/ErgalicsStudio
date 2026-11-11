// ==========================================================================
// Regression tests for the terminal window geometry.
//
// The window behaves like a desktop window: dragging an edge moves THAT
// edge, the opposite one stays put, and the window can never leave the
// viewport. The old implementation assumed a docked window and inverted the
// directions as soon as the window was dragged somewhere else.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { resizeRect } from '@/components/terminal/TerminalPanel';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EDGE_MARGIN = 8;
const SIZE_MIN = { w: 360, h: 200 };
const VIEWPORT = { w: 1440, h: 900 };

const START: Rect = { left: 300, top: 200, width: 560, height: 340 };

describe('resizeRect — each edge moves its own side', () => {
  it('dragging the top edge up moves the TOP edge (bottom stays)', () => {
    const next = resizeRect(START, 'n', 0, -100, VIEWPORT);
    expect(next.top).toBe(100);
    expect(next.height).toBe(440);
    expect(next.left).toBe(START.left);
  });

  it('dragging the bottom edge down moves the BOTTOM edge', () => {
    const next = resizeRect(START, 's', 0, 60, VIEWPORT);
    expect(next.top).toBe(START.top);
    expect(next.height).toBe(400);
  });

  it('dragging the left edge left moves the LEFT edge (right stays)', () => {
    const next = resizeRect(START, 'w', -100, 0, VIEWPORT);
    expect(next.left).toBe(200);
    expect(next.width).toBe(660);
  });

  it('dragging the right edge right moves the RIGHT edge', () => {
    const next = resizeRect(START, 'e', 80, 0, VIEWPORT);
    expect(next.width).toBe(640);
    expect(next.left).toBe(START.left);
  });

  it('the corners combine both axes', () => {
    const next = resizeRect(START, 'nw', -50, -40, VIEWPORT);
    expect(next.left).toBe(250);
    expect(next.top).toBe(160);
    expect(next.width).toBe(610);
    expect(next.height).toBe(380);
  });

  it('the opposite corners work too', () => {
    const next = resizeRect(START, 'se', 30, 20, VIEWPORT);
    expect(next.left).toBe(START.left);
    expect(next.top).toBe(START.top);
    expect(next.width).toBe(590);
    expect(next.height).toBe(360);
  });
});

describe('resizeRect — the window stays usable', () => {
  it('never shrinks below the minimum size', () => {
    const next = resizeRect(START, 'e', -5000, 0, VIEWPORT);
    expect(next.width).toBe(SIZE_MIN.w);
    const tall = resizeRect(START, 's', 0, -5000, VIEWPORT);
    expect(tall.height).toBe(SIZE_MIN.h);
  });

  it('never leaves the viewport', () => {
    const up = resizeRect(START, 'n', 0, -5000, VIEWPORT);
    expect(up.top).toBeGreaterThanOrEqual(EDGE_MARGIN);
    const left = resizeRect(START, 'w', -5000, 0, VIEWPORT);
    expect(left.left).toBeGreaterThanOrEqual(EDGE_MARGIN);
    const right = resizeRect(START, 'e', 5000, 0, VIEWPORT);
    expect(right.left + right.width).toBeLessThanOrEqual(VIEWPORT.w - EDGE_MARGIN);
    const down = resizeRect(START, 's', 0, 5000, VIEWPORT);
    expect(down.top + down.height).toBeLessThanOrEqual(VIEWPORT.h - EDGE_MARGIN);
  });
});
