// Ergalics Studio — ambience vitality helpers
//
// Small, restrained "alive" touches shared across the UI: time-of-day
// ambience (dawn/day/dusk/night) and the one-shot growth reveal that plays on
// the shared plugin canvas when a computation finishes. Everything here
// respects the ambience motion setting and prefers-reduced-motion.

import { useEffect, useState } from 'react';
import { useAmbienceStore } from '@/stores/ambienceStore';

export type Daypart = 'dawn' | 'day' | 'dusk' | 'night';

/** Map the local hour to an ambience daypart (5–10 dawn, 10–17 day,
 *  17–21 dusk, otherwise night). */
export function currentDaypart(date = new Date()): Daypart {
  const h = date.getHours();
  if (h >= 5 && h < 10) return 'dawn';
  if (h >= 10 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'dusk';
  return 'night';
}

/** Subscribe the component tree to the current daypart; re-evaluates every
 *  5 minutes so long sessions drift from morning to evening naturally. */
export function useDaypart(): Daypart {
  const [daypart, setDaypart] = useState<Daypart>(() => currentDaypart());
  useEffect(() => {
    const update = () => setDaypart(currentDaypart());
    const timer = window.setInterval(update, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  return daypart;
}

export function motionAllowsAnimation(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return useAmbienceStore.getState().settings.motion === 'full';
}

/** One-shot "growth" reveal: sweeps a left-to-right clip over the element so
 *  a freshly drawn chart appears to grow in. Uses the Web Animations API and
 *  cleans up after itself; a no-op when motion is reduced. */
export function revealCanvasGrowth(el: HTMLElement | null, durationMs = 750): void {
  if (!el || !motionAllowsAnimation()) return;
  try {
    const anim = el.animate(
      [
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0 0 0)' },
      ],
      { duration: durationMs, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    anim.onfinish = () => {
      try {
        el.style.clipPath = '';
      } catch {
        /* element gone */
      }
    };
  } catch {
    /* WAAPI unavailable — the chart simply appears */
  }
}
