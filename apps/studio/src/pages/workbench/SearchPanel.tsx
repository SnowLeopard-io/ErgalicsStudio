// ==========================================================================
// Ergalics Studio — sidebar workspace search (activity bar · 搜索)
//
// Scans the project Vfs text files for a query and groups matches by file,
// VS Code style. Clicking a result opens the file through the shared
// `openProjectFile` entry point (same tab routing as the explorer and the
// terminal). Search itself lives in core/search/workspaceSearch (pure and
// unit-testable); this component only owns debounce + presentation.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import {
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FileIcon,
  FileSearchIcon,
  RefreshIcon,
  RegexIcon,
  SearchIcon,
  WholeWordIcon,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getVfs } from '@/core/vfs';
import {
  searchWorkspace,
  type SearchFileResult,
  type SearchMatch,
  type SearchResult,
} from '@/core/search/workspaceSearch';
import { openProjectFile } from '@/core/workspace/open-file';

/** Debounce before walking the tree: typing should not scan per keystroke. */
const SEARCH_DEBOUNCE_MS = 220;

function HighlightedSnippet({ match }: { match: SearchMatch }) {
  const before = match.text.slice(0, match.highlightStart);
  const hit = match.text.slice(
    match.highlightStart,
    match.highlightStart + match.highlightLength,
  );
  const after = match.text.slice(match.highlightStart + match.highlightLength);
  return (
    <span className="search-match-text">
      {before}
      {hit ? <mark className="search-hit">{hit}</mark> : null}
      {after}
    </span>
  );
}

export function SearchPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const projectId = project?.id ?? null;
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);

  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /** Monotonic token: a slow scan must never overwrite a newer query. */
  const scanSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const seq = ++scanSeq.current;
    if (!q) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const current = useProjectStore.getState().project;
        if (!current) {
          if (seq === scanSeq.current) {
            setResult(null);
            setLoading(false);
          }
          return;
        }
        try {
          const scanned = await searchWorkspace(
            getVfs(),
            getProjectRepoPath(current),
            q,
            { caseSensitive, wholeWord, regex },
          );
          if (seq === scanSeq.current) setResult(scanned);
        } catch {
          if (seq === scanSeq.current) setResult(null);
        } finally {
          if (seq === scanSeq.current) setLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, caseSensitive, wholeWord, regex, projectId, fileOpsVersion, refreshNonce]);

  const openFile = (file: SearchFileResult) => {
    void openProjectFile(file.path, { size: file.size }).catch(() => undefined);
  };

  const toggleFile = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <h3 className="explorer-heading">{t('workbench.activity.search')}</h3>
        <button
          type="button"
          className="search-icon-btn"
          aria-label={t('search.refresh')}
          title={t('search.refresh')}
          disabled={!hasQuery || loading}
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          <RefreshIcon size={13} />
        </button>
      </div>

      <div className="search-input-wrap">
        <SearchIcon size={14} className="search-input-icon" />
        <input
          className="input search-input"
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          autoFocus
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setRefreshNonce((n) => n + 1);
          }}
        />
        {hasQuery && (
          <button
            type="button"
            className="search-clear-btn"
            aria-label={t('search.clear')}
            title={t('search.clear')}
            onClick={() => setQuery('')}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>

      <div className="search-options" role="group" aria-label={t('search.options')}>
        <button
          type="button"
          className={`search-option${caseSensitive ? ' is-active' : ''}`}
          aria-pressed={caseSensitive}
          aria-label={t('search.case_sensitive')}
          title={t('search.case_sensitive')}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitiveIcon size={16} />
        </button>
        <button
          type="button"
          className={`search-option${wholeWord ? ' is-active' : ''}`}
          aria-pressed={wholeWord}
          aria-label={t('search.whole_word')}
          title={t('search.whole_word')}
          onClick={() => setWholeWord((v) => !v)}
        >
          <WholeWordIcon size={16} />
        </button>
        <button
          type="button"
          className={`search-option${regex ? ' is-active' : ''}`}
          aria-pressed={regex}
          aria-label={t('search.regex')}
          title={t('search.regex')}
          onClick={() => setRegex((v) => !v)}
        >
          <RegexIcon size={16} />
        </button>
      </div>

      <div className="search-results" aria-live="polite">
        {!project && <div className="empty-hint">{t('search.no_project')}</div>}

        {project && !hasQuery && (
          <div className="search-empty">
            <FileSearchIcon size={22} />
            <span>{t('search.empty_hint')}</span>
          </div>
        )}

        {project && hasQuery && loading && (
          <div className="search-status">
            <span className="spinner" />
            <span>{t('search.searching')}</span>
          </div>
        )}

        {project && hasQuery && !loading && result?.invalidRegex && (
          <div className="search-empty search-error">{t('search.invalid_regex')}</div>
        )}

        {project && hasQuery && !loading && result && !result.invalidRegex && (
          <>
            {result.total === 0 ? (
              <div className="search-empty">
                <FileSearchIcon size={22} />
                <span>{t('search.no_results')}</span>
              </div>
            ) : (
              <>
                <div className="search-summary">
                  <span>
                    {t('search.summary', {
                      files: result.files.length,
                      matches: result.total,
                    })}
                  </span>
                  {result.truncated && (
                    <span className="search-truncated">{t('search.truncated')}</span>
                  )}
                </div>

                <ul className="search-file-list">
                  {result.files.map((file) => {
                    const isCollapsed = collapsed.has(file.path);
                    const dir = file.path.includes('/')
                      ? file.path.slice(0, file.path.lastIndexOf('/'))
                      : '';
                    return (
                      <li key={file.path} className="search-file-group">
                        <button
                          type="button"
                          className="search-file-header"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleFile(file.path)}
                        >
                          <span className="search-file-chevron">
                            {isCollapsed ? (
                              <ChevronRightIcon size={12} />
                            ) : (
                              <ChevronDownIcon size={12} />
                            )}
                          </span>
                          <FileIcon size={13} />
                          <span className="search-file-name" title={file.path}>
                            {file.name}
                          </span>
                          {dir && <span className="search-file-dir">{dir}</span>}
                          <span className="search-file-count">{file.matches.length}</span>
                        </button>

                        {!isCollapsed && (
                          <ul className="search-match-list">
                            {file.matches.map((match, i) => (
                              <li key={`${match.line}:${match.column}:${i}`}>
                                <button
                                  type="button"
                                  className="search-match-row"
                                  title={t('search.open_hint')}
                                  onClick={() => openFile(file)}
                                >
                                  <span className="search-line-no">{match.line}</span>
                                  <HighlightedSnippet match={match} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
