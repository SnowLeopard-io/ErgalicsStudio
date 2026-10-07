// ==========================================================================
// Ergalics Studio — File Explorer (research tool §files)
//
// Researchers could not answer "where do my runs/figures/scripts actually
// live?" — the Git-backed repo (runs/, figures/, code/, …) was invisible.
// This page browses the virtual repo working tree directly through the
// GitAdapter.readDir primitive: lazy per-directory listings on the left,
// a text preview + download on the right, and a static directory guide
// that documents the standard project skeleton (§3.1).
// ==========================================================================

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { getProjectRepoPath } from '@/stores/projectStore';
import { getGitAdapter } from '@/core/git';
import type { RepoEntry } from '@/core/git';
import { downloadBlob } from '@/core/download';
import { ToolShell } from '@/components/ToolShell';

/** Extensions previewed as UTF-8 text; everything else is "binary". */
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

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

export default function FileExplorerPage() {
  const t = useT();
  const project = useProjectStore((s) => s.project);

  /** Per-directory listings, keyed by repo-relative dir ('' = root). */
  const [tree, setTree] = useState<Record<string, RepoEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<RepoEntry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [hasRepo, setHasRepo] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadDir = useCallback(
    async (dir: string) => {
      if (!project) return;
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      const entries = await adapter.readDir(repoPath, dir);
      setTree((prev) => ({ ...prev, [dir]: entries }));
    },
    [project],
  );

  // Fresh project → clean slate + root listing + repo probe.
  useEffect(() => {
    setTree({});
    setExpanded(new Set());
    setSelected(null);
    setContent(null);
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const adapter = getGitAdapter();
      const repoOk = await adapter.isRepo(getProjectRepoPath(project));
      if (cancelled) return;
      setHasRepo(repoOk);
      if (repoOk) await loadDir('');
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
        if (!(dir in tree)) void loadDir(dir);
      }
      return next;
    });
  };

  const selectEntry = async (entry: RepoEntry) => {
    if (entry.isDir) {
      toggleDir(entry.path);
      return;
    }
    setSelected(entry);
    setContent(null);
    if (!project) return;
    if (!isTextFile(entry.name)) return;
    const adapter = getGitAdapter();
    const text = await adapter.readFile(getProjectRepoPath(project), entry.path);
    setContent(text);
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

  const download = () => {
    if (!project || !selected || !content) return;
    downloadBlob(selected.name, content, 'text/plain;charset=utf-8');
  };

  if (!project) return null;

  const guideRow = selected
    ? GUIDE.find((g) => g.match(selected.path))
    : undefined;

  const renderEntries = (entries: RepoEntry[], depth: number) => (
    <>
      {entries.map((e) => (
        <div key={e.path}>
          <button
            type="button"
            className={`explorer-node${selected?.path === e.path ? ' is-active' : ''}`}
            style={{ paddingLeft: `${10 + depth * 16}px` }}
            onClick={() => void selectEntry(e)}
            title={e.path}
          >
            <span className={`explorer-twisty${e.isDir ? (expanded.has(e.path) ? ' is-open' : '') : ' is-leaf'}`}>
              {e.isDir ? '▸' : '·'}
            </span>
            <span className={`explorer-name${e.isDir ? ' is-dir' : ''}`}>{e.name}</span>
            {!e.isDir && <span className="explorer-size">{fmtSize(e.size)}</span>}
          </button>
          {e.isDir && expanded.has(e.path) && renderEntries(tree[e.path] ?? [], depth + 1)}
        </div>
      ))}
      {entries.length === 0 && <p className="explorer-empty">{t('explorer.empty_dir')}</p>}
    </>
  );

  return (
    <ToolShell toolId="files">
      {!hasRepo ? (
        <p className="explorer-empty">{t('explorer.no_repo')}</p>
      ) : (
        <>
          <div className="explorer-toolbar">
            <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void refresh()}>
              ⟳ {t('explorer.refresh')}
            </button>
          </div>
          <div className="explorer-grid">
            <nav className="explorer-tree">
              {tree[''] ? renderEntries(tree[''], 0) : <p className="explorer-empty">{t('explorer.loading')}</p>}
            </nav>
            <section className="explorer-view">
              {selected ? (
                <>
                  <div className="explorer-crumb">
                    <code>{selected.path}</code>
                    <span className="explorer-meta">
                      {selected.isDir ? '' : `${t('explorer.size')} ${fmtSize(selected.size)} · `}
                      {guideRow ? t(guideRow.key) : ''}
                    </span>
                  </div>
                  {content !== null ? (
                    <>
                      <pre className="explorer-pre">{content}</pre>
                      <div className="explorer-actions">
                        <button type="button" className="btn btn-sm" onClick={download}>
                          ⭳ {t('explorer.download')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="explorer-empty">
                      {isTextFile(selected.name) ? t('explorer.loading') : t('explorer.preview_binary')}
                    </p>
                  )}
                </>
              ) : (
                <p className="explorer-empty">{t('explorer.select_hint')}</p>
              )}
            </section>
          </div>
          <section className="explorer-guide">
            <h3 className="sidebar-heading">{t('explorer.guide_title')}</h3>
            <ul className="explorer-guide-list">
              {GUIDE.map((g) => (
                <li key={g.key}>{t(g.key)}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </ToolShell>
  );
}
