import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItemDef {
  key: string;
  label: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Leading glyph. */
  icon?: ReactNode;
  /** Second line under the label (rich launchers). */
  description?: ReactNode;
  /** Trailing badge (e.g. "recent"). */
  badge?: ReactNode;
  /** Non-interactive group heading (filters out with its neighbours). */
  header?: boolean;
  /** Text matched by the filter box (label is often a ReactNode). */
  searchText?: string;
  onClick?: () => void;
}

interface DropdownProps {
  trigger: ReactNode;
  items: MenuItemDef[];
  align?: 'left' | 'right';
  className?: string;
  /** Class for the popup panel itself (rich launchers set their own width). */
  panelClassName?: string;
  ariaLabel?: string;
  /** Class applied to the trigger button (default: icon-btn). */
  triggerClassName?: string;
  /** Show a filter input at the top of the menu. */
  filterable?: boolean;
  filterPlaceholder?: string;
  /** Message shown when the filter matches no items. */
  emptyText?: string;
  /** Controlled open callback (used to reset transient state). */
  onOpenChange?: (open: boolean) => void;
}

/** True for rows that can receive keyboard focus / clicks. */
const isInteractive = (item: MenuItemDef): boolean =>
  item.key !== 'separator' && !item.header && !item.disabled;

export function Dropdown({
  trigger,
  items,
  align = 'right',
  className,
  panelClassName,
  ariaLabel,
  triggerClassName = 'icon-btn',
  filterable = false,
  filterPlaceholder,
  emptyText,
  onOpenChange,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setOpenBoth = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (next) {
      setQuery('');
      setActiveIndex(0);
    }
  };

  // Filtering: a group header stays visible only when at least one
  // interactive item after it (up to the next header) matches.
  const visibleItems = useMemo(() => {
    if (!filterable || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    const matches = (item: MenuItemDef) =>
      isInteractive(item) &&
      `${item.searchText ?? ''} ${typeof item.label === 'string' ? item.label : ''}`
        .toLowerCase()
        .includes(q);
    const result: MenuItemDef[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      if (item.key === 'separator') continue;
      if (item.header) {
        const rest = items.slice(i + 1).some((x) => !x.header && x.key !== 'separator' && matches(x));
        if (rest) result.push(item);
      } else if (matches(item)) {
        result.push(item);
      }
    }
    return result;
  }, [items, query, filterable]);

  const interactiveRows = useMemo(
    () => visibleItems.filter(isInteractive),
    [visibleItems],
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenBoth(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenBoth(false);
        return;
      }
      if (!filterable) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (interactiveRows.length === 0) return;
        setActiveIndex((prev) => {
          const row = interactiveRows[Math.min(prev, interactiveRows.length - 1)];
          const cur = Math.max(0, interactiveRows.findIndex((x) => x.key === row?.key));
          const next = e.key === 'ArrowDown'
            ? (cur + 1) % interactiveRows.length
            : (cur - 1 + interactiveRows.length) % interactiveRows.length;
          return next;
        });
      } else if (e.key === 'Enter') {
        const row = interactiveRows[activeIndex];
        if (row) {
          e.preventDefault();
          setOpenBoth(false);
          row.onClick?.();
        }
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    if (filterable) {
      // Focus the search input once the panel mounts.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filterable, interactiveRows, activeIndex]);

  const rowIndex = (item: MenuItemDef) => interactiveRows.findIndex((x) => x.key === item.key);

  // Fit the panel inside the viewport on BOTH axes. Pure CSS cannot know the
  // panel's actual top/right (top-bar height, trigger offset and zoom all
  // vary), so a tall/wide launcher used to overflow the window. Re-measures
  // from the natural CSS position every run (filtering changes content).
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // Clear previous inline adjustments, then read the natural position.
      panel.style.maxHeight = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.width = '';
      const rect = panel.getBoundingClientRect();
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Vertical: never run past the bottom edge (internal scroll otherwise).
      panel.style.maxHeight = `${Math.max(160, Math.floor(vh - rect.top - margin))}px`;

      // Horizontal: keep the whole panel within the viewport. `left`/`right`
      // are offsets from the natural CSS-anchored edge (.menu/.menu.left).
      if (align === 'left') {
        const overRight = rect.right - (vw - margin);
        if (overRight > 0) {
          const shiftedLeft = Math.max(margin, rect.left - overRight);
          if (shiftedLeft + rect.width <= vw - margin) {
            panel.style.left = `${Math.floor(shiftedLeft - rect.left)}px`;
          } else {
            panel.style.left = `${Math.floor(margin - rect.left)}px`;
            panel.style.width = `${Math.floor(vw - margin * 2)}px`;
          }
        }
      } else {
        const overLeft = margin - rect.left;
        if (overLeft > 0) {
          if (rect.right + overLeft <= vw - margin) {
            // Shift right by the overflow (negative `right` grows that way).
            panel.style.right = `${-Math.floor(overLeft)}px`;
          } else {
            // Viewport narrower than the panel: anchor to the right inset and
            // shrink the width instead.
            panel.style.right = `${Math.floor(rect.right - (vw - margin))}px`;
            panel.style.width = `${Math.floor(vw - margin * 2)}px`;
          }
        }
      }
    };
    // rAF: measure after the panel mounts and the open animation settles.
    // Ancestor coordinates can still move after open (route-stage transform,
    // async project hydration reflowing the top-bar, late web fonts), so
    // re-fit several times; each run is idempotent and layout-cheap.
    const raf = requestAnimationFrame(fit);
    const t1 = window.setTimeout(fit, 130);
    const t2 = window.setTimeout(fit, 360);
    let fontsCancelled = false;
    document.fonts?.ready.then(() => {
      if (!fontsCancelled) fit();
    }).catch(() => {});
    window.addEventListener('resize', fit);
    return () => {
      fontsCancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', fit);
    };
  }, [open, align, visibleItems.length]);

  return (
    <div className="menu-wrap" ref={ref} aria-label={ariaLabel}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenBoth(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`menu ${align === 'left' ? 'left' : ''} ${panelClassName ?? ''} ${className ?? ''}`}
          role="menu"
        >
          {filterable && (
            <div className="menu-filter">
              <input
                ref={searchRef}
                type="search"
                className="input menu-filter-input"
                value={query}
                placeholder={filterPlaceholder}
                aria-label={filterPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
              />
            </div>
          )}
          {visibleItems.length === 0 && filterable && (
            <div className="menu-empty">{emptyText ?? filterPlaceholder ?? ''}</div>
          )}
          {visibleItems.map((item, i) => {
            if (item.key === 'separator') {
              return <div key={i} className="menu-separator" />;
            }
            if (item.header) {
              return (
                <div key={item.key} className="menu-group-label">
                  {item.label}
                </div>
              );
            }
            const kbdIndex = rowIndex(item);
            const rich = item.icon || item.description || item.badge;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={[
                  'menu-item',
                  rich ? 'menu-item-rich' : '',
                  item.active ? 'active' : '',
                  filterable && kbdIndex === activeIndex ? 'menu-item-kbd' : '',
                ].join(' ').trim()}
                disabled={item.disabled}
                onMouseEnter={() => filterable && setActiveIndex(Math.max(0, kbdIndex))}
                onClick={() => {
                  setOpenBoth(false);
                  item.onClick?.();
                }}
              >
                {rich ? (
                  <>
                    {item.icon && <span className="menu-item-icon">{item.icon}</span>}
                    <span className="menu-item-text">
                      <span className="menu-item-label">{item.label}</span>
                      {item.description && (
                        <span className="menu-item-desc">{item.description}</span>
                      )}
                    </span>
                    {item.badge && <span className="menu-item-badge">{item.badge}</span>}
                  </>
                ) : (
                  item.label
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
