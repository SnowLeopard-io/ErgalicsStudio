// ==========================================================================
// Ambience engine — one-time bootstrap that wires the ambience system to the
// rest of the app: event-bus XP hooks, plugin usage tracking, the daily
// login/streak award and the first-visit sound hint.
//
// Called fire-and-forget from main.tsx. Every subscription failure is caught:
// ambience must never block or break the workbench.
// ==========================================================================

import { on, RUN_COMPLETED, DATA_INGESTED, NOTEBOOK_EXECUTED, FIGURE_EXPORTED } from '@/core/events';
import { installInteractionSounds, playCue, setAmbientTheme } from '@/core/ambience/audio';
import { useAmbienceStore } from '@/stores/ambienceStore';
import { getResolvedTheme } from '@/theme';
import { logger } from '@/core/logger';

let initialized = false;

/** Local YYYY-MM-DD for the streak calculation. */
function localDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function daysBetween(a: string, b: string): number | null {
  if (!a || !b) return null;
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86_400_000);
}

function handleDailyLogin(): void {
  const store = useAmbienceStore.getState();
  const today = localDate();
  if (store.progress.lastActiveDate === today) return;
  const gap = daysBetween(store.progress.lastActiveDate, today);
  setAmbientTheme(getResolvedTheme() === 'dark');
  useAmbienceStore.setState((s) => ({
    progress: {
      ...s.progress,
      lastActiveDate: today,
      // Consecutive day → streak grows; a gap resets it. First visit starts it.
      streak: gap === 1 ? s.progress.streak + 1 : gap === null && !s.progress.lastActiveDate ? 1 : gap === null ? s.progress.streak : 1,
    },
  }));
  // Streak bonus caps at 30 days (spec: +5/day, capped).
  const streak = useAmbienceStore.getState().progress.streak;
  store.awardXp('daily_login');
  if (streak > 1 && streak <= 30) store.awardXp('streak_bonus');
  store.checkBadges();
}

export function initAmbienceEngine(): void {
  if (initialized) return;
  initialized = true;
  installInteractionSounds();

  try {
    handleDailyLogin();
  } catch (err) {
    logger.error('ambience', 'daily login award failed', err);
  }

  // First-visit hint: surface that sounds exist, exactly once ever.
  const ambience = useAmbienceStore.getState();
  if (ambience.settings.soundEnabled && !ambience.progress.flags.soundHintShown) {
    useAmbienceStore.setState((s) => ({
      progress: { ...s.progress, flags: { ...s.progress.flags, soundHintShown: true } },
    }));
    void import('@/stores/appStore').then(({ useAppStore }) => {
      void import('@/i18n').then(({ t }) => {
        useAppStore.getState().notify('info', t('ambience.sound_hint'));
      });
    });
  }

  // ---- event-bus XP hooks --------------------------------------------------

  on<{ run: { failed?: boolean; source: string; inputFileIds: unknown[] } }>(RUN_COMPLETED, ({ run }) => {
    const store = useAmbienceStore.getState();
    const failed = Boolean(run.failed);
    store.awardXp(failed ? 'run_failed_attempt' : 'run_completed');
    if (!failed) playCue('success');
    // Track distinct run sources (drives the "panorama" badge).
    if (!store.progress.runSources.includes(run.source)) {
      useAmbienceStore.setState((s) => ({
        progress: {
          ...s.progress,
          runSources: [...s.progress.runSources, run.source],
          counters: { ...s.progress.counters, runs: s.progress.counters.runs + 1 },
        },
      }));
    } else {
      useAmbienceStore.setState((s) => ({
        progress: {
          ...s.progress,
          counters: { ...s.progress.counters, runs: s.progress.counters.runs + 1 },
        },
      }));
    }
    useAmbienceStore.getState().checkBadges({
      lastRun: {
        source: run.source,
        usedInputFiles: Array.isArray(run.inputFileIds) && run.inputFileIds.length > 0,
        hour: new Date().getHours(),
      },
    });
  });

  on<unknown>(DATA_INGESTED, () => {
    const store = useAmbienceStore.getState();
    store.awardXp('data_ingested');
    useAmbienceStore.setState((s) => ({
      progress: {
        ...s.progress,
        counters: { ...s.progress.counters, ingests: s.progress.counters.ingests + 1 },
      },
    }));
    useAmbienceStore.getState().checkBadges();
  });

  on<{ ok?: boolean }>(NOTEBOOK_EXECUTED, ({ ok }) => {
    if (ok === false) return;
    useAmbienceStore.getState().awardXp('notebook_executed');
  });

  on<unknown>(FIGURE_EXPORTED, () => {
    useAmbienceStore.getState().awardXp('figure_exported');
    useAmbienceStore.getState().checkBadges();
  });

  // ---- plugin usage tracking -------------------------------------------------

  // Watch the plugin store for activations; the first activation of each
  // plugin earns XP and plays the "open" cue. Lazy import avoids any cycle.
  void import('@/stores/pluginStore')
    .then(({ usePluginStore }) => {
      let lastActiveId: string | null = null;
      usePluginStore.subscribe((state) => {
        const id = state.activeId;
        if (!id || id === lastActiveId) return;
        lastActiveId = id;
        const store = useAmbienceStore.getState();
        if (!store.progress.usedPlugins.includes(id)) {
          useAmbienceStore.setState((s) => ({
            progress: { ...s.progress, usedPlugins: [...s.progress.usedPlugins, id] },
          }));
          store.awardXp('plugin_first_use');
          useAmbienceStore.getState().checkBadges();
        } else {
          playCue('open');
        }
      });
    })
    .catch((err) => logger.error('ambience', 'plugin tracking failed', err));

  // Theme changes re-tune the ambient pad's timbre.
  try {
    const observer = new MutationObserver(() => {
      setAmbientTheme(getResolvedTheme() === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch {
    /* MutationObserver unavailable — pad simply keeps its initial timbre */
  }
}
