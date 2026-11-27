// ==========================================================================
// Ergalics Studio — citation manager (/studio/citation-manager)
//
// One shared BibTeX library feeds the LaTeX editor and the bibliography here.
// The page covers import (paste/file/DOI), field editing, duplicate merging,
// the seven citation styles, statistics, an in-library reference graph, and
// CITATION.cff round-tripping. Everything persists in project.state.publish
// and can be written back to the workspace (references.bib + CITATION.cff).
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { usePublishStore } from '@/stores/publishStore';
import {
  citationStats,
  buildReferenceGraph,
  cffToBibEntry,
  fetchDoiMetadata,
  formatCitation,
  parseCitationCff,
  toCitationCff,
  topCited,
  CITATION_STYLES,
  type CitationCff,
} from '@/core/publish/citation';
import {
  findDuplicateGroups,
  makeCitationKey,
  mergeEntries,
  parseBibtex,
  toBibtex,
  type BibEntry,
} from '@/core/publish/bibtex';
import {
  downloadText,
  readTextFile,
  usePublishState,
  writePublishArtifacts,
} from './shared';

function entrySearchText(entry: BibEntry): string {
  return `${entry.key} ${entry.type} ${Object.values(entry.fields).join(' ')}`.toLowerCase();
}

export default function CitationManagerPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const publish = usePublishState();
  const setLibrary = usePublishStore((s) => s.setLibrary);
  const addLibraryEntries = usePublishStore((s) => s.addLibraryEntries);
  const updateLibraryEntry = usePublishStore((s) => s.updateLibraryEntry);
  const deleteLibraryEntry = usePublishStore((s) => s.deleteLibraryEntry);

  const library = publish.library;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [doi, setDoi] = useState('');
  const [fetching, setFetching] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BibEntry | null>(null);
  const [newField, setNewField] = useState({ name: '', value: '' });
  const [cffTitle, setCffTitle] = useState(project?.name ?? '');
  const [cffManual, setCffManual] = useState<string | null>(null);
  const [style, setStyle] = useState(CITATION_STYLES[0]!.id);

  const selected = library.find((e) => e.key === selectedKey) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? library.filter((e) => entrySearchText(e).includes(q)) : library;
  }, [library, query]);

  const stats = useMemo(() => citationStats(library), [library]);
  const graph = useMemo(() => buildReferenceGraph(library), [library]);
  const cited = useMemo(() => topCited(graph, 5), [graph]);
  const duplicateGroups = useMemo(() => findDuplicateGroups(library), [library]);

  const cff: CitationCff = useMemo(() => {
    const authorsByName = new Map<string, { family: string; given: string }>();
    for (const entry of library) {
      for (const author of parseAuthors(entry)) {
        if (author.family) authorsByName.set(`${author.family}|${author.given}`, author);
      }
    }
    const authors = [...authorsByName.values()].slice(0, 12);
    return {
      cffVersion: '1.2.0',
      message: 'If you use this software or data, please cite it as below.',
      title: cffTitle.trim() || project?.name || 'Research project',
      authors,
      year: String(new Date().getFullYear()),
      version: project?.metadata.version,
      url: project ? `${window.location.origin}${window.location.pathname}` : undefined,
      license: 'MIT',
    };
  }, [library, cffTitle, project]);

  const cffText = cffManual ?? toCitationCff(cff);

  const importBibtex = (text: string) => {
    const entries = parseBibtex(text);
    if (entries.length === 0) {
      notify('warning', t('publish.citation.invalid'));
      return;
    }
    addLibraryEntries(entries);
    setPasteOpen(false);
    setPasteText('');
    notify('success', t('publish.citation.added', { n: String(entries.length) }));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    importBibtex(await readTextFile(file));
  };

  const handleDoi = async () => {
    if (!doi.trim() || fetching) return;
    setFetching(true);
    try {
      const entry = await fetchDoiMetadata(doi);
      // The generated key is only family+year+word — two papers by the same
      // author in the same year collide. Give the new entry a free key
      // BEFORE it reaches the store, so the panel can select it afterwards.
      const used = new Set(library.map((e) => e.key));
      const key = used.has(entry.key) ? makeCitationKey(entry, used) : entry.key;
      addLibraryEntries([{ ...entry, key }]);
      setSelectedKey(key);
      setDoi('');
      notify('success', t('publish.citation.entry_added', { key }));
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    } finally {
      setFetching(false);
    }
  };

  const patchSelected = (patch: Partial<BibEntry>) => {
    if (!selected) return;
    updateLibraryEntry(selected.key, { ...selected, ...patch });
  };

  const patchField = (field: string, value: string) => {
    if (!selected) return;
    updateLibraryEntry(selected.key, {
      ...selected,
      fields: { ...selected.fields, [field]: value },
    });
  };

  const removeField = (field: string) => {
    if (!selected) return;
    const fields = { ...selected.fields };
    delete fields[field];
    updateLibraryEntry(selected.key, { ...selected, fields });
  };

  const mergeDuplicates = () => {
    if (duplicateGroups.length === 0) return;
    let next = library;
    for (const group of duplicateGroups) {
      const merged = mergeEntries(group);
      const keys = new Set(group.map((e) => e.key));
      next = [...next.filter((e) => !keys.has(e.key)), merged];
    }
    setLibrary(next);
    notify('success', t('publish.citation.merged', { n: String(duplicateGroups.length) }));
  };

  const importCff = async (file: File | undefined) => {
    if (!file) return;
    const text = await readTextFile(file);
    const parsed = parseCitationCff(text);
    const entry = cffToBibEntry(parsed, slugCffKey(parsed.title));
    addLibraryEntries([entry]);
    setSelectedKey(entry.key);
    notify('success', t('publish.citation.entry_added', { key: entry.key }));
  };

  const saveWorkspace = async () => {
    if (!project) return;
    try {
      await writePublishArtifacts(
        [
          { path: 'manuscript/references.bib', content: toBibtex(library) },
          { path: 'CITATION.cff', content: cffText },
        ],
        `citation library (${library.length} entries)`,
      );
      notify('success', t('publish.common.git_saved'));
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    }
  };

  const typeEntries = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  const yearMax = Math.max(1, ...stats.byYear.map((y) => y.count));

  return (
    <ToolShell toolId="citation-manager">
      <div className="publish-page">
        <aside className="publish-side">
          <div className="publish-side-head">
            <h2 className="publish-side-title">{t('publish.citation.library')} ({library.length})</h2>
          </div>
          <input
            className="input"
            placeholder={t('publish.citation.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('publish.citation.search')}
          />
          <div className="publish-row">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setPasteOpen((v) => !v)}
            >
              {t('publish.citation.import_bibtex')}
            </button>
            <label className="btn btn-sm publish-file-btn">
              {t('publish.citation.import_file')}
              <input
                type="file"
                accept=".bib,.bibtex,text/plain"
                hidden
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </label>
            <label className="btn btn-sm publish-file-btn">
              {t('publish.citation.cff_import')}
              <input
                type="file"
                accept=".cff,.yaml,.yml,text/plain"
                hidden
                onChange={(e) => void importCff(e.target.files?.[0])}
              />
            </label>
          </div>
          <div className="publish-row">
            <input
              className="input publish-grow"
              placeholder={t('publish.citation.doi_placeholder')}
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
              aria-label={t('publish.citation.fetch_doi')}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={fetching || !doi.trim()}
              onClick={() => void handleDoi()}
            >
              {fetching ? t('publish.citation.fetching') : t('publish.citation.fetch_doi')}
            </button>
          </div>

          {pasteOpen && (
            <div className="publish-field">
              <textarea
                className="input publish-mono"
                rows={7}
                value={pasteText}
                placeholder={t('publish.citation.import_paste')}
                onChange={(e) => setPasteText(e.target.value)}
                aria-label={t('publish.citation.import_paste')}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!pasteText.trim()}
                onClick={() => importBibtex(pasteText)}
              >
                {t('publish.citation.import_bibtex')}
              </button>
            </div>
          )}

          <ul className="publish-list publish-list-scroll">
            {filtered.map((entry) => (
              <li
                key={entry.key}
                className={`publish-list-item${entry.key === selectedKey ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="publish-list-select"
                  onClick={() => setSelectedKey(entry.key)}
                >
                  <span className="publish-list-name">{entry.fields.title || entry.key}</span>
                  <span className="publish-list-meta">
                    {entry.type} · {entry.fields.year ?? '—'} · {entry.key}
                  </span>
                </button>
                <button
                  type="button"
                  className="publish-delete"
                  aria-label={t('publish.citation.delete_entry')}
                  title={t('publish.citation.delete_entry')}
                  onClick={() => setDeleteTarget(entry)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p className="publish-muted">{t('publish.common.none')}</p>}

          <div className="publish-row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => downloadText('references.bib', toBibtex(library), 'application/x-bibtex')}
              disabled={library.length === 0}
            >
              {t('publish.citation.export_bib')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void saveWorkspace()}
            >
              {t('publish.citation.save_workspace')}
            </button>
          </div>
        </aside>

        <section className="publish-main">
          <div className="publish-grid-2">
            <div className="publish-card">
              <h3 className="publish-card-title">{t('publish.citation.stats')}</h3>
              <div className="publish-stat-row">
                <div className="publish-stat">
                  <span className="publish-stat-value">{stats.total}</span>
                  <span className="publish-stat-label">{t('publish.citation.total')}</span>
                </div>
                <div className="publish-stat">
                  <span className="publish-stat-value">
                    {stats.earliestYear ?? '—'}–{stats.latestYear ?? '—'}
                  </span>
                  <span className="publish-stat-label">{t('publish.citation.range')}</span>
                </div>
              </div>
              <div className="publish-tags">
                {typeEntries.map(([type, count]) => (
                  <span key={type} className="publish-tag">{type} · {count}</span>
                ))}
              </div>
              {stats.byYear.length > 0 && (
                <>
                  <div className="publish-mini-title">{t('publish.citation.years')}</div>
                  <div className="publish-bars" role="img" aria-label={t('publish.citation.years')}>
                    {stats.byYear.map((y) => (
                      <div key={y.year} className="publish-bar-col" title={`${y.year}: ${y.count}`}>
                        <div
                          className="publish-bar"
                          style={{ height: `${Math.max(4, (y.count / yearMax) * 100)}%` }}
                        />
                        <span className="publish-bar-label">{y.year}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="publish-card">
              <h3 className="publish-card-title">{t('publish.citation.graph')}</h3>
              <ReferenceGraphSvg graph={graph} label={t('publish.citation.graph')} />
              <p className="publish-hint">{t('publish.citation.graph_hint')}</p>
              {cited.length > 0 && (
                <ul className="publish-plain-list">
                  {cited.map((node) => (
                    <li key={node.key}>
                      <span className="publish-mono">{node.label}</span> · {node.citedBy}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="publish-card">
            <div className="publish-row publish-between">
              <h3 className="publish-card-title">{t('publish.citation.duplicates')}</h3>
              {duplicateGroups.length > 0 && (
                <button type="button" className="btn btn-sm btn-primary" onClick={mergeDuplicates}>
                  {t('publish.citation.merge')} ({duplicateGroups.length})
                </button>
              )}
            </div>
            {duplicateGroups.length === 0 ? (
              <p className="publish-hint">{t('publish.citation.no_duplicates')}</p>
            ) : (
              <>
                <p className="publish-hint">
                  {t('publish.citation.duplicates_found', { n: String(duplicateGroups.length) })}
                </p>
                <ul className="publish-plain-list">
                  {duplicateGroups.map((group) => (
                    <li key={group.map((e) => e.key).join('|')}>
                      {group.map((e) => e.key).join(', ')} — {group[0]?.fields.title ?? ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {selected ? (
            <div className="publish-card">
              <div className="publish-row publish-between">
                <h3 className="publish-card-title">{t('publish.citation.details')}</h3>
                <span className="publish-mono publish-muted">{selected.type}</span>
              </div>
              <div className="publish-field-grid">
                <label className="publish-label">
                  {t('publish.citation.field_key')}
                  <input
                    className="input publish-mono"
                    value={selected.key}
                    onChange={(e) => {
                      const key = e.target.value.trim();
                      if (!key) return;
                      // Two entries sharing one key produce invalid BibTeX
                      // and ambiguous \cite{} references — refuse the rename.
                      if (library.some((e) => e.key === key && e.key !== selected.key)) {
                        notify('warning', t('publish.citation.key_exists', { key }));
                        return;
                      }
                      updateLibraryEntry(selected.key, { ...selected, key });
                      setSelectedKey(key);
                    }}
                  />
                </label>
                <label className="publish-label">
                  type
                  <input
                    className="input publish-mono"
                    value={selected.type}
                    onChange={(e) => patchSelected({ type: e.target.value.trim() || 'misc' })}
                  />
                </label>
              </div>
              <div className="publish-mini-title">{t('publish.citation.fields')}</div>
              <div className="publish-fields">
                {Object.entries(selected.fields).map(([field, value]) => (
                  <div key={field} className="publish-field-row">
                    <span className="publish-field-name publish-mono">{field}</span>
                    <input
                      className="input"
                      value={value}
                      onChange={(e) => patchField(field, e.target.value)}
                    />
                    <button
                      type="button"
                      className="publish-delete"
                      onClick={() => removeField(field)}
                      aria-label={`${t('publish.common.delete')} ${field}`}
                      title={`${t('publish.common.delete')} ${field}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="publish-row">
                <input
                  className="input publish-grow publish-mono"
                  placeholder="field"
                  value={newField.name}
                  onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                  aria-label="field"
                />
                <input
                  className="input publish-grow"
                  placeholder="value"
                  value={newField.value}
                  onChange={(e) => setNewField({ ...newField, value: e.target.value })}
                  aria-label="value"
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!newField.name.trim()}
                  onClick={() => {
                    patchField(newField.name.trim().toLowerCase(), newField.value);
                    setNewField({ name: '', value: '' });
                  }}
                >
                  {t('publish.citation.add_field')}
                </button>
              </div>

              <div className="publish-row publish-between">
                <div className="publish-mini-title">{t('publish.citation.format_preview')}</div>
                <select
                  className="select"
                  value={style}
                  onChange={(e) => setStyle(e.target.value as typeof style)}
                  aria-label={t('publish.common.style')}
                >
                  {CITATION_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="publish-citation-list">
                {CITATION_STYLES.map((s) => (
                  <div
                    key={s.id}
                    className={`publish-citation${s.id === style ? ' is-active' : ''}`}
                  >
                    <span className="publish-citation-style">{s.label}</span>
                    <span className="publish-citation-text">
                      {formatCitation(selected, s.id, { index: 1 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="publish-empty">{t('publish.citation.no_entry')}</div>
          )}

          <div className="publish-card">
            <div className="publish-row publish-between">
              <h3 className="publish-card-title">{t('publish.citation.cff')}</h3>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCffManual(null)}
              >
                {t('publish.citation.cff_generate')}
              </button>
            </div>
            <label className="publish-label">
              {t('publish.citation.cff_title')}
              <input
                className="input"
                value={cffTitle}
                onChange={(e) => {
                  setCffTitle(e.target.value);
                  setCffManual(null);
                }}
              />
            </label>
            <textarea
              className="publish-cff publish-mono"
              rows={12}
              value={cffText}
              onChange={(e) => setCffManual(e.target.value)}
              aria-label={t('publish.citation.cff')}
            />
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('publish.citation.delete_entry')}
        message={t('publish.common.delete_confirm', {
          name: deleteTarget?.fields.title || deleteTarget?.key || '',
        })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteLibraryEntry(deleteTarget.key);
            if (selectedKey === deleteTarget.key) setSelectedKey(null);
          }
          setDeleteTarget(null);
        }}
      />
    </ToolShell>
  );
}

function parseAuthors(entry: BibEntry) {
  const raw = entry.fields.author ?? entry.fields.editor ?? '';
  return raw
    .split(/\s+and\s+/i)
    .map((name) => {
      const clean = name.replace(/[{}]/g, '').trim();
      if (clean.includes(',')) {
        const [family = '', ...rest] = clean.split(',');
        return { family: family.trim(), given: rest.join(',').trim() };
      }
      const tokens = clean.split(/\s+/);
      const family = tokens.pop() ?? '';
      return { family, given: tokens.join(' ') };
    })
    .filter((a) => a.family);
}

function slugCffKey(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'software';
  return `${slug}${new Date().getFullYear()}`;
}

function ReferenceGraphSvg({
  graph,
  label,
}: {
  graph: ReturnType<typeof buildReferenceGraph>;
  label: string;
}) {
  const nodes = graph.nodes.slice(0, 18);
  const width = 360;
  const height = 190;
  const radius = Math.min(width, height) / 2 - 28;
  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.key, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  });
  if (nodes.length === 0) {
    return <p className="publish-hint">—</p>;
  }
  return (
    <svg
      className="publish-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {graph.edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.from}->${edge.to}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className="publish-edge"
          />
        );
      })}
      {nodes.map((node) => {
        const pos = positions.get(node.key)!;
        return (
          <g key={node.key}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={4 + Math.min(5, node.citedBy)}
              className="publish-node"
            />
            <title>{`${node.label} — cited by ${node.citedBy}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

