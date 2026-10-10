// Ergalics Studio — guided tour overlay (新手引导)
//
// A spotlight tour in two phases:
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

import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '@/i18n';
import { useTourStore } from '@/stores/tourStore';
import { useAppStore } from '@/stores/appStore';

type StepMode = 'menu' | 'intro' | 'welcome' | 'view' | 'click';

/** The competition tracks one judge-track card routes to. `atom` shares the
 *  full product tour with `ai` (the project itself competes in both), so it
 *  has no steps of its own. */
type TrackId = 'ai' | 'em' | 'fluid' | 'atom';

interface TourStepDef {
  mode: StepMode;
  /** CSS selector of the element to highlight; required for view/click. */
  selector?: string;
  titleKey: string;
  bodyKey: string;
  /** Which judge track this step belongs to (menus have none). */
  track?: TrackId;
  /** Terminal step of its track — advancing here ends the tour. */
  last?: boolean;
  /**
   * Precondition already satisfied — the step auto-advances instead of
   * demanding a click that would toggle state away (e.g. clicking the
   * already-active activity-bar view collapses the sidebar).
   */
  skipWhen?: () => boolean;
  /** Menu variant: audience chooser (step 0) or the judge track chooser. */
  menu?: 'audience' | 'tracks';
  /** Where the "back" button of an intro/done step returns to. */
  backTo?: number;
}

// Step 0 is the audience chooser (judge vs regular user); step 1 is the
// judge track chooser. Each card jumps into that route's own step sequence
// via `goto`; every route ends on a `last` step, so advancing past it ends
// the tour instead of leaking into the next route's steps.
//   ai / atom — shared full product tour (project itself in both competitions,
//               identical to what a regular user gets)
//   em        — 商飞赛题: open the EM eigensolver plugin, press Run (one solve)
//   fluid     — 商飞赛题: open the fluid coupler plugin, press Run All
const STEPS: TourStepDef[] = [
  {
    mode: 'menu',
    menu: 'audience',
    titleKey: 'tour.hello_title',
    bodyKey: 'tour.hello_hint',
  },
  {
    mode: 'menu',
    menu: 'tracks',
    titleKey: 'tour.menu_title',
    bodyKey: 'tour.menu_hint',
  },
  // ---- Shared route · 项目本体（AI 工具赛道 / 开放原子赛道 / 普通用户） ----
  {
    mode: 'intro',
    track: 'ai',
    backTo: 1,
    titleKey: 'tour.intro_ai_title',
    bodyKey: 'tour.intro_ai_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.topbar',
    titleKey: 'tour.topbar_title',
    bodyKey: 'tour.topbar_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.activity-bar',
    titleKey: 'tour.activity_title',
    bodyKey: 'tour.activity_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.sidebar',
    titleKey: 'tour.sidebar_title',
    bodyKey: 'tour.sidebar_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.central-plugin-host',
    titleKey: 'tour.canvas_title',
    bodyKey: 'tour.canvas_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.right-panel',
    titleKey: 'tour.params_title',
    bodyKey: 'tour.params_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '.statusbar',
    titleKey: 'tour.status_title',
    bodyKey: 'tour.status_body',
  },
  {
    mode: 'view',
    track: 'ai',
    selector: '[data-tour="ai-assistant"]',
    titleKey: 'tour.tools_title',
    bodyKey: 'tour.tools_body',
  },
  {
    mode: 'click',
    track: 'ai',
    selector: '[data-tour="examples"]',
    titleKey: 'tour.examples_title',
    bodyKey: 'tour.examples_body',
  },
  {
    mode: 'click',
    track: 'ai',
    // The library opens on its first category — the truss sample lives under
    // Physics, so switching categories is a required intermediate click.
    selector: '[data-example-cat="physics"]',
    titleKey: 'tour.cat_title',
    bodyKey: 'tour.cat_body',
  },
  {
    mode: 'click',
    track: 'ai',
    // The structure card sits low in the dialog list — the scroll effect
    // below keeps bringing it into view until it is clearly visible.
    selector: '[data-example-id="structure-truss-bridge"] .plugin-card-actions .btn',
    titleKey: 'tour.load_title',
    bodyKey: 'tour.load_body',
  },
  {
    mode: 'click',
    track: 'ai',
    selector: '[data-param-key="run"]',
    titleKey: 'tour.run_title',
    bodyKey: 'tour.run_body',
  },
  {
    mode: 'welcome',
    track: 'ai',
    last: true,
    backTo: 0,
    titleKey: 'tour.done_title',
    bodyKey: 'tour.done_body',
  },
  // ---- Track em · 商飞赛题「面向电磁谐振与微波器件仿真的高效、稳定求解方案」 ----
  {
    mode: 'intro',
    track: 'em',
    backTo: 1,
    titleKey: 'tour.intro_em_title',
    bodyKey: 'tour.intro_em_body',
  },
  {
    mode: 'click',
    track: 'em',
    // One merged step: switch the sidebar to the plugin list, then find the
    // solver in the Competition Solvers group. If the sidebar is already on
    // the plugin view it auto-advances — clicking the active view would
    // collapse the sidebar instead.
    selector: '[data-activity="plugins"]',
    skipWhen: () =>
      useAppStore.getState().sidebarView === 'plugins' &&
      !!useAppStore.getState().sidebarOpen,
    titleKey: 'tour.nav_plugins_title',
    bodyKey: 'tour.nav_plugins_body',
  },
  {
    mode: 'click',
    track: 'em',
    selector: '[data-plugin-id="example.em-eigensolver"]',
    titleKey: 'tour.em_open_title',
    bodyKey: 'tour.em_open_body',
  },
  {
    mode: 'click',
    track: 'em',
    selector: '[data-param-key="run"]',
    titleKey: 'tour.em_run_title',
    bodyKey: 'tour.em_run_body',
  },
  {
    mode: 'welcome',
    track: 'em',
    last: true,
    backTo: 1,
    titleKey: 'tour.done_title',
    bodyKey: 'tour.done_body',
  },
  // ---- Track fluid · 商飞赛题「一三维耦合求解时间步长协调和边界耦合」 ----
  {
    mode: 'intro',
    track: 'fluid',
    backTo: 1,
    titleKey: 'tour.intro_fluid_title',
    bodyKey: 'tour.intro_fluid_body',
  },
  {
    mode: 'click',
    track: 'fluid',
    // Same merged step as the EM route.
    selector: '[data-activity="plugins"]',
    skipWhen: () =>
      useAppStore.getState().sidebarView === 'plugins' &&
      !!useAppStore.getState().sidebarOpen,
    titleKey: 'tour.nav_plugins_title',
    bodyKey: 'tour.nav_plugins_body',
  },
  {
    mode: 'click',
    track: 'fluid',
    selector: '[data-plugin-id="example.fluid-cfd-coupler"]',
    titleKey: 'tour.fluid_open_title',
    bodyKey: 'tour.fluid_open_body',
  },
  {
    mode: 'click',
    track: 'fluid',
    // "Run All (Verify + Coupling)" — the one-click full demo of this plugin.
    selector: '[data-param-key="runAll"]',
    titleKey: 'tour.fluid_run_title',
    bodyKey: 'tour.fluid_run_body',
  },
  {
    mode: 'welcome',
    track: 'fluid',
    last: true,
    backTo: 1,
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
  const goto = useTourStore((s) => s.goto);
  const finish = useTourStore((s) => s.finish);
  const [rect, setRect] = useState<Rect | null>(null);

  const stepIndex = Math.min(step, STEPS.length - 1);
  // stepIndex is clamped to the last step, so the lookup always lands; the
  // fallback just satisfies noUncheckedIndexedAccess.
  const def = STEPS[stepIndex] ?? STEPS[STEPS.length - 1]!;
  // Progress is counted *within the current track* — the four tracks are
  // separate step sequences laid out flat in STEPS.
  const trackStart = STEPS.findIndex((s) => s.track === def.track);
  const trackLen = STEPS.filter((s) => s.track === def.track).length;
  const isLast = !!def.last;
  const finished = step >= STEPS.length;

  /** Advance: past a track's terminal step the tour ends — never leak into
   *  the next track's steps in the flat array. */
  const advance = () => (isLast ? finish() : next());

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

  // Steps whose precondition is already satisfied auto-advance after a short
  // beat — demanding the click anyway would toggle state away (clicking the
  // already-active activity-bar view collapses the sidebar). Re-evaluated
  // whenever the sidebar state changes so the condition is checked live.
  const sidebarView = useAppStore((s) => s.sidebarView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  useEffect(() => {
    if (!active || finished || !def.skipWhen) return;
    if (def.skipWhen()) {
      const timer = window.setTimeout(() => next(), 400);
      return () => window.clearTimeout(timer);
    }
  }, [active, finished, def, next, sidebarView, sidebarOpen]);

  if (!active || finished) return null;

  // Tooltip placement: centered when there is no target (welcome/done) or the
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

  const hero = !rect; // menu / intro / done steps (or target not yet mounted)

  // Menu card definitions: audience chooser and judge track chooser. Route
  // targets are resolved from STEPS so indices never drift out of sync.
  const aiStart = STEPS.findIndex((s) => s.track === 'ai');
  const emStart = STEPS.findIndex((s) => s.track === 'em');
  const fluidStart = STEPS.findIndex((s) => s.track === 'fluid');
  const audienceCards = [
    { key: 'judge', titleKey: 'tour.hello_judge_title', descKey: 'tour.hello_judge_desc', target: 1 },
    { key: 'user', titleKey: 'tour.hello_user_title', descKey: 'tour.hello_user_desc', target: aiStart },
  ] as const;
  const trackCards = [
    { key: 'ai', badgeKey: 'tour.menu_ai_badge', titleKey: 'tour.menu_ai_title', descKey: 'tour.menu_ai_desc', target: aiStart },
    { key: 'em', badgeKey: 'tour.menu_em_badge', titleKey: 'tour.menu_em_title', descKey: 'tour.menu_em_desc', target: emStart },
    { key: 'fluid', badgeKey: 'tour.menu_fluid_badge', titleKey: 'tour.menu_fluid_title', descKey: 'tour.menu_fluid_desc', target: fluidStart },
    // The OpenAtom track shares the project's full product tour.
    { key: 'atom', badgeKey: 'tour.menu_atom_badge', titleKey: 'tour.menu_atom_title', descKey: 'tour.menu_atom_desc', target: aiStart },
  ] as const;
  const menuCards = def.menu === 'audience' ? audienceCards : trackCards;

  // Progress dots for the current track (view/click/done steps only).
  const trackStep = def.track ? stepIndex - trackStart : -1;

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
          {def.track && !hero && (
            <span className="tour-tip-count">
              {stepIndex - trackStart + 1} / {trackLen}
            </span>
          )}
        </div>
        {def.mode === 'menu' ? (
          // Chooser page: one big clickable card per audience / judge track.
          <>
            <p className="tour-tip-body">{t(def.bodyKey)}</p>
            <div className={`tour-menu-grid${def.menu === 'audience' ? ' is-audience' : ''}`}>
              {menuCards.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  className="tour-menu-card"
                  onClick={() => goto(card.target)}
                >
                  {'badgeKey' in card && (
                    <span className="tour-menu-badge">{t(card.badgeKey)}</span>
                  )}
                  <span className="tour-menu-name">{t(card.titleKey)}</span>
                  <span className="tour-menu-desc">{t(card.descKey)}</span>
                </button>
              ))}
            </div>
          </>
        ) : def.mode === 'intro' ? (
          // Track briefing: background, technical highlights and the demo
          // route — newlines render as separate lines (pre-line).
          <p className="tour-tip-body tour-intro-body">{t(def.bodyKey)}</p>
        ) : (
          <p className="tour-tip-body">{t(def.bodyKey)}</p>
        )}
        {def.mode === 'click' && !isLast && (
          <div className="tour-tip-hint">{t('tour.click_hint')}</div>
        )}
        {def.track && !hero && trackLen > 1 && (
          <div className="tour-dots" aria-hidden="true">
            {Array.from({ length: trackLen }, (_, i) => (
              <span key={i} className={`tour-dot${i === trackStep ? ' is-active' : ''}`} />
            ))}
          </div>
        )}
        <div className="tour-tip-actions">
          {def.mode === 'menu' ? (
            <button type="button" className="btn btn-sm" onClick={finish}>
              {t('tour.skip')}
            </button>
          ) : def.mode === 'intro' ? (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={next}>
                {t('tour.begin')}
              </button>
              <button type="button" className="btn btn-sm" onClick={finish}>
                {t('tour.skip')}
              </button>
            </>
          ) : isLast ? (
            <>
              {def.backTo !== undefined && (
                <button type="button" className="btn btn-sm" onClick={() => goto(def.backTo!)}>
                  {t('tour.back')}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-primary" onClick={finish}>
                {t('tour.finish')}
              </button>
            </>
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
