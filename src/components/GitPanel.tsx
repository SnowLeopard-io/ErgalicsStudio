import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useProjectStore, generateCommitMessage } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { getGitCorsProxy, setGitCorsProxy } from '@/core/git/isomorphic-adapter';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons';

/**
 * Git panel (§3.5): branch + ahead/behind, Pull/Push/Fetch, new-branch and
 * clone-from-URL entry points, a one-field commit box (stages every pending
 * change, Conventional Commit via `generateCommitMessage`) and the
 * recent-commit log. Remote failures surface through the shared notify
 * channel; deeper flows (diff viewer, conflict wizard) land with Phase 4.
 */
export function GitPanel({ alwaysOpen = false }: { alwaysOpen?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const gitRepo = useProjectStore((s) => s.gitRepo);
  const gitCommits = useProjectStore((s) => s.gitCommits);
  const gitLoading = useProjectStore((s) => s.gitLoading);
  const notify = useAppStore((s) => s.notify);

  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneStatus, setCloneStatus] = useState('');
  const [proxy, setProxy] = useState(getGitCorsProxy());
  const [busy, setBusy] = useState(false);
  /** VSCode keeps the change tree expanded; users can fold it away. */
  const [changesOpen, setChangesOpen] = useState(true);
  // The panel ships COLLAPSED: most users never configure a CORS proxy, so
  // spending sidebar space (and a status scan) on Git by default is noise.
  // The choice persists per browser. The dedicated git activity view forces
  // it open (`alwaysOpen`) — a collapsed panel there would just look broken.
  const [storedOpen, setStoredOpen] = useState(
    () => localStorage.getItem('ergalics.gitPanelOpen') === '1',
  );
  const open = alwaysOpen ? true : storedOpen;

  const projectId = project?.id;
  useEffect(() => {
    if (!projectId || !open) return;
    void useProjectStore.getState().refreshGitStatus();
    void useProjectStore.getState().loadGitLog();
  }, [projectId, open]);

  const toggle = (next: boolean) => {
    if (alwaysOpen) return;
    setStoredOpen(next);
    localStorage.setItem('ergalics.gitPanelOpen', next ? '1' : '0');
  };

  if (!project) return null;

  const repo = gitRepo?.isRepo ? gitRepo : null;
  const status = repo?.status;
  const pending = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0;

  const reportError = (err: unknown) => {
    // `String(err)` yields unreadable "Error: ENOENT: no such file or
    // directory, unlink '/…'" — surface the short code plus the message.
    const code = (err as { code?: string } | null)?.code;
    const raw = err instanceof Error ? err.message : String(err);
    let reason = code && !raw.startsWith(code) ? `${code}: ${raw}` : raw;
    // Network-level failures almost always mean the CORS proxy refused the
    // host — tell the user there is a way out instead of a bare ERR_FAILED.
    if (/failed to fetch|networkerror|cors|err_failed|proxy/i.test(reason)) {
      reason += ` — ${t('git.cors_hint')}`;
    }
    // 401/403 mean missing or wrong remote credentials — point at the
    // settings page where git identity fields live.
    if (/\b401\b|\b403\b|unauthorized|authentication|auth required|access denied/i.test(reason)) {
      reason += ` — ${t('git.auth_hint')}`;
    }
    notify('error', t('git.op_failed', { reason }));
  };

  const commit = async () => {
    if (!status || pending === 0) return;
    setBusy(true);
    try {
      const files = [...status.staged, ...status.unstaged, ...status.untracked];
      const store = useProjectStore.getState();
      await store.gitAdd(files);
      await store.gitCommit(
        message.trim() || generateCommitMessage('save', project.name || project.id),
      );
      setMessage('');
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Pull/Push/Fetch against the first configured remote (§3.5 header). */
  const remoteOp = async (op: 'pull' | 'push' | 'fetch') => {
    if (!repo) return;
    setBusy(true);
    try {
      const store = useProjectStore.getState();
      const remote = repo.remotes[0] ?? 'origin';
      if (op === 'fetch') {
        await store.gitFetch(remote);
      } else if (op === 'pull') {
        await store.gitPull(remote, repo.currentBranch);
      } else {
        await store.gitPush(remote, repo.currentBranch, true);
      }
      await useProjectStore.getState().loadGitLog();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const createBranch = async () => {
    const name = newBranch.trim();
    if (!name) return;
    setBusy(true);
    try {
      const store = useProjectStore.getState();
      await store.gitCreateBranch(name);
      await store.gitCheckout(name);
      setNewBranch('');
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const clone = async () => {
    const url = cloneUrl.trim();
    if (!url) return;
    setBusy(true);
    setCloneStatus('…');
    try {
      await useProjectStore.getState().gitClone(url, undefined, undefined, (phase, loaded, total) => {
        // isomorphic-git streams {phase, loaded, total}; totals can be 0
        // while sizes are still unknown.
        setCloneStatus(total > 0 ? `${phase} ${loaded}/${total}` : `${phase} ${loaded}`);
      });
      setCloneUrl('');
      setCloneStatus('');
      notify('success', t('git.cloned'));
    } catch (err) {
      reportError(err);
    } finally {
      setCloneStatus('');
      setBusy(false);
    }
  };

  const applyProxy = () => {
    setGitCorsProxy(proxy);
    notify('success', t('git.cors_saved'));
  };

  const dirtyText =
    status && (status.ahead > 0 || status.behind > 0)
      ? ` ↑${status.ahead} ↓${status.behind}`
      : '';

  /** Change-tree rows, split into the two VSCode groups: "Staged Changes"
   *  (index vs HEAD, − unstages) and "Changes" (worktree vs index, ＋ stages).
   *  Letters come from the decoded status-matrix entries (A/M/D/U); adapters
   *  without entries fall back to the path buckets (M/U). */
  const splitRows = (() => {
    const split = (path: string, letter: string, kind: 'staged' | 'unstaged' | 'untracked') => {
      const idx = path.lastIndexOf('/');
      return {
        path,
        letter,
        kind,
        name: idx >= 0 ? path.slice(idx + 1) : path,
        dir: idx >= 0 ? path.slice(0, idx) : '',
      };
    };
    if (status?.entries) {
      return {
        stagedRows: status.entries
          .filter((e) => e.staged)
          .map((e) => split(e.path, e.staged as string, 'staged'))
          .sort((a, b) => a.path.localeCompare(b.path)),
        worktreeRows: status.entries
          .filter((e) => e.worktree)
          .map((e) => split(e.path, e.worktree as string, e.worktree === 'U' ? 'untracked' : 'unstaged'))
          .sort((a, b) => a.path.localeCompare(b.path)),
      };
    }
    if (!status) return { stagedRows: [], worktreeRows: [] };
    return {
      stagedRows: status.staged.map((p) => split(p, 'M', 'staged')),
      worktreeRows: [
        ...status.unstaged.map((p) => split(p, 'M', 'unstaged')),
        ...status.untracked.map((p) => split(p, 'U', 'untracked')),
      ].sort((a, b) => a.path.localeCompare(b.path)),
    };
  })();

  /** Per-file stage (the ＋ hover action in the change tree). */
  const stageOne = async (file: string) => {
    setBusy(true);
    try {
      await useProjectStore.getState().gitAdd([file]);
      await useProjectStore.getState().refreshGitStatus();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Per-file unstage (the − hover action in the staged group). */
  const unstageOne = async (file: string) => {
    setBusy(true);
    try {
      await useProjectStore.getState().gitUnstage([file]);
      await useProjectStore.getState().refreshGitStatus();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="sidebar-group git-panel" open={open} onToggle={(e) => toggle((e.target as HTMLDetailsElement).open)}>
      <summary
        className="git-panel-summary"
        title={t('git.panel_title')}
        onClick={(e) => {
          // 常开模式下 summary 的原生折叠行为被禁用。
          if (alwaysOpen) e.preventDefault();
        }}
      >
        {/* The caret only means something when the panel can actually fold.
            In alwaysOpen (sidebar) mode collapse is disabled, so showing a
            chevron implies an affordance that isn't there. */}
        {!alwaysOpen && (
          <span className="git-panel-caret">
            <ChevronRightIcon size={12} />
          </span>
        )}
        <span>{t('git.panel_title')}</span>
        {repo && (
          <span className="git-panel-badge" title={repo.currentBranch}>
            ⎇ {repo.currentBranch}
            {pending > 0 && <b className="git-pending-dot">{pending}</b>}
          </span>
        )}
      </summary>
      {open && (
        <>
      {/* No repo yet: the primary action is enabling version control;
          clone-from-URL (which spawns a NEW project) and the CORS proxy are
          secondary, collapsed below. */}
      {!repo && (
        <>
          <div className="git-panel-no-repo">
            <p className="git-panel-hint">{t('git.no_repo')}</p>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await useProjectStore.getState().initGitRepo('standard');
                  await useProjectStore.getState().loadGitLog();
                } catch (err) {
                  reportError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('git.init_repo')}
            </button>
          </div>
          <details className="git-advanced">
            <summary title={t('git.advanced_summary')}>
              <span className="git-panel-caret">
                <ChevronRightIcon size={12} />
              </span>
              {t('git.advanced_summary')}
            </summary>
            <div className="git-clone-row">
              <input
                className="git-clone-input"
                type="text"
                value={cloneUrl}
                placeholder={t('git.clone_placeholder')}
                onChange={(e) => setCloneUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void clone();
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !cloneUrl.trim()}
                onClick={() => void clone()}
                title={t('git.clone')}
              >
                {t('git.clone')}
              </button>
            </div>
            {cloneStatus && <p className="git-panel-hint git-clone-progress">{cloneStatus}</p>}
            <div className="git-clone-row git-proxy-row">
              <input
                className="git-clone-input"
                type="text"
                value={proxy}
                placeholder={t('git.cors_proxy')}
                title={t('git.cors_hint')}
                onChange={(e) => setProxy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyProxy();
                }}
                onBlur={() => {
                  if (proxy.trim() !== getGitCorsProxy()) applyProxy();
                }}
              />
            </div>
          </details>
        </>
      )}
      {repo && (
        <>
          {/* VSCode source-control layout: message box + primary commit
              action live ABOVE the change tree. Enter or Ctrl+Enter commits;
              the kbd chip on the button advertises the shortcut. */}
          <input
            className="git-commit-input"
            type="text"
            value={message}
            placeholder={t('git.commit_placeholder')}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit();
            }}
          />
          <button
            type="button"
            className="btn btn-primary git-commit-btn"
            disabled={busy || pending === 0}
            onClick={() => void commit()}
            title={t('git.commit_hint')}
          >
            <span aria-hidden="true">✓</span>
            {t('git.commit')}
            <span className="git-commit-kbd" aria-hidden="true">
              Ctrl+Enter
            </span>
          </button>

          {/* Staged group first (VSCode order): green letters, − unstages. */}
          {splitRows.stagedRows.length > 0 && (
            <>
              <div className="git-changes-header git-changes-sub">
                <span className="git-changes-toggle git-changes-static">
                  {t('git.staged_changes')}
                  <b className="git-pending-dot">{splitRows.stagedRows.length}</b>
                </span>
              </div>
              <ul className="git-change-list">
                {splitRows.stagedRows.map((row) => (
                  <li key={row.path} className="git-change-item" title={row.path}>
                    <span className="git-change-letter git-st-staged">{row.letter}</span>
                    <span className="git-change-file">
                      <span className="git-change-name">{row.name}</span>
                      {row.dir && <span className="git-change-dir">{row.dir}</span>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn git-change-stage"
                      title={t('git.unstage_file')}
                      disabled={busy}
                      onClick={() => void unstageOne(row.path)}
                    >
                      −
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Change tree: collapsible header with count badge + refresh,
              file rows with status letter, dim directory and a hover ＋
              that stages just that file. */}
          <div className="git-changes-header">
            <button
              type="button"
              className="git-changes-toggle"
              onClick={() => setChangesOpen((v) => !v)}
            >
              <span
                className={`git-panel-caret${changesOpen ? '' : ' git-panel-caret-closed'}`}
                aria-hidden="true"
              >
                <ChevronDownIcon size={12} />
              </span>
              {t('git.changes')}
              {splitRows.worktreeRows.length > 0 && (
                <b className="git-pending-dot">{splitRows.worktreeRows.length}</b>
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('git.refresh')}
              onClick={() => {
                void useProjectStore.getState().refreshGitStatus();
                void useProjectStore.getState().loadGitLog();
              }}
            >
              ⟳
            </button>
          </div>
          {changesOpen &&
            (pending === 0 ? (
              <span className="git-clean">{t('git.clean')}</span>
            ) : (
              <ul className="git-change-list">
                {splitRows.worktreeRows.map((row) => (
                  <li key={row.path} className="git-change-item" title={row.path}>
                    <span className={`git-change-letter git-st-${row.kind}`}>{row.letter}</span>
                    <span className="git-change-file">
                      <span className="git-change-name">{row.name}</span>
                      {row.dir && <span className="git-change-dir">{row.dir}</span>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn git-change-stage"
                      title={t('git.stage_file')}
                      disabled={busy || row.kind === 'staged'}
                      onClick={() => void stageOne(row.path)}
                    >
                      ＋
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          <div className="git-panel-status">
            <span className="git-branch" title={t('git.branch')}>
              ⎇ {repo.currentBranch}
              {dirtyText && <span className="git-ahead-behind">{dirtyText}</span>}
            </span>
            <span className="git-remote-row">
              <button
                type="button"
                className="icon-btn"
                title={t('git.pull')}
                disabled={busy}
                onClick={() => void remoteOp('pull')}
              >
                ⇥
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('git.push')}
                disabled={busy}
                onClick={() => void remoteOp('push')}
              >
                ⇤
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('git.fetch')}
                disabled={busy}
                onClick={() => void remoteOp('fetch')}
              >
                ⇣
              </button>
            </span>
          </div>
          <div className="git-branch-row">
            <input
              className="git-branch-input"
              type="text"
              value={newBranch}
              placeholder={t('git.new_branch_placeholder')}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void createBranch();
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !newBranch.trim()}
              onClick={() => void createBranch()}
              title={t('git.new_branch')}
            >
              ＋
            </button>
          </div>
          {gitCommits.length > 0 && (
            <ul className="git-log">
              {gitCommits.slice(0, 8).map((c) => (
                <li key={c.hash} className="git-log-item" title={c.message}>
                  <span className="git-log-hash">{c.shortHash}</span>
                  <span className="git-log-msg">{c.message.split('\n')[0]}</span>
                </li>
              ))}
            </ul>
          )}
          {gitLoading && <span className="spinner" />}

          {/* Secondary setup last (VSCode order: the commit flow leads):
              CORS proxy for remote ops + the identity/credentials entry. */}
          <details className="git-advanced">
            <summary title={t('git.proxy_summary')}>
              <span className="git-panel-caret">
                <ChevronRightIcon size={12} />
              </span>
              {t('git.proxy_summary')}
            </summary>
            <div className="git-clone-row git-proxy-row">
              <input
                className="git-clone-input"
                type="text"
                value={proxy}
                placeholder={t('git.cors_proxy')}
                title={t('git.cors_hint')}
                onChange={(e) => setProxy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) applyProxy();
                }}
                onBlur={() => {
                  if (proxy.trim() !== getGitCorsProxy()) applyProxy();
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate('/settings')}
              title={t('git.auth_hint')}
            >
              {t('git.identity_settings')}
            </button>
          </details>
          </>
        )}
        </>
      )}
    </details>
  );
}
