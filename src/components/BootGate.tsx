// Boot gate: the outermost component of the app. While the readiness
// checklist (core/boot.ts) runs, the static `#boot` splash from index.html
// stays on screen and this component drives its progress bar + status text
// directly — the splash lives outside the React tree on purpose, so the
// pre-JS and post-JS visuals are literally the same DOM (no restyle flash).
// When ready, children render underneath and the splash fades out; on
// failure/timeout a small recovery UI offers retry / enter-anyway.
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import {
  BOOT_FADE_MS,
  installBootChunkRecovery,
  runBoot,
  type BootOutcome,
  type BootStep,
} from '@/core/boot';

type Phase = 'booting' | 'ready' | 'stuck';

/** Per-step progress values for the splash bar (percent). */
const STEP_PROGRESS: Record<BootStep, number> = { modules: 40, engine: 62, plugins: 88 };

function updateSplash(step: BootStep, label: string): void {
  const bar = document.getElementById('boot-bar');
  if (bar) {
    document.getElementById('boot')?.classList.remove('boot-indeterminate');
    bar.style.width = `${STEP_PROGRESS[step]}%`;
  }
  const status = document.getElementById('boot-status');
  if (status) status.textContent = label;
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('booting');
  const [outcome, setOutcome] = useState<BootOutcome>('ready');
  const [attempt, setAttempt] = useState(0);
  // True once the static splash has been torn down (stuck path) — a retry
  // then needs a React-rendered loading view instead of the splash DOM.
  const splashGone = useRef(false);

  useEffect(() => {
    installBootChunkRecovery();
  }, []);

  useEffect(() => {
    if (phase !== 'booting') return;
    let alive = true;

    void runBoot({
      onStep: (step) => {
        if (alive) updateSplash(step, t(`boot.status.${step}`));
      },
    }).then((result) => {
      if (!alive) return;
      if (result === 'ready') {
        // Render children underneath the splash first, then fade it away so
        // the reveal never shows a blank frame.
        setPhase('ready');
        window.setTimeout(() => {
          const splash = document.getElementById('boot');
          if (!splash) return;
          splash.classList.add('boot-done');
          window.setTimeout(() => splash.remove(), BOOT_FADE_MS);
        }, 250);
      } else {
        splashGone.current = true;
        document.getElementById('boot')?.remove();
        setOutcome(result);
        setPhase('stuck');
      }
    });

    return () => {
      alive = false;
    };
    // `t` is intentionally excluded: a locale switch during boot cannot
    // happen (the splash blocks all interaction) and re-running the boot on
    // identity churn would double-fire the checklist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt]);

  const retry = () => {
    setOutcome('ready');
    setPhase('booting');
    setAttempt((a) => a + 1);
  };

  if (phase === 'ready') return <>{children}</>;

  if (phase === 'stuck') {
    return (
      <div className="boot-fallback" role="alertdialog" aria-label={t('boot.fail.title')}>
        <div className="boot-fallback-card">
          <div className="boot-fallback-brand">ERGALICS <span>STUDIO</span></div>
          <h2 className="boot-fallback-title">{t('boot.fail.title')}</h2>
          <p className="boot-fallback-desc">
            {outcome === 'timeout' ? t('boot.fail.timeout_desc') : t('boot.fail.desc')}
          </p>
          <div className="boot-fallback-actions">
            <button type="button" className="btn btn-primary" onClick={retry}>
              {t('boot.fail.retry')}
            </button>
            <button type="button" className="btn" onClick={() => setPhase('ready')}>
              {t('boot.fail.enter')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Booting. The static splash normally covers this; after a retry (splash
  // already removed) show a minimal in-tree loading view instead.
  if (!splashGone.current) return null;
  return (
    <div className="boot-fallback" role="status" aria-label={t('boot.status.modules')}>
      <div className="boot-fallback-card">
        <div className="boot-fallback-brand">ERGALICS <span>STUDIO</span></div>
        <div className="boot-fallback-loading">
          <span className="spinner" />
          <span>{t('boot.status.modules')}</span>
        </div>
      </div>
    </div>
  );
}
