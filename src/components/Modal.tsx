import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CloseIcon } from './icons';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Preferred width in px. The viewport width always wins (see `.modal`). */
  width?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Number of open modals that currently hold the body scroll lock. Restoring a
 * mount-time snapshot broke with stacked dialogs: closing the inner one wrote
 * back "hidden" (its own snapshot) and the page stayed frozen.
 */
let scrollLocks = 0;
let savedOverflow = '';

function lockScroll(): void {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

export function Modal({ open, title, onClose, children, footer, width }: ModalProps) {
  // Keep the handler in a ref so the effect below doesn't re-subscribe on
  // every parent render when `onClose` is an inline arrow (new identity).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Minimal focus trap: keep Tab cycling inside the dialog so keyboard /
      // assistive-tech users can't reach the page behind it.
      if (e.key !== 'Tab') return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const focusables = overlay.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === overlay) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || active === overlay) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while the dialog is open (ref-counted so stacked
    // dialogs release it only when the last one closes).
    lockScroll();
    // Move focus into the dialog.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // The size goes through custom properties so `.modal` can still cap it to
  // the viewport in CSS — inline `max-width` cannot be overridden by a media
  // query, so it made wide dialogs unusable on narrow screens.
  const sizeVars = width
    ? ({
        '--modal-width': `${width}px`,
        '--modal-min-width': `${width}px`,
        '--modal-max-width': `${width}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div ref={overlayRef} className="modal-overlay" onClick={() => onCloseRef.current()}>
      <div
        className="modal"
        style={sizeVars}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => onCloseRef.current()}>
            <CloseIcon size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}