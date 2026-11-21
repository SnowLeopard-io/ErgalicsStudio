// ==========================================================================
// Ergalics Studio — floating touch keypad
//
// On keyboard-less touch screens the native soft keyboard is awkward to
// summon from numeric fields, so focusing a numeric/formula input raises a
// draggable on-screen pad instead. Desktop machines keep the hardware
// keyboard: the pad only mounts when the device reports no hover and a
// coarse pointer.
//
// Inputs opt in implicitly (`type="number"`, `inputMode="numeric|decimal"`)
// or explicitly (`data-touch-keypad` on plain text fields). The number /
// formula layout is switched by the user from the pad header and persists
// across fields. While the pad is up the field is read-only so the native
// keyboard does not fight it; the pad writes through the native value setter
// and fires `input`, so React controlled fields update like real typing.
// ==========================================================================

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

type Mode = 'number' | 'formula';

/** Keys as shown; insertion text may differ (see KEY_INPUT). */
const NUMBER_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
const FORMULA_KEYS = [
  '7', '8', '9', '⌫', 'C',
  '4', '5', '6', '×', '÷',
  '1', '2', '3', '+', '−',
  '(', ')', '.', '0', '^',
  '√', 'π', 'e', '%', ',',
  'sin', 'cos', 'tan', 'ln', 'x²',
];

/** Shown label → text inserted into the expression. */
const KEY_INPUT: Record<string, string> = {
  '×': '*',
  '÷': '/',
  '−': '-',
  '√': 'sqrt(',
  'π': 'pi',
  'x²': '^2',
  sin: 'sin(',
  cos: 'cos(',
  tan: 'tan(',
  ln: 'ln(',
};

const NUMBER_PATTERN = /^-?(\d+\.?\d*|\.\d*)?$/;

/** Panel widths used for viewport clamping. */
const PAD_WIDTH = 248;
const FORMULA_WIDTH = 300;

/** Activity-bar keyboard button asks the pad to show up. */
const TOGGLE_EVENT = 'ergalics:touch-keypad';

/** Open or dismiss the floating pad from anywhere (activity bar). */
export function toggleTouchKeypad(): void {
  window.dispatchEvent(new Event(TOGGLE_EVENT));
}

/** True only on touch-only screens (no mouse, no hover). */
function isTouchOnly(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** Whether a focused input is driven by the pad (layout is chosen separately). */
function eligible(element: HTMLInputElement): boolean {
  if (element.disabled) return false;
  const hint = element.dataset.touchKeypad;
  if (hint === 'off') return false;
  if (hint) return true;
  if (element.type === 'number') return true;
  const inputMode = element.inputMode || element.getAttribute('inputmode');
  return inputMode === 'numeric' || inputMode === 'decimal';
}

/** Write through React's value tracker so controlled inputs see the edit. */
function setNativeValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

interface SavedInputState {
  readOnly: boolean;
  inputMode: string | null;
}

export function TouchKeypad() {
  const [enabled] = useState(isTouchOnly);
  const [pinned, setPinned] = useState(false);
  const [target, setTarget] = useState<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Mode>('number');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const targetRef = useRef<HTMLInputElement | null>(null);
  const pinnedRef = useRef(false);
  const lastInputRef = useRef<HTMLInputElement | null>(null);
  const savedRef = useRef<{ element: HTMLInputElement; state: SavedInputState } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const movedRef = useRef(false);

  const restoreTarget = useCallback(() => {
    const saved = savedRef.current;
    if (saved) {
      saved.element.readOnly = saved.state.readOnly;
      if (saved.state.inputMode === null) saved.element.removeAttribute('inputmode');
      else saved.element.setAttribute('inputmode', saved.state.inputMode);
      delete saved.element.dataset.keypadActive;
      savedRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    restoreTarget();
    targetRef.current = null;
    setTarget(null);
  }, [restoreTarget]);

  /** 完成 button: close and stop manual/pinned mode. */
  const dismiss = useCallback(() => {
    pinnedRef.current = false;
    setPinned(false);
    close();
  }, [close]);

  /**
   * Suppress the native keyboard and wire the pad to this field. The layout
   * (number / formula) is the user's choice via the header switch, not a
   * property of the field, so switching fields keeps the current layout.
   */
  const attach = useCallback((element: HTMLInputElement) => {
    if (targetRef.current === element) return;
    restoreTarget();
    savedRef.current = {
      element,
      state: {
        readOnly: element.readOnly,
        inputMode: element.getAttribute('inputmode'),
      },
    };
    element.readOnly = true;
    element.setAttribute('inputmode', 'none');
    element.dataset.keypadActive = 'true';
    targetRef.current = element;
    setTarget(element);
    // Dock just under the field the first time; afterwards respect where the
    // user dragged the pad.
    if (movedRef.current) return;
    const rect = element.getBoundingClientRect();
    const width = FORMULA_WIDTH;
    const height = 380;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const top = below + height > window.innerHeight - 12 ? rect.top - height - 8 : below;
    setPos({ left, top: Math.max(12, top) });
  }, [restoreTarget]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement)) return;
      if (!eligible(element)) return;
      lastInputRef.current = element;
      if (!enabled && !pinnedRef.current) return;
      attach(element);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!targetRef.current) return;
      const path = event.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      // Tapping the field the pad is writing into must keep the pad open.
      if (path.includes(targetRef.current)) return;
      // A pinned pad stays until 完成; other fields simply take it over.
      if (pinnedRef.current) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    // Manual trigger from the activity bar: pin the pad, and bind it to the
    // focused field (or the last numeric field the user touched).
    const onToggle = () => {
      const next = !pinnedRef.current;
      pinnedRef.current = next;
      setPinned(next);
      if (!next) {
        close();
        return;
      }
      const focused = document.activeElement;
      const candidate = focused instanceof HTMLInputElement && eligible(focused)
        ? focused
        : lastInputRef.current;
      if (!candidate || !candidate.isConnected) return;
      if (!eligible(candidate)) return;
      candidate.focus({ preventScroll: true });
      attach(candidate);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      restoreTarget();
    };
  }, [enabled, attach, close, dismiss, restoreTarget]);

  const press = (key: string) => {
    const element = targetRef.current;
    if (!element || !element.isConnected) {
      close();
      return;
    }
    if (key === '⌫') {
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      const from = start === end ? Math.max(0, start - 1) : start;
      setNativeValue(element, element.value.slice(0, from) + element.value.slice(end));
      try {
        element.setSelectionRange(from, from);
      } catch {
        // Number inputs may not expose a selection API.
      }
      return;
    }
    if (key === 'C') {
      setNativeValue(element, '');
      return;
    }
    const insert = KEY_INPUT[key] ?? key;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = element.value.slice(0, start) + insert + element.value.slice(end);
    if (element.type === 'number' && !NUMBER_PATTERN.test(next)) return;
    setNativeValue(element, next);
    try {
      const caret = start + insert.length;
      element.setSelectionRange(caret, caret);
    } catch {
      // Number inputs may not expose a selection API.
    }
  };

  /**
   * Dragging writes `left/top` straight to the DOM (batched to animation
   * frames) instead of going through React state: re-rendering the pad on
   * every pointermove made the drag stutter on slower touch devices, and
   * React would have restored the old position mid-drag.
   */
  const dragRef = useRef<{
    dx: number;
    dy: number;
    left: number;
    top: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);

  const flushDrag = () => {
    rafRef.current = null;
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
    const left = Math.min(Math.max(0, drag.left), maxLeft);
    const top = Math.min(Math.max(0, drag.top), maxTop);
    drag.left = left;
    drag.top = top;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    if (Math.abs(left - drag.startLeft) > 2 || Math.abs(top - drag.startTop) > 2) drag.moved = true;
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The header also hosts the 完成 button: dragging must start on the bar
    // itself, otherwise pointer capture steals the button's click.
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    // Docked pads are placed by right/bottom; pin them by left/top so the
    // drag has a fixed origin and the box cannot stretch.
    panel.classList.remove('is-docked');
    panel.classList.add('is-dragging');
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      left: rect.left,
      top: rect.top,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.left = event.clientX - drag.dx;
    drag.top = event.clientY - drag.dy;
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushDrag);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flushDrag();
    dragRef.current = null;
    // Commit the final spot to React so the position survives re-renders.
    setPos({ left: drag.left, top: drag.top });
    movedRef.current = drag.moved;
    const panel = panelRef.current;
    panel?.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Switching layout changes the pad width; keep it inside the viewport.
  const switchMode = (layout: Mode) => {
    setMode(layout);
    setPos((current) => {
      if (!current) return current;
      const width = layout === 'formula' ? FORMULA_WIDTH : PAD_WIDTH;
      return { left: Math.min(current.left, window.innerWidth - width), top: current.top };
    });
  };

  if (!(enabled || pinned) || !(target || pinned)) return null;

  const keys = mode === 'formula' ? FORMULA_KEYS : NUMBER_KEYS;
  const columns = mode === 'formula' ? 5 : 3;
  return createPortal(
    <div
      ref={panelRef}
      className={`touch-keypad${pos ? '' : ' is-docked'}${mode === 'formula' ? ' is-formula' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      role="dialog"
      aria-label={mode === 'formula' ? '公式键盘' : '数字键盘'}
    >
      <div
        className="touch-keypad-head"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="touch-keypad-grip" aria-hidden="true" />
        <div className="touch-keypad-modes" role="group" aria-label="键盘布局">
          {(['number', 'formula'] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              className={`touch-keypad-mode${mode === layout ? ' is-active' : ''}`}
              aria-pressed={mode === layout}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => switchMode(layout)}
            >
              {layout === 'number' ? '数字' : '公式'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="touch-keypad-done"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={dismiss}
        >
          完成
        </button>
      </div>
      <div
        className="touch-keypad-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        onPointerDown={(event) => event.preventDefault()}
      >
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            className={`touch-keypad-key${
              /^[+\-−×÷^%().,√π]$/.test(key) ? ' is-op' : ''
            }${/^(sin|cos|tan|ln|x²|e)$/.test(key) ? ' is-fn' : ''}${
              key === '⌫' || key === 'C' ? ' is-util' : ''
            }`}
            disabled={!target}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
