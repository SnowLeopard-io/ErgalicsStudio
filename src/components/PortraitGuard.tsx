import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { isPortraitViewport } from '@/core/orientation';

/**
 * Blocking "rotate your device" overlay — the third and weakest layer of the
 * forced-landscape strategy (see core/orientation.ts). Engines that reject or
 * lack screen.orientation.lock() (iOS Safari, most embedded webviews) still
 * need portrait refused somehow, so a full-screen guard stands in for the
 * lock they would not honour.
 *
 * Only touch-class devices are guarded: a portrait-shaped desktop window is a
 * legitimate workspace, not a phone. The component fails open — no matchMedia
 * means no overlay, never a locked-out desktop.
 */
export function PortraitGuard() {
  const t = useT();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let touch = false;
    try {
      touch =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
    } catch {
      touch = false;
    }
    if (!touch) return;

    const sync = () => setBlocked(isPortraitViewport(window.innerWidth, window.innerHeight));
    sync();

    const screenOrientation = typeof screen !== 'undefined' ? screen.orientation : undefined;
    screenOrientation?.addEventListener?.('change', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      screenOrientation?.removeEventListener?.('change', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  if (!blocked) return null;

  return (
    <div
      className="portrait-guard"
      role="alertdialog"
      aria-modal="true"
      aria-label={t('ux.orientation.title')}
    >
      <div className="portrait-guard-card">
        <span className="portrait-guard-glyph" aria-hidden="true">
          ⟳
        </span>
        <p className="portrait-guard-title">{t('ux.orientation.title')}</p>
        <p className="portrait-guard-hint">{t('ux.orientation.hint')}</p>
      </div>
    </div>
  );
}
