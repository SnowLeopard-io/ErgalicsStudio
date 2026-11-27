// ==========================================================================
// Ergalics Studio — terminal window geometry (pure maths)
//
// The terminal window behaves like a desktop window: dragging an edge moves
// THAT edge (the opposite one stays put), the corners combine both axes, and
// the window can never leave the viewport. Keeping the maths here (instead
// of inside the panel component) makes it unit-testable.
// ==========================================================================

/** Floating-window bounds for the resize grips (min px / max × viewport). */
export const SIZE_MIN = { w: 360, h: 200 };
export const SIZE_MAX = { w: 0.9, h: 0.85 };
export const SIZE_DEFAULT = { w: 560, h: 340 };
/** Margin kept from the screen edges while dragging (never dragged off-screen). */
export const EDGE_MARGIN = 8;

/**
 * Resize handles, named after the edges/corners they move — the same
 * convention Windows uses: `n` = top edge, `nw` = top-left corner, …
 */
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The window rectangle in viewport coordinates. */
export interface WindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The default rectangle: docked above the status bar, on the right.
 * The window is a plain rectangle everywhere else — every edge and corner
 * can be dragged, exactly like a desktop window.
 */
export function defaultRect(): WindowRect {
  const width = Math.min(SIZE_DEFAULT.w, window.innerWidth - 2 * EDGE_MARGIN);
  const height = Math.min(SIZE_DEFAULT.h, window.innerHeight - 2 * EDGE_MARGIN);
  return {
    left: Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
    top: Math.max(EDGE_MARGIN, window.innerHeight - height - 42),
    width,
    height,
  };
}

/** Keep a rectangle fully inside the viewport. */
export function clampRect(rect: WindowRect): WindowRect {
  const maxW = Math.max(
    SIZE_MIN.w,
    Math.min(window.innerWidth - 2 * EDGE_MARGIN, window.innerWidth * SIZE_MAX.w),
  );
  const maxH = Math.max(
    SIZE_MIN.h,
    Math.min(window.innerHeight - 2 * EDGE_MARGIN, window.innerHeight * SIZE_MAX.h),
  );
  const width = Math.min(Math.max(rect.width, Math.min(SIZE_MIN.w, maxW)), maxW);
  const height = Math.min(Math.max(rect.height, Math.min(SIZE_MIN.h, maxH)), maxH);
  const left = Math.min(
    Math.max(rect.left, EDGE_MARGIN),
    Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
  );
  const top = Math.min(
    Math.max(rect.top, EDGE_MARGIN),
    Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN),
  );
  return { left, top, width, height };
}

/**
 * Resize a rectangle by dragging one edge or corner. The edges behave the
 * way a desktop window does: dragging the top edge moves the TOP edge (the
 * bottom stays put), dragging the left edge moves the LEFT edge, and the
 * corners combine both.
 *
 * The viewport size is a parameter so the maths stays pure (and testable).
 */
export function resizeRect(
  start: WindowRect,
  dir: ResizeDir,
  dx: number,
  dy: number,
  viewport: { w: number; h: number },
): WindowRect {
  const minW = Math.min(SIZE_MIN.w, viewport.w - 2 * EDGE_MARGIN);
  const minH = Math.min(SIZE_MIN.h, viewport.h - 2 * EDGE_MARGIN);
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;

  if (dir.includes('n')) {
    top = Math.min(Math.max(start.top + dy, EDGE_MARGIN), bottom - minH);
  }
  if (dir.includes('s')) {
    bottom = Math.max(
      Math.min(start.top + start.height + dy, viewport.h - EDGE_MARGIN),
      top + minH,
    );
  }
  if (dir.includes('w')) {
    left = Math.min(Math.max(start.left + dx, EDGE_MARGIN), right - minW);
  }
  if (dir.includes('e')) {
    right = Math.max(
      Math.min(start.left + start.width + dx, viewport.w - EDGE_MARGIN),
      left + minW,
    );
  }
  return { left, top, width: right - left, height: bottom - top };
}
