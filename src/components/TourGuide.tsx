// Ergalics Studio — guided tour overlay (新手引导)
//
// Two flows share one overlay:
//
//   1. 'debut' — the first-run 30-second story: load a real sample dataset,
//      land on the composed publication figure, generate a caption, save the
//      SVG/PDF/PNG bundle. This is the product's strongest memory hook, so it
//      comes first and is skippable.
//   2. 'ui' — the classic region-by-region walkthrough (top bar, activity bar,
//      sidebar, canvas, parameters, status bar, tools) that ends by running
//      the truss-bridge sample.
//
// "view" steps advance with a Next button; "click" steps make the user
// physically click the highlighted control (a capture-phase document listener
// advances when the click lands inside it). The overlay layer is
// pointer-events:none; only the tooltip card captures clicks, so the real UI
// under the spotlight stays fully interactive.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useTourStore, type TourFlow } from '@/stores/tourStore';
import { useAppStore } from '@/stores/appStore';
import { beginDebut } from '@/core/debut';

type StepMode = 'intro' | 'view' | 'click' | 'done';

interface TourStepDef {
  mode: StepMode;
  /** CSS selector of the element to highlight; required for view/click. */
  selector?: string;
  titleKey: string;
  bodyKey: string;
}

/** Entry chooser: the two parts of onboarding, on equal footing. */
const MENU_STEPS: TourStepDef[] = [
  {
    mode: 'intro',
    titleKey: 'tour.menu_title',
    bodyKey: 'tour.menu_body',
  },
];

/** 30-second first-run flow: data → figure → caption → files. */
const DEBUT_STEPS: TourStepDef[] = [
  {
    mode: 'intro',
    titleKey: 'tour.debut_intro_title',
    bodyKey: 'tour.debut_intro_body',
  },
  {
    mode: 'view',
    selector: '[data-tour="figure-preview"]',
    titleKey: 'tour.debut_figure_title',
    bodyKey: 'tour.debut_figure_body',
  },
  {
    mode: 'click',
    selector: '[data-tour="figure-caption"]',
    titleKey: 'tour.debut_caption_title',
    bodyKey: 'tour.debut_caption_body',
  },
  {
    mode: 'click',
    selector: '[data-tour="caption-apply"]',
    titleKey: 'tour.debut_caption_apply_title',
    bodyKey: 'tour.debut_caption_apply_body',
  },
  {
    mode: 'click',
    selector: '[data-tour="figure-save-ws"]',
    titleKey: 'tour.debut_save_title',
    bodyKey: 'tour.debut_save_body',
  },
  {
    mode: 'done',
    titleKey: 'tour.debut_done_title',
    bodyKey: 'tour.debut_done_body',
  },
];

/** Region-by-region workbench walkthrough (the original tour). */
const UI_STEPS: TourStepDef[] = [
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
    // Engineering (disciplineOf('example.structure')), so switching categories
    // is a required intermediate click.
    selector: '[data-example-cat="engineering"]',
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

const FLOWS: Record<TourFlow, TourStepDef[]> = {
  menu: MENU_STEPS,
  debut: DEBUT_STEPS,
  ui: UI_STEPS,
};

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
  const navigate = useNavigate();
  const active = useTourStore((s) => s.active);
  const flow = useTourStore((s) => s.flow);
  const step = useTourStore((s) => s.step);
  const next = useTourStore((s) => s.next);
  const finish = useTourStore((s) => s.finish);
  const start = useTourStore((s) => s.start);
  const [rect, setRect] = useState<Rect | null>(null);
  const [launching, setLaunching] = useState(false);

  const steps = FLOWS[flow];
  const stepIndex = Math.min(step, steps.length - 1);
  // stepIndex is clamped to the last step, so the lookup always lands; the
  // fallback just satisfies noUncheckedIndexedAccess.
  const def = steps[stepIndex] ?? steps[steps.length - 1]!;
  const isLast = def.mode === 'done';
  const finished = step >= steps.length;

  const advance = useCallback(() => (isLast ? finish(true) : next()), [isLast, finish, next]);

  // Walked past the final step (e.g. clicked the last highlighted element
  // right as the tour ended) — treat as completion.
  useEffect(() => {
    if (active && finished) finish(true);
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

  const launchDebut = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    const result = await beginDebut();
    if (!result.ok) {
      setLaunching(false);
      useAppStore.getState().notify('error', t('tour.debut_failed'));
      return;
    }
    navigate('/studio/figures');
    // Start the tour on the composed figure step; the intro already happened.
    useTourStore.getState().startAt('debut', 1);
    setLaunching(false);
  }, [launching, navigate, t]);

  /** The UI walkthrough only makes sense on the workbench, so bring the user
   *  back there before switching flows (the debut ends on /studio/figures). */
  const startUi = useCallback(
    (step = 0) => {
      navigate('/workbench');
      start('ui', step);
    },
    [navigate, start],
  );

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
  const isMenu = flow === 'menu' && def.mode === 'intro';
  const isDebutIntro = flow === 'debut' && def.mode === 'intro';
  const isDebutDone = flow === 'debut' && def.mode === 'done';

  const renderActions = () => {
    if (isMenu) {
      return (
        <button type="button" className="btn btn-sm" onClick={() => finish()}>
          {t('tour.skip')}
        </button>
      );
    }
    if (isDebutIntro) {
      return (
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void launchDebut()}
            disabled={launching}
          >
            {launching ? t('tour.debut_loading') : t('tour.debut_start')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => finish()}>
            {t('tour.skip')}
          </button>
        </>
      );
    }
    if (def.mode === 'intro') {
      return (
        <button type="button" className="btn btn-sm" onClick={() => finish()}>
          {t('tour.skip')}
        </button>
      );
    }
    if (def.mode === 'done') {
      return (
        <>
          <button type="button" className="btn btn-sm" onClick={() => start('menu')}>
            {t('tour.menu_back')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => finish(true)}
          >
            {t('tour.finish')}
          </button>
        </>
      );
    }
    if (def.mode === 'click') {
      return (
        <button type="button" className="btn btn-sm" onClick={() => finish()}>
          {t('tour.skip')}
        </button>
      );
    }
    return (
      <>
        <button type="button" className="btn btn-sm btn-primary" onClick={next}>
          {t('tour.next')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => finish()}>
          {t('tour.skip')}
        </button>
      </>
    );
  };

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
              {stepIndex + 1} / {steps.length}
            </span>
          )}
        </div>
        <p className={`tour-tip-body${def.mode === 'intro' ? ' tour-intro-body' : ''}`}>
          {t(def.bodyKey)}
        </p>
        {isMenu && (
          <div className="tour-menu-grid">
            <button type="button" className="tour-menu-card" onClick={() => startUi()}>
              <span className="tour-menu-badge">{t('tour.menu_ui_badge')}</span>
              <span className="tour-menu-name">{t('tour.menu_ui_title')}</span>
              <span className="tour-menu-desc">{t('tour.menu_ui_desc')}</span>
            </button>
            <button
              type="button"
              className="tour-menu-card"
              onClick={() => start('debut')}
              disabled={launching}
            >
              <span className="tour-menu-badge">{t('tour.menu_workflow_badge')}</span>
              <span className="tour-menu-name">{t('tour.menu_workflow_title')}</span>
              <span className="tour-menu-desc">{t('tour.menu_workflow_desc')}</span>
            </button>
          </div>
        )}
        {isDebutDone && (
          <div className="tour-result-card">
            <span className="tour-result-seal" aria-hidden="true">
              ◇
            </span>
            <span className="tour-result-copy">
              <span className="tour-result-title">{t('tour.debut_result_title')}</span>
              <span className="tour-result-meta">{t('tour.debut_result_meta')}</span>
            </span>
          </div>
        )}
        {def.mode === 'click' && <div className="tour-tip-hint">{t('tour.click_hint')}</div>}
        {!hero && (
          <div className="tour-dots" aria-hidden="true">
            {Array.from({ length: steps.length }, (_, i) => (
              <span key={i} className={`tour-dot${i === stepIndex ? ' is-active' : ''}`} />
            ))}
          </div>
        )}
        <div className="tour-tip-actions">{renderActions()}</div>
      </div>
    </div>
  );
}
