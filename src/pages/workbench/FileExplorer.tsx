// ==========================================================================
// Ergalics Studio — sidebar file explorer (Standard mode, activity bar)
//
// 与科研套件的 FileExplorerPage 同源：浏览项目 Git 仓库（虚拟工作区，
// getGitAdapter + getProjectRepoPath）的真实工作树，标准骨架为
// project.clproj + runs/ + figures/ + data/ + code/ + manuscript/ +
// .ergalics/ + .git/ + .gitignore/.gitattributes（§3.1）。
//
// 目录按需懒加载（readDir）；点击文本文件 → 中央画布区只读预览
// （appStore.filePreview）。顶层条目附目录导览说明（复用 explorer.* 文案）。
// 预览纯只读：任何位置都不提供写入/编辑入口。
// ==========================================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getGitAdapter } from '@/core/git';
import type { RepoEntry } from '@/core/git';
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';

/** Raw content is capped so a multi-MB snapshot never freezes the UI. */
const PREVIEW_CAP_CHARS = 200_000;

/** Extensions previewed as UTF-8 text; everything else is treated as binary. */
const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'csv', 'tsv', 'yml', 'yaml', 'toml', 'svg',
  'clproj', 'lock', 'log', 'ini', 'sh', 'js', 'py', 'r',
]);
/** Extension-less files that are still text. */
const TEXT_NAME = new Set(['.gitignore', '.gitattributes', 'license', 'readme']);

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAME.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && TEXT_EXT.has(lower.slice(dot + 1));
}

/** Static guide rows for the standard project skeleton (§3.1 templates). */
const GUIDE: ReadonlyArray<{ match: (p: string) => boolean; key: string }> = [
  { match: (p) => p === 'project.clproj', key: 'explorer.file_clproj' },
  { match: (p) => p === 'runs' || p.startsWith('runs/'), key: 'explorer.dir_runs' },
  { match: (p) => p === 'figures' || p.startsWith('figures/'), key: 'explorer.dir_figures' },
  { match: (p) => p === 'data' || p.startsWith('data/'), key: 'explorer.dir_data' },
  { match: (p) => p === 'code' || p.startsWith('code/'), key: 'explorer.dir_code' },
  { match: (p) => p === 'manuscript' || p.startsWith('manuscript/'), key: 'explorer.dir_manuscript' },
  { match: (p) => p === '.ergalics' || p.startsWith('.ergalics/'), key: 'explorer.dir_ergalics' },
  { match: (p) => p === '.git' || p.startsWith('.git/'), key: 'explorer.dir_git' },
  { match: (p) => p === '.gitignore' || p === '.gitattributes', key: 'explorer.dir_ignore' },
];

export function FileExplorer() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const setFilePreview = useAppStore((s) => s.setFilePreview);
  const filePreview = useAppStore((s) => s.filePreview);

  /** Per-directory listings, keyed by repo-relative dir ('' = root). */
  const [tree, setTree] = useState<Record<string, RepoEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hasRepo, setHasRepo] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(
    async (dir: string) => {
      if (!project) return;
      try {
        const adapter = getGitAdapter();
        const entries = await adapter.readDir(getProjectRepoPath(project), dir);
        setTree((prev) => ({ ...prev, [dir]: entries }));
      } catch {
        setTree((prev) => ({ ...prev, [dir]: [] }));
      }
    },
    [project],
  );

  // Fresh project → clean slate + root listing + repo probe.
  useEffect(() => {
    setTree({});
    setExpanded(new Set());
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const adapter = getGitAdapter();
        const repoOk = await adapter.isRepo(getProjectRepoPath(project));
        if (cancelled) return;
        setHasRepo(repoOk);
        if (repoOk) await loadDir('');
      } catch {
        if (!cancelled) setHasRepo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        if (!(dir in tree)) void loadDir(dir);
      }
      return next;
    });
  };

  const refresh = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const dirs = ['', ...expanded];
      for (const dir of dirs) await loadDir(dir);
    } finally {
      setLoading(false);
    }
  };

  const openPreview = async (entry: RepoEntry) => {
    if (!project) return;
    if (!isTextFile(entry.name)) {
      notify('error', t('workbench.explorer.read_failed'));
      return;
    }
    try {
      const adapter = getGitAdapter();
      const raw = await adapter.readFile(getProjectRepoPath(project), entry.path);
      setFilePreview({
        name: entry.name,
        path: entry.path,
        content: raw.length > PREVIEW_CAP_CHARS ? raw.slice(0, PREVIEW_CAP_CHARS) : raw,
      });
    } catch {
      notify('error', t('workbench.explorer.read_failed'));
    }
  };

  const guideFor = (path: string): string | undefined => {
    const row = GUIDE.find((g) => g.match(path));
    return row ? t(row.key) : undefined;
  };

  const renderEntries = (entries: RepoEntry[], depth: number): ReactNode => (
    <ul className="explorer-list" role={depth === 0 ? 'tree' : 'group'}>
      {entries.map((e) => {
        if (e.isDir) {
          const isOpen = expanded.has(e.path);
          const guide = guideFor(e.path);
          return (
            <li key={e.path}>
              <button
                type="button"
                className="explorer-row explorer-dir"
                style={{ paddingLeft: 6 + depth * 14 }}
                aria-expanded={isOpen}
                title={guide ? `${e.path} — ${guide}` : e.path}
                onClick={() => toggleDir(e.path)}
              >
                {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                <span className="explorer-name">{e.name}</span>
              </button>
              {isOpen && renderEntries(tree[e.path] ?? [], depth + 1)}
            </li>
          );
        }
        const active = filePreview?.path === e.path;
        return (
          <li key={e.path}>
            <button
              type="button"
              className={`explorer-row explorer-file${active ? ' active' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              title={e.path}
              onClick={() => void openPreview(e)}
            >
              <span className="explorer-name">{e.name}</span>
            </button>
          </li>
        );
      })}
      {entries.length === 0 && <p className="explorer-hint">{t('explorer.empty_dir')}</p>}
    </ul>
  );

  return (
    <div className="file-explorer">
      {!project && <EmptyState title={t('workbench.explorer.no_project')} />}

      {project && !hasRepo && <EmptyState title={t('explorer.no_repo')} />}

      {project && hasRepo && (
        <section className="explorer-section">
          <header className="explorer-section-header">
            <h4 className="explorer-heading" title={getProjectRepoPath(project)}>
              {t('workbench.explorer.workspace')}
            </h4>
            <button
              type="button"
              className="icon-btn"
              title={t('explorer.refresh')}
              aria-label={t('explorer.refresh')}
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshIcon size={14} />
            </button>
          </header>
          {loading && <p className="explorer-hint">{t('workbench.explorer.loading')}</p>}
          {renderEntries(tree[''] ?? [], 0)}
        </section>
      )}
    </div>
  );
}
