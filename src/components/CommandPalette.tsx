// ==========================================================================
// Ergalics Studio — global command palette (Ctrl+K)
//
// Fuzzy-searchable launcher over every research tool, work mode and common
// action, available on any route. Navigation/actions are plain closures so
// the palette stays a dumb list renderer; the registry is RESEARCH_TOOLS +
// a small fixed action table (labels resolved through i18n).
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { RESEARCH_TOOLS } from '@/pages/research/toolRegistry';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTourStore } from '@/stores/tourStore';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import type { WorkbenchMode } from '@/types/editor';

type CommandGroup = 'tools' | 'modes' | 'actions' | 'panel' | 'nav';

interface PaletteCommand {
  id: string;
  group: CommandGroup;
  label: string;
  /** Extra searchable tokens (route ids, mode keys, english hints). */
  keywords?: string;
  /** Right-aligned hint (e.g. keyboard shortcut). */
  hint?: string;
  run: () => void;
}

const MODES: WorkbenchMode[] = ['standard', 'flow', 'block', 'code'];

/** Subsequence fuzzy match: every query char appears in order. Returns a
 *  score (lower = better) or -1 when the query is not a subsequence. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -1;
  for (let si = 0; si < s.length && qi < q.length; si += 1) {
    if (s[si] === q[qi]) {
      // Prefer consecutive matches (small gap penalty) and word starts.
      score += si - last - 1 + (si === 0 || s[si - 1] === ' ' ? -2 : 0);
      last = si;
      qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

const GROUP_ORDER: CommandGroup[] = ['tools', 'modes', 'actions', 'panel', 'nav'];

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global toggle: Ctrl/Cmd+K from anywhere; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus + reset on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Defer so the input exists after the conditional render.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc handled at the overlay (so the palette can close before the AI panel's
  // own Esc handler runs — overlay mounts above it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    for (const tool of RESEARCH_TOOLS) {
      list.push({
        id: `tool:${tool.id}`,
        group: 'tools',
        label: t(tool.titleKey),
        keywords: tool.id,
        run: () => navigate(tool.path),
      });
    }
    for (const mode of MODES) {
      list.push({
        id: `mode:${mode}`,
        group: 'modes',
        label: t(`workbench.mode.${mode}`),
        keywords: mode,
        hint: 'Mode',
        run: () => useAppStore.getState().setMode(mode),
      });
    }
    list.push(
      {
        id: 'save',
        group: 'actions',
        label: t('common.save'),
        hint: 'Ctrl+S',
        run: () => {
          void useProjectStore.getState().save();
        },
      },
      {
        id: 'settings',
        group: 'actions',
        label: t('workbench.tools.settings'),
        run: () => navigate('/settings'),
      },
      {
        id: 'tour',
        group: 'actions',
        label: t('workbench.tour.title'),
        run: () => useTourStore.getState().start(),
      },
      {
        id: 'shortcuts',
        group: 'actions',
        label: t('ux.shortcuts.title'),
        keywords: 'shortcuts keyboard keys help 快捷键',
        hint: '?',
        run: () => useShortcutsStore.getState().toggle(),
      },
      {
        id: 'ai',
        group: 'actions',
        label: t('ai.toggle'),
        run: () => useAiPanelStore.getState().toggle(),
      },
      {
        id: 'sidebar',
        group: 'panel',
        label: t('workbench.menu.toggle_sidebar'),
        run: () => useAppStore.getState().toggleSidebar(),
      },
      {
        id: 'right',
        group: 'panel',
        label: t('workbench.menu.toggle_right'),
        run: () => useAppStore.getState().toggleRightPanel(),
      },
      {
        id: 'workbench',
        group: 'nav',
        label: t('ux.nav.workbench'),
        keywords: 'workbench studio',
        run: () => navigate('/workbench'),
      },
      {
        id: 'welcome',
        group: 'nav',
        label: t('ux.nav.welcome'),
        keywords: 'home start',
        run: () => navigate('/'),
      },
    );
    return list;
  }, [t, navigate]);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, `${c.label} ${c.keywords ?? ''}`) }))
      .filter((x): x is { c: PaletteCommand; score: number } => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.c.label.localeCompare(b.c.label));
    return scored.map((x) => x.c);
  }, [commands, query]);

  // Keep the highlighted row in view when navigating with the keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runCommand = (cmd: PaletteCommand) => {
    setOpen(false);
    cmd.run();
  };

  if (!open) return null;

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: results.filter((c) => c.group === g),
  })).filter((g) => g.items.length > 0);

  const groupLabel = (g: CommandGroup): string =>
    g === 'tools'
      ? t('ux.palette.groups.tools')
      : g === 'modes'
        ? t('ux.palette.groups.modes')
        : g === 'actions'
          ? t('ux.palette.groups.actions')
          : g === 'panel'
            ? t('ux.palette.group.panel')
            : t('ux.palette.group.nav');

  return (
    <div
      className="palette-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="palette" role="dialog" aria-modal="false" aria-label={t('ux.palette.title')}>
        <div className="palette-input-row">
          <span className="palette-search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder={t('ux.palette.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = results[active];
                if (cmd) runCommand(cmd);
              }
            }}
          />
          <kbd className="palette-kbd">Ctrl K</kbd>
        </div>

        <div className="palette-results" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">{t('ux.palette.empty')}</div>}
          {grouped.map((g) => (
            <div key={g.group} className="palette-group">
              <div className="palette-group-label">{groupLabel(g.group)}</div>
              {g.items.map((cmd) => {
                const index = results.indexOf(cmd);
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`palette-item${index === active ? ' is-active' : ''}`}
                    data-active={index === active}
                    onPointerMove={() => setActive(index)}
                    onClick={() => runCommand(cmd)}
                  >
                    <span className="palette-item-label">{cmd.label}</span>
                    {cmd.hint && <span className="palette-item-hint">{cmd.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
