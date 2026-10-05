import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useProjectStore, generateCommitMessage } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';

/**
 * Git panel (§3.5): branch + ahead/behind, Pull/Push/Fetch, new-branch and
 * clone-from-URL entry points, a one-field commit box (stages every pending
 * change, Conventional Commit via `generateCommitMessage`) and the
 * recent-commit log. Remote failures surface through the shared notify
 * channel; deeper flows (diff viewer, conflict wizard) land with Phase 4.
 */
export function GitPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const gitRepo = useProjectStore((s) => s.gitRepo);
  const gitCommits = useProjectStore((s) => s.gitCommits);
  const gitLoading = useProjectStore((s) => s.gitLoading);
  const notify = useAppStore((s) => s.notify);

  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    void useProjectStore.getState().refreshGitStatus();
    void useProjectStore.getState().loadGitLog();
  }, [project?.id]);

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
    const msg = err instanceof Error ? err.message : String(err);
    const reason = code && !msg.startsWith(code) ? `${code}: ${msg}` : msg;
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
    try {
      await useProjectStore.getState().gitClone(url);
      setCloneUrl('');
      notify('success', t('git.cloned'));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const dirtyText =
    status && (status.ahead > 0 || status.behind > 0)
      ? ` ↑${status.ahead} ↓${status.behind}`
      : '';

  return (
    <nav className="sidebar-group git-panel">
      <h3 className="sidebar-heading">{t('git.panel_title')}</h3>
      <div className="git-clone-row">
        <input
          className="git-clone-input"
          type="text"
          value={cloneUrl}
          placeholder={t('git.clone_placeholder')}
          onChange={(e) => setCloneUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void clone();
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
      {!repo ? (
        <p className="git-panel-hint">{t('git.no_repo')}</p>
      ) : (
        <>
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
                if (e.key === 'Enter') void createBranch();
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
          <div className="git-panel-changes">
            {pending === 0 ? (
              <span className="git-clean">{t('git.clean')}</span>
            ) : (
              <button type="button" className="git-changes-btn" onClick={() => void commit()}>
                {t('git.stage_commit_all', { n: pending })}
              </button>
            )}
          </div>
          <div className="git-commit-row">
            <input
              className="git-commit-input"
              type="text"
              value={message}
              placeholder={t('git.commit_placeholder')}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || pending === 0}
              onClick={() => void commit()}
            >
              {t('git.commit')}
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
        </>
      )}
    </nav>
  );
}
