import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';

type WithLeaving<T> = T & { leaving: boolean };

/**
 * Mirrors a store-backed list so items can play an exit animation before they
 * are actually unmounted. When an item disappears from `storeItems` we keep it
 * in local state flagged `leaving` and remove it after `duration` ms — which
 * covers BOTH user-initiated dismiss and the store's own auto-dismiss timer.
 * A timeout fallback guarantees removal even under `prefers-reduced-motion`
 * (where the CSS animation duration is ~0 and `animationend` would never fire).
 */
function useAnimatedItems<T extends { id: number }>(
  storeItems: T[],
  duration = 240,
): WithLeaving<T>[] {
  const [items, setItems] = useState<WithLeaving<T>[]>(() =>
    storeItems.map((i) => ({ ...i, leaving: false })),
  );
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const storeIds = new Set(storeItems.map((i) => i.id));
    setItems((prev) => {
      const prevIds = new Set(prev.map((i) => i.id));
      const next: WithLeaving<T>[] = [];
      for (const p of prev) {
        // Still in the store: keep as-is (drop a stale leaving flag if it
        // somehow reappeared). Gone from the store: mark leaving so it animates out.
        if (storeIds.has(p.id)) next.push(p.leaving ? { ...p, leaving: false } : p);
        else if (!p.leaving) next.push({ ...p, leaving: true });
        else next.push(p);
      }
      // Brand-new store items that aren't rendered yet.
      for (const s of storeItems) {
        if (!prevIds.has(s.id)) next.push({ ...s, leaving: false });
      }
      return next;
    });
  }, [storeItems]);

  useEffect(() => {
    for (const it of items) {
      if (it.leaving) scheduleRemoval(it.id);
    }
    // scheduleRemoval is stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function scheduleRemoval(id: number) {
    if (timers.current.has(id)) return;
    const t = window.setTimeout(() => {
      timers.current.delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, duration);
    timers.current.set(id, t);
  }

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => window.clearTimeout(t));
      map.clear();
    };
  }, []);

  return items;
}

export function BannerStack() {
  const banners = useAppStore((s) => s.banners);
  const removeBanner = useAppStore((s) => s.removeBanner);
  const registry = usePluginStore((s) => s.registry);
  const t = useT();
  const items = useAnimatedItems(banners);

  if (items.length === 0) return null;

  const pluginName = (id?: string) => {
    if (!id) return '';
    return registry.find((e) => e.id === id)?.name ?? id;
  };

  return (
    <div className="banner-stack">
      {items.map((b) => (
        <div
          key={b.id}
          className={`banner banner-${b.kind} ${b.leaving ? 'leaving' : ''}`}
          role="alert"
        >
          <span>
            {t(b.messageKey)}
            {b.pluginId ? ` · ${pluginName(b.pluginId)}` : ''}
          </span>
          {b.dismissible && (
            <div className="banner-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => removeBanner(b.id)}
              >
                {t('common.close')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ToastStack() {
  const notifications = useAppStore((s) => s.notifications);
  const dismiss = useAppStore((s) => s.dismissNotification);
  const items = useAnimatedItems(notifications);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack">
      {items.map((n) => (
        <div
          key={n.id}
          className={`toast toast-${n.kind} ${n.leaving ? 'leaving' : ''}`}
          onClick={() => dismiss(n.id)}
        >
          {n.message}
          {n.action && (
            <button
              type="button"
              className="toast-action"
              onClick={(e) => {
                // The action must not ALSO dismiss through the container's
                // onClick; run it, then dismiss explicitly.
                e.stopPropagation();
                const action = n.action;
                if (!action) return;
                try {
                  action.run();
                } finally {
                  dismiss(n.id);
                }
              }}
            >
              {n.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
