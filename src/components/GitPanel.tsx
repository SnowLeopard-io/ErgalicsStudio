import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useProjectStore, generateCommitMessage } from '@/stores/projectStore';

/**
 * Minimal Git panel (Phase 3 of docs/requirements/01): branch + change
 * summary, a one-field commit box (stages every pending change, Conventional
 * Commit via `generateCommitMessage`), and the recent-commit log. Deeper
 * flows (diff viewer, remote sync, conflict wizard) land with the full
 * Phase 3/4 work.
 */
export function GitPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const gitRepo = useProjectStore((s) => s.gitRepo);
  const gitCommits = useProjectStore((s) => s.gitCommits);
  const gitLoading = useProjectStore((s) => s.gitLoading);

  const [message, setMessage] = useState('');
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="sidebar-group git-panel">
      <h3 className="sidebar-heading">{t('git.panel_title')}</h3>
      {!repo ? (
        <p className="git-panel-hint">{t('git.no_repo')}</p>
      ) : (
        <>
          <div className="git-panel-status">
            <span className="git-branch" title={t('git.branch')}>
              ⎇ {repo.currentBranch}
            </span>
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
