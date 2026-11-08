// Ambience UI layer — mounted once in AppShell. Renders, in order:
//  1. floating "+N XP" hints anchored below the top bar
//  2. badge unlock cards (queued, one at a time)
//  3. the level-up overlay (with a one-shot particle burst)
// Everything is pointer-transparent except the level-up overlay, and every
// piece auto-dismisses: the ambience layer never blocks the workbench.

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import {
  useAmbienceStore,
} from '@/stores/ambienceStore';
import { BADGES, badgeUiImage, levelFromXp, rankKeyForLevel } from '@/core/ambience/model';
import { on, RUN_COMPLETED } from '@/core/events';
import { revealCanvasGrowth, useDaypart } from '@/core/ambience/vitality';

const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/** One-shot canvas particle burst (theme-colored, ~1.6s, then stops). */
function CelebrationBurst() {
  const burstId = useAmbienceStore((s) => s.burstId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!burstId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--color-accent').trim() || '#2dd4bf';
    const accentSoft = styles.getPropertyValue('--color-accent-text').trim() || accent;

    // Spawn from the top-center (near the XP indicator) rising slowly.
    const cx = window.innerWidth / 2;
    const originY = 64;
    const particles = Array.from({ length: 42 }, () => ({
      x: cx + (Math.random() - 0.5) * 160,
      y: originY + Math.random() * 20,
      vx: (Math.random() - 0.5) * 90,
      vy: -40 - Math.random() * 70,
      size: 1.5 + Math.random() * 2.5,
      life: 1.4 + Math.random() * 0.4,
      color: Math.random() > 0.5 ? accent : accentSoft,
    }));

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 24 * dt; // gentle gravity
        const alpha = Math.max(0, 1 - elapsed / p.life);
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (elapsed < 2) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burstId]);

  return (
    <canvas
      ref={canvasRef}
      className="ambience-burst"
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** Queued badge unlock cards — each shows for 4.5s. */
function BadgeToasts() {
  const t = useT();
  const queue = useAmbienceStore((s) => s.badgeQueue);
  const dequeue = useAmbienceStore((s) => s.dequeueBadge);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => dequeue(current), 4500);
    return () => window.clearTimeout(timer);
  }, [current, dequeue]);

  if (!current) return null;
  const badge = BADGE_BY_ID.get(current);
  if (!badge) return null;

  return (
    <div className="badge-toast" role="status" aria-live="polite" key={current}>
      <img className="badge-toast-img" src={badgeUiImage(current)} alt="" aria-hidden="true" />
      <div className="badge-toast-body">
        <span className="badge-toast-eyebrow">{t('ambience.badge_unlocked')}</span>
        <span className="badge-toast-name">{t(badge.nameKey)}</span>
        <span className="badge-toast-desc">{t(badge.descKey)}</span>
      </div>
    </div>
  );
}

/** Level-up overlay: one card, click-anywhere to dismiss, auto after 10s. */
function LevelUpOverlay() {
  const t = useT();
  const levelUp = useAmbienceStore((s) => s.levelUp);
  const dismiss = useAmbienceStore((s) => s.dismissLevelUp);

  useEffect(() => {
    if (!levelUp) return;
    const timer = window.setTimeout(dismiss, 10_000);
    return () => window.clearTimeout(timer);
  }, [levelUp, dismiss]);

  if (!levelUp) return null;
  return (
    <div
      className="levelup-overlay"
      role="dialog"
      aria-label={t('ambience.levelup.title')}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') dismiss();
      }}
    >
      <div className="levelup-card" onClick={(e) => e.stopPropagation()}>
        <span className="levelup-eyebrow">{t('ambience.levelup.title')}</span>
        <span className="levelup-level">Lv.{levelUp.level}</span>
        <span className="levelup-rank">{t(levelUp.rankKey)}</span>
        <p className="levelup-body">
          {t('ambience.levelup.body', { rank: t(levelUp.rankKey), level: levelUp.level })}
        </p>
        <button type="button" className="btn btn-primary levelup-btn" onClick={dismiss}>
          {t('ambience.levelup.dismiss')}
        </button>
      </div>
    </div>
  );
}

/** Floating "+N" hints — rendered fixed below the top bar, right-aligned. */
function XpFloats() {
  const floats = useAmbienceStore((s) => s.floats);
  if (floats.length === 0) return null;
  return (
    <div className="xp-float-stack" aria-hidden="true">
      {floats.map((f) => (
        <span key={f.id} className="xp-float">+{f.amount}</span>
      ))}
    </div>
  );
}

/**
 * XP indicator: level badge + progress rail + detail block.
 *
 * - `popover` (default): top-bar form — details float below on hover.
 * - `inline`: settings-panel form — details sit in normal flow under the rail.
 *   The two use distinct detail class names rather than a descendant override
 *   of the absolutely-positioned popover, so the panel layout can never fall
 *   back to escaping its card (overlapping the content below it).
 */
export function XpIndicator({ variant = 'popover' }: { variant?: 'popover' | 'inline' }) {
  const t = useT();
  const rewardsEnabled = useAmbienceStore((s) => s.settings.rewardsEnabled);
  const xp = useAmbienceStore((s) => s.progress.xp);
  const streak = useAmbienceStore((s) => s.progress.streak);
  if (!rewardsEnabled) return null;
  const { level, into, span } = levelFromXp(xp);
  const pct = Math.min(100, Math.round((into / span) * 100));
  const rank = rankKeyForLevel(level);
  const inline = variant === 'inline';

  return (
    <div
      className={`xp-indicator${inline ? ' xp-indicator-inline' : ''}`}
      title={`${t('ambience.level')} ${level} · ${t(rank)}`}
    >
      {/* Badge + rail live in their own row so the panel variant can stack
          the detail block below instead of squeezing it beside the rail. */}
      <span className="xp-track">
        <span className="xp-level-badge">{level}</span>
        <span
          className="xp-rail"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={span}
          aria-valuenow={into}
          aria-label={`${t('ambience.level')} ${level}: ${into}/${span}`}
        >
          <span className="xp-rail-fill" style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span
        className={inline ? 'xp-detail-inline' : 'xp-detail'}
        aria-hidden={inline ? undefined : 'true'}
      >
        <span className="xp-detail-row">{`${t('ambience.level')} ${level} · ${t(rank)}`}</span>
        <span className="xp-detail-row xp-detail-muted">
          {t('ambience.level_next', { xp: span - into })}
        </span>
        {streak > 1 && (
          <span className="xp-detail-row xp-detail-muted">{t('ambience.streak_days', { days: streak })}</span>
        )}
      </span>
    </div>
  );
}

/** Time-of-day ambience: mirrors the local daypart onto <html data-daypart>
 *  so CSS can shift the welcome-page glow (and future ambient surfaces)
 *  between dawn/day/dusk/night tones. Re-evaluates every 5 minutes. */
function DaypartSync() {
  const daypart = useDaypart();
  useEffect(() => {
    document.documentElement.dataset.daypart = daypart;
    return () => {
      delete document.documentElement.dataset.daypart;
    };
  }, [daypart]);
  return null;
}

/** Growth reveal: when a computation completes, the shared plugin canvas
 *  sweeps in left-to-right once — the chart appears to "grow" instead of
 *  popping. One-shot, gated by the motion setting. */
function GrowthReveal() {
  useEffect(() => {
    const sub = on(RUN_COMPLETED, () => {
      const canvas = document.querySelector<HTMLElement>('.central-canvas');
      revealCanvasGrowth(canvas);
    });
    return () => sub.unsubscribe();
  }, []);
  return null;
}

export function AmbienceLayer() {
  return (
    <>
      <CelebrationBurst />
      <XpFloats />
      <BadgeToasts />
      <LevelUpOverlay />
      <DaypartSync />
      <GrowthReveal />
    </>
  );
}
