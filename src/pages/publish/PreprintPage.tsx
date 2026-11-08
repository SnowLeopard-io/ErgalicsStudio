// ==========================================================================
// Ergalics Studio — preprint publishing (/studio/preprint)
//
// Packages the active manuscript as an arXiv-compatible archive: main.tex,
// references.bib, referenced Figure Studio SVGs, a reproducibility badge
// derived from the project's repro.lock, CITATION.cff and a manifest. The
// one-click reproduce link reopens the locked project, and "save snapshot"
// writes the package into `preprints/<slug>/` and commits it through the
// browser Git adapter.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { usePublishStore } from '@/stores/publishStore';
import { downloadBlob } from '@/core/download';
import { sanitizeSvg } from '@/core/sanitize/sanitizeSvg';
import { buildLock, lockToJson } from '@/core/repro/lock';
import {
  buildArxivMetadata,
  buildArxivPackage,
  buildReproduceLink,
  buildReproducibilityBadge,
  zipArxivPackage,
} from '@/core/publish/preprint';
import { figureSheetPath, figureSheetSvg, referencedFigures } from '@/core/publish/bridge';
import { toCitationCff } from '@/core/publish/citation';
import { toBibtex } from '@/core/publish/bibtex';
import { figureSlug } from '@/core/publish/bridge';
import type { PreprintRecord } from '@/core/publish/state';
import type { FigureSheet } from '@/types/project';
import { usePublishState, writePublishArtifacts, copyText } from './shared';

const EMPTY_SHEETS: FigureSheet[] = [];

interface ParsedManuscript {
  title: string;
  authors: string[];
  abstract: string;
}

function extractBraced(source: string, command: string): string {
  const start = source.indexOf(`\\${command}{`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i).trim();
    }
  }
  return '';
}

function parseManuscript(source: string, fallbackTitle: string): ParsedManuscript {
  const title = extractBraced(source, 'title') || fallbackTitle;
  const authors = extractBraced(source, 'author')
    .split(/\\and/)
    .map((name) => name.replace(/\\thanks\{[^{}]*\}/g, '').replace(/[{}]/g, '').trim())
    .filter(Boolean);
  const abstractStart = source.indexOf('\\begin{abstract}');
  const abstractEnd = source.indexOf('\\end{abstract}');
  const abstract =
    abstractStart >= 0 && abstractEnd > abstractStart
      ? source.slice(abstractStart + '\\begin{abstract}'.length, abstractEnd).trim()
      : '';
  return { title, authors, abstract };
}

export default function PreprintPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const runs = useExperimentStore((s) => s.runs);
  const publish = usePublishState();
  const saveManuscript = usePublishStore((s) => s.saveManuscript);
  const addPreprint = usePublishStore((s) => s.addPreprint);
  const deletePreprint = usePublishStore((s) => s.deletePreprint);

  const manuscripts = publish.manuscripts;
  const active =
    manuscripts.find((m) => m.id === publish.activeManuscriptId) ?? manuscripts[0] ?? null;
  const sheets = project?.state.figureSheets ?? EMPTY_SHEETS;

  const [categories, setCategories] = useState('cs.SE');
  const [comments, setComments] = useState('');
  const [doi, setDoi] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PreprintRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  useEffect(() => {
    setGeneratedAt(new Date());
  }, [active?.id]);
  const lock = useMemo(() => (project ? buildLock(project, { runs }) : null), [project, runs]);
  const lockJson = useMemo(() => (lock ? lockToJson(lock) : null), [lock]);

  const parsed = useMemo(
    () => (active ? parseManuscript(active.source, active.name) : null),
    [active],
  );

  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://example.org';
  const reproduceUrl = project
    ? buildReproduceLink(baseUrl, project.id, lock?.code.hash)
    : '';

  const badgeSvg = useMemo(() => {
    if (!project) return '';
    return buildReproducibilityBadge({
      projectName: project.name,
      version: project.metadata.version,
      dataHash: lock?.data[0]?.hash,
      lockHash: lock?.code.hash,
      environment: typeof navigator !== 'undefined' ? navigator.platform : undefined,
      generatedAt,
      reproduceUrl: reproduceUrl || undefined,
    });
  }, [project, lock, generatedAt, reproduceUrl]);

  const pkg = useMemo(() => {
    if (!project || !active || !parsed) return null;
    const wanted = new Set(referencedFigures(active.source));
    const figures = sheets
      .filter((sheet) => {
        const path = figureSheetPath(sheet);
        return wanted.has(path.replace(/^figures\//, '')) || wanted.has(path);
      })
      .map((sheet) => ({
        name: figureSheetPath(sheet).replace(/^figures\//, ''),
        svg: figureSheetSvg(sheet),
      }));
    const cffText = toCitationCff({
      cffVersion: '1.2.0',
      message: 'If you use this work, please cite it as below.',
      title: parsed.title,
      authors: parsed.authors.map((name) => {
        // "Family, Given" (LaTeX convention) keeps the whole name intact now
        // that \and authors stay separate; only the comma inside a name splits.
        if (name.includes(',')) {
          const [family = '', ...rest] = name.split(',');
          return { family: family.trim(), given: rest.join(',').trim() };
        }
        const tokens = name.trim().split(/\s+/);
        const family = tokens.pop() ?? name;
        return { family, given: tokens.join(' ') };
      }).filter((a) => a.family),
      year: String(new Date().getFullYear()),
      version: project.metadata.version,
      doi: doi || undefined,
      url: reproduceUrl || undefined,
    });
    return buildArxivPackage({
      source: active.source,
      metadata: buildArxivMetadata(
        {
          title: parsed.title,
          authors: parsed.authors.map((name) => ({ name: name.trim() })),
          abstract: parsed.abstract,
        },
        {
          categories: categories.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean),
          comments: comments || undefined,
          doi: doi || undefined,
        },
      ),
      entries: publish.library,
      bibtex: toBibtex(publish.library),
      figures,
      project: {
        id: project.id,
        name: project.name,
        description: project.metadata.description,
        tags: project.metadata.tags,
        version: project.metadata.version,
      },
      lock: lockJson,
      citationCff: cffText,
      badgeSvg,
      generatedAt,
    });
  }, [
    project, active, parsed, sheets, publish.library, lockJson, badgeSvg,
    generatedAt, categories, comments, doi, reproduceUrl,
  ]);

  const downloadZip = () => {
    if (!pkg) return;
    downloadBlob(pkg.fileName, zipArxivPackage(pkg), 'application/zip');
  };

  const saveSnapshot = async () => {
    if (!project || !active || !parsed || !pkg || saving) return;
    setSaving(true);
    try {
      const prefix = `preprints/${figureSlug(active.name)}`;
      const files = Object.entries(pkg.files)
        .filter(([path]) => path.endsWith('.tex') || path.endsWith('.bib') || path.endsWith('.json') || path.endsWith('.cff') || path.endsWith('.svg') || path.endsWith('.txt'))
        .map(([path, bytes]) => ({ path: `${prefix}/${path}`, content: new TextDecoder().decode(bytes) }));
      await writePublishArtifacts(files, `preprint ${parsed.title}`);
      addPreprint({
        id: crypto.randomUUID(),
        name: parsed.title,
        fileName: pkg.fileName,
        createdAt: Date.now(),
        manifest: pkg.manifest,
        badgeSvg,
        hasLock: Boolean(lockJson),
        reproduceUrl,
      });
      notify('success', t('publish.preprint.saved'));
    } catch (err) {
      notify('error', t('publish.common.error', { reason: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (await copyText(reproduceUrl)) notify('success', t('publish.common.copied'));
  };

  const fileList = pkg ? Object.keys(pkg.files).sort() : [];
  const packageCff = pkg?.files['CITATION.cff']
    ? new TextDecoder().decode(pkg.files['CITATION.cff'])
    : '';

  return (
    <ToolShell toolId="preprint">
      <div className="publish-page">
        <section className="publish-main">
          <div className="publish-card">
            <div className="publish-row publish-between publish-wrap">
              <h3 className="publish-card-title">{t('publish.preprint.manuscript')}</h3>
              {manuscripts.length > 0 && (
                <select
                  className="select"
                  value={active?.id ?? ''}
                  onChange={(e) => {
                    const next = manuscripts.find((m) => m.id === e.target.value);
                    if (next) saveManuscript(next);
                  }}
                  aria-label={t('publish.preprint.manuscript')}
                >
                  {manuscripts.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
            {!active ? (
              <p className="publish-hint">{t('publish.preprint.source_missing')}</p>
            ) : (
              <>
                <div className="publish-field-grid">
                  <label className="publish-label">
                    {t('publish.preprint.categories')}
                    <input
                      className="input"
                      value={categories}
                      onChange={(e) => setCategories(e.target.value)}
                    />
                  </label>
                  <label className="publish-label">
                    {t('publish.preprint.doi')}
                    <input
                      className="input"
                      value={doi}
                      onChange={(e) => setDoi(e.target.value)}
                    />
                  </label>
                </div>
                <label className="publish-label">
                  {t('publish.preprint.comments')}
                  <input
                    className="input"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                  />
                </label>
                <div className="publish-meta-grid">
                  <div>
                    <div className="publish-mini-title">{t('publish.preprint.metadata')}</div>
                    <p className="publish-mono">{parsed?.title}</p>
                    <p className="publish-muted">{parsed?.authors.join(', ') || '—'}</p>
                    <p className="publish-hint">{parsed?.abstract || '—'}</p>
                  </div>
                  <div>
                    <div className="publish-mini-title">{t('publish.preprint.figures')}</div>
                    <p className="publish-hint">{t('publish.preprint.interactive_desc')}</p>
                    <ul className="publish-plain-list">
                      {sheets
                        .filter((sheet) => {
                          const wanted = new Set(referencedFigures(active.source));
                          const path = figureSheetPath(sheet);
                          return wanted.has(path.replace(/^figures\//, '')) || wanted.has(path);
                        })
                        .map((sheet) => (
                          <li key={sheet.id}>
                            <span className="publish-mono">{figureSheetPath(sheet)}</span>
                          </li>
                        ))}
                    </ul>
                    {lockJson ? (
                      <p className="publish-success">{t('publish.preprint.lock_included')}</p>
                    ) : (
                      <p className="publish-hint">{t('publish.preprint.no_lock')}</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="publish-grid-2">
            <div className="publish-card">
              <h3 className="publish-card-title">{t('publish.preprint.badge')}</h3>
              <div
                className="publish-badge"
                // Badge SVG is generated locally by buildReproducibilityBadge.
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(badgeSvg) }}
              />
              <p className="publish-hint">{t('publish.preprint.badge_desc')}</p>
              <div className="publish-mini-title">{t('publish.preprint.reproduce_link')}</div>
              <div className="publish-row">
                <input
                  className="input publish-mono publish-grow"
                  readOnly
                  value={reproduceUrl}
                  aria-label={t('publish.preprint.reproduce_link')}
                />
                <button type="button" className="btn btn-sm" onClick={() => void copyLink()}>
                  {t('publish.preprint.copy_link')}
                </button>
              </div>
            </div>

            <div className="publish-card">
              <h3 className="publish-card-title">{t('publish.preprint.package')}</h3>
              <p className="publish-hint">
                {t('publish.preprint.files', { n: String(fileList.length) })}
              </p>
              <ul className="publish-plain-list publish-file-list">
                {fileList.map((file) => (
                  <li key={file} className="publish-mono">{file}</li>
                ))}
              </ul>
              <div className="publish-row">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!pkg}
                  onClick={downloadZip}
                >
                  {t('publish.preprint.download')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!pkg || saving}
                  onClick={() => void saveSnapshot()}
                >
                  {t('publish.preprint.save_snapshot')}
                </button>
              </div>
            </div>
          </div>

          <div className="publish-card">
            <h3 className="publish-card-title">{t('publish.preprint.history')}</h3>
            {publish.preprints.length === 0 ? (
              <p className="publish-hint">{t('publish.preprint.no_history')}</p>
            ) : (
              <ul className="publish-plain-list">
                {publish.preprints.map((record) => (
                  <li key={record.id} className="publish-preprint-row">
                    <div>
                      <strong>{record.name}</strong>
                      <div className="publish-muted">
                        {new Date(record.createdAt).toLocaleString()} · {record.fileName} ·{' '}
                        {record.hasLock ? t('publish.preprint.lock_included') : '—'}
                      </div>
                    </div>
                    <div className="publish-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!record.reproduceUrl}
                        onClick={() => {
                          if (record.reproduceUrl) void copyText(record.reproduceUrl);
                        }}
                      >
                        {t('publish.preprint.copy_link')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setDeleteTarget(record)}
                      >
                        {t('publish.common.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className="publish-card">
            <summary className="publish-card-title">{t('publish.citation.cff')}</summary>
            <pre className="publish-cff publish-mono">{packageCff}</pre>
          </details>
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('publish.common.delete')}
        message={t('publish.common.delete_confirm', { name: deleteTarget?.name ?? '' })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deletePreprint(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </ToolShell>
  );
}
