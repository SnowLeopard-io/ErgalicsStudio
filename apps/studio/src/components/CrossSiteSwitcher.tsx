import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { siteUrl, docsUrl } from '@/core/site-links';

/** How close (px) the pointer must get to the resting bead to wake the menu. */
const PROXIMITY_PX = 84;
/** Grace period so crossing the edge does not make the pill flicker. */
const CLOSE_DELAY_MS = 420;

/**
 * Persistent cross-site switcher, rendered once in the app shell so a user can
 * hop to the official website or the docs at any point while working, not just
 * on the welcome screen. Mirrors the floating switcher on the docs site so all
 * three properties look and behave the same. In production all three share one
 * origin (GitHub Pages); in dev they fall back to each workspace's fixed port.
 *
 * It now rests as a thin "puddle" merged into the bottom edge of the top bar
 * and only drops into the full pill while the pointer is near that bead (or
 * the menu itself is hovered / focused). Touch devices have no hover, so the
 * bead rests there too and a tap reveals the pill; a tap anywhere else tucks
 * it back behind the top bar.
 */
export function CrossSiteSwitcher() {
  const t = useT();
  const [awake, setAwake] = useState(false);
  const awakeRef = useRef(false);
  const navRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const puddleRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    const show = () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (awakeRef.current) return;
      awakeRef.current = true;
      setAwake(true);
    };

    const hideNow = () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (!awakeRef.current) return;
      awakeRef.current = false;
      setAwake(false);
    };

    const scheduleHide = () => {
      if (!awakeRef.current || closeTimer.current !== null) return;
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        awakeRef.current = false;
        setAwake(false);
      }, CLOSE_DELAY_MS);
    };

    // Tapping outside the open pill dismisses it — the touch equivalent of
    // the pointer moving away, which never happens without a hover pointer.
    const onPointerDown = (e: PointerEvent) => {
      if (!awakeRef.current) return;
      const target = e.target as Node;
      if (navRef.current?.contains(target) || puddleRef.current?.contains(target)) return;
      hideNow();
    };

    if (coarse) {
      window.addEventListener('pointerdown', onPointerDown);
      return () => {
        window.removeEventListener('pointerdown', onPointerDown);
        if (closeTimer.current !== null) {
          window.clearTimeout(closeTimer.current);
          closeTimer.current = null;
        }
      };
    }

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        // Proximity to the resting bead itself (not the whole status bar):
        // a fixed anchor avoids the radius shifting as the pill expands.
        const anchor = anchorRef.current;
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const distance = Math.hypot(e.clientX - r.left, e.clientY - r.top);
        const overNav = navRef.current?.contains(e.target as Node) ?? false;
        if (distance <= PROXIMITY_PX || overNav) show();
        else scheduleHide();
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', scheduleHide);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', scheduleHide);
      if (raf) window.cancelAnimationFrame(raf);
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, []);

  return (
    <>
      <span ref={anchorRef} className="csw-anchor" aria-hidden="true" />
      <button
        ref={puddleRef}
        type="button"
        className={`csw-puddle${awake ? ' is-hidden' : ''}`}
        aria-label={t('sites.label')}
        aria-expanded={awake}
        onClick={() => {
          if (awakeRef.current) return;
          awakeRef.current = true;
          setAwake(true);
        }}
      />
      <nav
        ref={navRef}
        className={`cross-site-switcher${awake ? ' is-awake' : ''}`}
        aria-label={t('sites.label')}
        onPointerEnter={() => {
          // Keep it awake while the pointer is actually on the pill.
          if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
          if (!awakeRef.current) {
            awakeRef.current = true;
            setAwake(true);
          }
        }}
        onFocus={() => {
          if (!awakeRef.current) {
            awakeRef.current = true;
            setAwake(true);
          }
        }}
      >
        <span className="csw-label">{t('sites.label')}</span>
        <a className="csw-link" href={siteUrl()} target="_blank" rel="noreferrer">
          {t('sites.website')}
        </a>
        <a className="csw-link" href={docsUrl()} target="_blank" rel="noreferrer">
          {t('sites.docs')}
        </a>
        <span className="csw-link is-current">{t('sites.studio')}</span>
      </nav>
    </>
  );
}
