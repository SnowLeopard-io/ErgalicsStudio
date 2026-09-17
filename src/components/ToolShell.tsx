// ==========================================================================
// Ergalics Studio — ToolShell: shared layout for every /studio/<tool> page
//
// One skeleton for all research tools (UI design guide §2):
//   header  ← back to workbench · tool icon + name · global tools
//   body    the tool's own content (centered column, page scroll)
//   footer  the shared StatusBar (GPU/WASM/storage + FPS)
//
// Tools opt into project gating in the registry (requireProject); the
// /studio route renders <EmptyProject> instead of the tool body until a
// project is active.
// ==========================================================================

import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { StatusBar } from '@/pages/workbench/StatusBar';
import { ToolIcon, ArrowLeftIcon, SettingsIcon } from './icons';
import { recordTool } from '@/core/recentTools';
import { getTool } from '@/pages/research/toolRegistry';

interface ToolShellProps {
  /** Registry id (also the /studio/<id> slug). */
  toolId: string;
  /** Override the title (defaults to the registry titleKey). */
  title?: string;
  /** Controls rendered to the right of the title (e.g. sheet selector). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function ToolShell({ toolId, title, headerExtra, children }: ToolShellProps) {
  const t = useT();
  const navigate = useNavigate();
  const toolDef = getTool(toolId);
  const resolvedTitle = title ?? (toolDef ? t(toolDef.titleKey) : toolId);

  // Visiting a tool counts as "using" it — feeds the launcher recency list.
  useEffect(() => {
    recordTool(toolId);
  }, [toolId]);

  return (
    <div className="tool-shell">
      <header className="tool-topbar">
        <div className="tool-topbar-main">
          <button
            type="button"
            className="btn btn-sm tool-back"
            onClick={() => navigate('/workbench')}
          >
            <ArrowLeftIcon size={14} /> {t('figure.back')}
          </button>
          <span className="tool-title-icon" aria-hidden="true">
            {toolDef ? <ToolIcon kind={toolDef.icon} size={18} /> : null}
          </span>
          <h1 className="tool-title">{resolvedTitle}</h1>
          {headerExtra && <div className="tool-topbar-extra">{headerExtra}</div>}
        </div>
        <div className="tool-topbar-actions topbar-actions">
          <button
            type="button"
            className="cluster-btn icon-only"
            title={t('workbench.tools.settings')}
            aria-label={t('workbench.tools.settings')}
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon size={15} />
          </button>
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>

      <main className="tool-body">
        <div className="tool-content">{children}</div>
      </main>

      <StatusBar />
    </div>
  );
}

/** Skeleton fallback for lazy-loaded tool pages (replaces the bare spinner). */
export function ToolSkeleton({ toolId }: { toolId?: string }) {
  const t = useT();
  const toolDef = getTool(toolId);
  return (
    <div className="tool-shell" aria-busy="true" aria-label={t('common.load')}>
      <header className="tool-topbar">
        <div className="tool-topbar-main">
          <span className="skeleton skeleton-btn" />
          <span className="skeleton skeleton-title" />
        </div>
      </header>
      <main className="tool-body">
        <div className="tool-content">
          <div className="tool-skeleton-row">
            <span className="skeleton skeleton-line skeleton-line-lg" />
            {toolDef && <span className="tool-skeleton-name">{t(toolDef.titleKey)}</span>}
          </div>
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line skeleton-line-md" />
        </div>
      </main>
    </div>
  );
}
