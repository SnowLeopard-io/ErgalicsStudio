import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItemDef {
  key: string;
  label: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface DropdownProps {
  trigger: ReactNode;
  items: MenuItemDef[];
  align?: 'left' | 'right';
  className?: string;
  ariaLabel?: string;
}

export function Dropdown({ trigger, items, align = 'right', className, ariaLabel }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref} aria-label={ariaLabel}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu ${align === 'left' ? 'left' : ''} ${className ?? ''}`} role="menu">
          {items.map((item, i) =>
            item.key === 'separator' ? (
              <div key={i} className="menu-separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`menu-item ${item.active ? 'active' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}