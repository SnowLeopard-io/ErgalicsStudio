// Ergalics Studio — guided tour overlay (新手引导)
//
// A single basic product tour, in two phases:
//   1. "view" steps introduce every region of the workbench (top bar, activity
//      bar, sidebar, canvas tab strip, parameter panel, status bar, global
//      tools / AI assistant) — advanced with a Next button.
//   2. "click" steps make the user physically run the first sample: open the
//      examples dialog, load the structure sample (auto-scrolled into view),
//      press Run. A capture-phase document listener advances when the click
//      lands inside the highlighted target.
//
// The overlay layer is pointer-events:none; only the tooltip card captures
// clicks, so the real UI under the spotlight stays fully interactive.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useT } from '@/i18n';
import { useTourStore } from '@/stores/tourStore';

type StepMode = 'intro' | 'view' | 'click' | 'done';

interface TourStepDef {
  mode: StepMode;
  /** CSS selector of the element to highlight; required for view/click. */
  selector?: string;
  titleKey: string;
  bodyKey: string;
}

const STEPS: TourStepDef[] = [
  {
    mode: 'intro',
    titleKey: 'tour.intro_ai_title',
    bodyKey: 'tour.intro_ai_body',
  },
  {
    mode: 'view',
    selector: '.topbar',
    titleKey: 'tour.topbar_title',
    bodyKey: 'tour.topbar_body',
  },
  {
    mode: 'view',
    selector: '.activity-bar',
    titleKey: 'tour.activity_title',
    bodyKey: 'tour.activity_body',
  },
  {
    mode: 'view',
    selector: '.sidebar',
    titleKey: 'tour.sidebar_title',
    bodyKey: 'tour.sidebar_body',
  },
  {
    mode: 'view',
    selector: '.central-plugin-host',
    titleKey: 'tour.canvas_title',
    bodyKey: 'tour.canvas_body',
  },
  {
    mode: 'view',
    selector: '.right-panel',
    titleKey: 'tour.params_title',
    bodyKey: 'tour.params_body',
  },
  {
    mode: 'view',
    selector: '.statusbar',
    titleKey: 'tour.status_title',
    bodyKey: 'tour.status_body',
  },
  {
    mode: 'view',
    selector: '[data-tour="ai-assistant"]',
    titleKey: 'tour.tools_title',
    bodyKey: 'tour.tools_body',
  },
  {
    mode: 'click',
    selector: '[data-tour="examples"]',
    titleKey: 'tour.examples_title',
    bodyKey: 'tour.examples_body',
  },
  {
    mode: 'click',
    // The library opens on its first category — the truss sample lives under
    // Physics, so switching categories is a required intermediate click.
    selector: '[data-example-cat="physics"]',
    titleKey: 'tour.cat_title',
    bodyKey: 'tour.cat_body',
  },
  {
    mode: 'click',
    // The structure card sits low in the dialog list — the scroll effect
    // below keeps bringing it into view until it is clearly visible.
    selector: '[data-example-id="structure-truss-bridge"] .plugin-card-actions .btn',
    titleKey: 'tour.load_title',
    bodyKey: 'tour.load_body',
  },
  {
    mode: 'click',
    selector: '[data-param-key="run"]',
    titleKey: 'tour.run_title',
    bodyKey: 'tour.run_body',
  },
  {
    mode: 'done',
    titleKey: 'tour.done_title',
    bodyKey: 'tour.done_body',
  },
];

const TIP_WIDTH = 320;
/** How much of the target must sit inside the viewport to stop scrolling. */
const VISIBILITY_THRESHOLD = 0.85;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourGuide() {
  const t = useT();
  const active = useTourStore((s) => s.active);
  const step = useTourStore((s) => s.step);
  const next = useTourStore((s) => s.next);
  const finish = useTourStore((s) => s.finish);
  const [rect, setRect] = useState<Rect | null>(null);

  const stepIndex = Math.min(step, STEPS.length - 1);
  // stepIndex is clamped to the last step, so the lookup always lands; the
  // fallback just satisfies noUncheckedIndexedAccess.
  const def = STEPS[stepIndex] ?? STEPS[STEPS.length - 1]!;
  const isLast = def.mode === 'done';
  const finished = step >= STEPS.length;

  const advance = useCallback(() => (isLast ? finish() : next()), [isLast, finish, next]);

  // Walked past the final step (e.g. clicked the last highlighted element
  // right as the tour ended) — treat as completion.
  useEffect(() => {
    if (active && finished) finish();
  }, [active, finished, finish]);

  // Track the highlighted element's position: an interval re-reads the rect
  // so the spotlight follows dialog animations and layout shifts; a scroll
  // (capture — any scrollable ancestor) and resize listener keep it exact.
  useEffect(() => {
    if (!active || finished) return;
    const update = () => {
      if (!def.selector) {
        setRect(null);
        return;
      }
      const el = document.querySelector(def.selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Tall/oversized targets (e.g. the scrollable sidebar) must not push the
      // spotlight ring outside the window — clamp it to the viewport.
      const top = Math.max(r.top, 6);
      const left = Math.max(r.left, 6);
      const right = Math.min(r.right, window.innerWidth - 6);
      const bottom = Math.min(r.bottom, window.innerHeight - 6);
      setRect(
        right - left > 0 && bottom - top > 0
          ? { top, left, width: right - left, height: bottom - top }
          : null,
      );
    };
    update();
    const interval = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, finished, def]);

  // Keep the current target in view. The examples dialog animates in and the
  // structure card sits below the fold, so a single scrollIntoView is not
  // enough: retry until the target is (mostly) visible or the budget runs out.
  useEffect(() => {
    if (!active || finished || !def.selector) return;
    let tries = 0;
    const tick = () => {
      tries += 1;
      const el = document.querySelector(def.selector!);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      const visibleFrac = (bottom - top) / Math.max(1, r.height);
      if (visibleFrac < VISIBILITY_THRESHOLD) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    tick();
    const interval = window.setInterval(tick, 350);
    const stop = window.setTimeout(() => window.clearInterval(interval), 4000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [active, finished, def]);

  // The core "guide by clicking" mechanic (click steps only): a capture-phase
  // click listener advances the tour when the user clicks the highlighted
  // element. Clicks elsewhere leave the tour waiting — the tooltip's skip
  // button is always available.
  useEffect(() => {
    if (!active || finished || def.mode !== 'click' || !def.selector) return;
    const onDocClick = (e: MouseEvent) => {
      const el = document.querySelector(def.selector!);
      if (el && e.composedPath().includes(el)) advance();
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
    // `advance` follows def/isLast; re-subscribing on step change is intended.
  }, [active, finished, def, advance]);

  // Escape exits the tour.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);

  if (!active || finished) return null;

  // Tooltip placement: centered when there is no target (intro/done) or the
  // target is momentarily missing; otherwise docked under/over the spotlight.
  let tipStyle: CSSProperties | undefined;
  if (rect) {
    const tipH = 200; // approximate card height for above/below decision
    const below = rect.top + rect.height + 12 + tipH < window.innerHeight;
    const top = below
      ? rect.top + rect.height + 12
      : Math.max(12, rect.top - 12 - tipH);
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - TIP_WIDTH / 2),
      Math.max(12, window.innerWidth - TIP_WIDTH - 12),
    );
    tipStyle = { top, left, width: TIP_WIDTH };
  }

  const hero = !rect;

  return (
    <div className="tour-layer" role="dialog" aria-label={t('workbench.tour.title')}>
      {hero && <div className="tour-backdrop" />}
      {rect && (
        <div
          className="tour-spot"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div
        className={`tour-tip${hero ? ' tour-tip-center tour-tip-hero' : ''}`}
        style={tipStyle}
      >
        <div className="tour-tip-head">
          <span className="tour-tip-title">{t(def.titleKey)}</span>
          {!hero && (
            <span className="tour-tip-count">
              {stepIndex + 1} / {STEPS.length}
            </span>
          )}
        </div>
        <p className={`tour-tip-body${def.mode === 'intro' ? ' tour-intro-body' : ''}`}>
          {t(def.bodyKey)}
        </p>
        {def.mode === 'click' && <div className="tour-tip-hint">{t('tour.click_hint')}</div>}
        {!hero && (
          <div className="tour-dots" aria-hidden="true">
            {Array.from({ length: STEPS.length }, (_, i) => (
              <span key={i} className={`tour-dot${i === stepIndex ? ' is-active' : ''}`} />
            ))}
          </div>
        )}
        <div className="tour-tip-actions">
          {def.mode === 'intro' ? (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={next}>
                {t('tour.begin')}
              </button>
              <button type="button" className="btn btn-sm" onClick={finish}>
                {t('tour.skip')}
              </button>
            </>
          ) : def.mode === 'done' ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={finish}>
              {t('tour.finish')}
            </button>
          ) : def.mode === 'click' ? (
            <button type="button" className="btn btn-sm" onClick={finish}>
              {t('tour.skip')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={next}>
                {t('tour.next')}
              </button>
              <button type="button" className="btn btn-sm" onClick={finish}>
                {t('tour.skip')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
