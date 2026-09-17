// ==========================================================================
// Ergalics Studio — Data Profiler page (F5 / FR5.1–FR5.8)
//
// Streaming profile (cancellable, progress by row) with the cache-fast-open
// guarantee: a profile is persisted in project.state.profiles keyed by file
// name + content fingerprint, so re-opening an unchanged file is instant
// (<100 ms). Renders score, issues, the numeric correlation matrix and
// per-column stats/histograms; exports a Markdown summary and sends column
// histograms to Figure Studio.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useResearchStore } from '@/stores/researchStore';
import { renderSVG } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import { Profiler, type ColumnSpec, type TableProfile } from '@/core/profiler/profile';
import { inferColumnKinds } from '@/core/profiler/profile';
import { fingerprint } from '@/core/chunked/reader';
import { resolveDataFile } from '@/core/dataFiles';
import { parseDataText } from '@/blocks/fileData';
import { downloadBlob } from '@/core/download';
import { groupedDataFiles, sendSpecToFigure, fmt } from '../research/researchUi';
import { ToolShell } from '@/components/ToolShell';

interface ScanState {
  profile: TableProfile;
  fp: string;
  cached: boolean;
  createdAt?: number;
}

const CHUNK = 20_000;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Histogram bin edges/counts → bar-chart PlotSpec. */
function numericHistogramSpec(name: string, h: { edges: number[]; counts: number[] }): PlotSpec {
  return {
    width: 320,
    height: 220,
    title: name,
    xLabel: name,
    yLabel: 'count',
    grid: true,
    series: [
      {
        name: 'count',
        kind: 'bar',
        color: '#0072B2',
        bars: h.counts.map((c, i) => ({ x0: h.edges[i]!, x1: h.edges[i + 1]!, y: c })),
      },
    ],
  };
}

function profileMarkdown(file: string, p: TableProfile): string {
  const lines: string[] = [];
  lines.push(`# Data profile — ${file}`, '');
  lines.push(`- rows: ${p.rows}`);
  lines.push(`- columns: ${p.columns.length}`);
  lines.push(`- quality score: ${(p.score * 100).toFixed(1)}/100`);
  lines.push(`- duplicate rate (est.): ${(p.duplicates.duplicateRate * 100).toFixed(2)}%`, '');
  if (p.issues.length > 0) {
    lines.push('## Issues', '');
    for (const i of p.issues) {
      lines.push(`- **[${i.severity}]** ${i.column ? `\`${i.column}\` — ` : ''}${i.message}`);
    }
    lines.push('');
  }
  lines.push('## Columns', '');
  for (const c of p.columns) {
    if (c.kind === 'numeric') {
      lines.push(
        `### ${c.name} (numeric, missing ${((c.missing / Math.max(1, c.n + c.missing)) * 100).toFixed(1)}%)`,
        '',
        `min ${fmt(c.min)} · max ${fmt(c.max)} · mean ${fmt(c.mean)} · sd ${fmt(c.sd)}`,
        `P1 ${fmt(c.q01)} · P25 ${fmt(c.q25)} · P50 ${fmt(c.q50)} · P75 ${fmt(c.q75)} · P99 ${fmt(c.q99)} · MAD ${fmt(c.mad)}`,
        `zeros ${c.zeros} · outliers ${c.outlierCount}`,
        '',
      );
    } else {
      lines.push(
        `### ${c.name} (text, missing ${c.missing})`,
        '',
        `distinct ≈ ${fmt(c.distinctEstimate)} · length ${c.minLength}/${fmt(c.avgLength, 2)}/${c.maxLength}`,
        c.topValues.map((v) => `${v.value}(${v.count})`).join(', '),
        '',
      );
    }
  }
  return lines.join('\n');
}

export default function ProfilerPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const saveProfile = useResearchStore((s) => s.saveProfile);
  const groups = useMemo(() => groupedDataFiles(), [project?.data.files]);

  const [file, setFile] = useState('');
  const [scanning, setScanning] = useState(false);
  const [rowsDone, setRowsDone] = useState(0);
  const [state, setState] = useState<ScanState | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // Tracks the currently selected file inside the async scan loop, so a
  // scan that finishes after the user switched files cannot land its result
  // (and its saved profile/export) under the new file's name.
  const fileRef = useRef(file);
  fileRef.current = file;

  // Abort any in-flight scan when leaving the page — the chunked loop and
  // its final saveProfile would otherwise keep running off-screen.
  useEffect(() => () => abortRef.current?.abort(), []);

  const cachedForFile = project?.state.profiles?.find((p) => p.fileName === file) ?? null;

  const scan = async (useCache: boolean) => {
    const scanFile = file;
    if (!scanFile) return;
    setError('');
    setState(null);
    const text = resolveDataFile(scanFile);
    if (text === undefined) {
      setError(`data file not found: ${scanFile}`);
      return;
    }
    const fp = fingerprint(text);
    const cache = project?.state.profiles?.find((p) => p.fileName === scanFile && p.fingerprint === fp);
    if (useCache && cache) {
      setState({ profile: cache.profile, fp, cached: true, createdAt: cache.createdAt });
      return;
    }

    let table: ReturnType<typeof parseDataText>;
    try {
      table = parseDataText(text, scanFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const names = table.columnNames();
    const n = table.length;

    // Infer kinds from the first 1 000 parsed rows (pure-core rule).
    const sampleRows: Array<Array<string | number | null>> = [];
    for (let i = 0; i < Math.min(1000, n); i += 1) {
      const row = table.getRow(i);
      sampleRows.push(names.map((name) => (row[name] as string | number | null) ?? null));
    }
    const specs: ColumnSpec[] = inferColumnKinds(names, sampleRows);
    const profiler = new Profiler(specs);

    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setRowsDone(0);
    try {
      for (let start = 0; start < n; start += CHUNK) {
        if (controller.signal.aborted || fileRef.current !== scanFile) return;
        const end = Math.min(n, start + CHUNK);
        const chunk: Array<Array<string | number | null>> = [];
        for (let i = start; i < end; i += 1) {
          const row = table.getRow(i);
          chunk.push(names.map((name) => (row[name] as string | number | null) ?? null));
        }
        profiler.addChunk(chunk);
        setRowsDone(end);
        await tick();
      }
      // The selection may have changed while the loop was yielding.
      if (controller.signal.aborted || fileRef.current !== scanFile) return;
      const profile = profiler.finalize();
      const now = Date.now();
      setState({ profile, fp, cached: false });
      saveProfile({ fileKey: scanFile, fingerprint: fp, fileName: scanFile, createdAt: now, profile });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setScanning(false);
      }
    }
  };

  const cancel = () => abortRef.current?.abort();

  const exportMd = () => {
    if (!state) return;
    downloadBlob(
      `${file.replace(/\.[^.]+$/, '')}.profile.md`,
      new TextEncoder().encode(profileMarkdown(file, state.profile)),
      'text/markdown',
    );
    notify('success', t('profile.exported'));
  };

  const sendHistograms = () => {
    if (!state) return;
    const nums = state.profile.columns.filter((c) => c.kind === 'numeric').slice(0, 6);
    let ok = true;
    nums.forEach((c) => {
      if (c.kind !== 'numeric') return;
      if (!sendSpecToFigure(t('profile.title'), numericHistogramSpec(c.name, c.histogram))) ok = false;
    });
    notify(ok ? 'success' : 'error', ok ? t('profile.figure_sent') : t('figure.export_failed', { reason: 'no project' }));
  };

  const p = state?.profile ?? null;
  const corr = p?.correlations ?? null;

  return (
    <ToolShell toolId="profiler">
      <div className="analysis-body">
        <div className="analysis-row">
          <select
            className="input"
            value={file}
            disabled={scanning}
            onChange={(e) => {
              // Abort the previous file's scan so its result can never be
              // shown/saved under the newly selected file.
              abortRef.current?.abort();
              setFile(e.target.value);
              setState(null);
              setError('');
            }}
          >
            <option value="">{t('analysis.select_file')}</option>
            {groups.project.map((n) => <option key={n} value={n}>{n}</option>)}
            {groups.examples.length > 0 && (
              <optgroup label={t('datafiles.group_examples')}>
                {groups.examples.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          {scanning ? (
            <button type="button" className="btn btn-danger" onClick={cancel}>{t('profile.cancel')}</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!file} onClick={() => void scan(true)}>
              {cachedForFile ? t('profile.rescan') : t('analysis.run')}
            </button>
          )}
        </div>

        {scanning && <p className="analysis-note">{t('profile.scanning', { rows: rowsDone })}</p>}
        {state?.cached && (
          <p className="analysis-note">
            {t('profile.cached', { date: new Date(state.createdAt ?? 0).toLocaleString() })}
            {' '}
            <button type="button" className="btn btn-sm" onClick={() => void scan(false)}>
              {t('profile.rescan')}
            </button>
          </p>
        )}
        {error && <p className="analysis-error">{error}</p>}

        {p && (
          <>
            <div className="profile-summary">
              <span className="profile-score">{(p.score * 100).toFixed(0)}/100</span>
              <span>{t('profile.rows')}: <strong>{p.rows}</strong></span>
              <span>{t('profile.columns')}: <strong>{p.columns.length}</strong></span>
              <span>{t('profile.duplicates')}: <strong>{(p.duplicates.duplicateRate * 100).toFixed(1)}%</strong></span>
              <button type="button" className="btn btn-sm" onClick={exportMd}>{t('profile.export_md')}</button>
              <button type="button" className="btn btn-sm" onClick={sendHistograms}>{t('profile.to_figure')}</button>
            </div>

            {p.issues.length > 0 && (
              <div className="profile-issues">
                <h4 className="share-section-title">{t('profile.issues')}</h4>
                <ul className="profile-issue-list">
                  {p.issues.map((issue, i) => (
                    <li key={i} className={`profile-issue profile-issue-${issue.severity}`}>
                      <span className={`profile-badge profile-badge-${issue.severity}`}>
                        {t(`profile.severity_${issue.severity}`)}
                      </span>
                      {issue.column && <code>{issue.column}</code>} {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {corr && corr.names.length > 1 && (
              <div className="profile-corr">
                <h4 className="share-section-title">{t('profile.correlations')}</h4>
                <table className="sweep-table">
                  <thead>
                    <tr>
                      <th></th>
                      {corr.names.map((n) => <th key={n}>{n}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {corr.pearson.map((row, i) => (
                      <tr key={corr.names[i]}>
                        <th>{corr.names[i]}</th>
                        {row.map((v, j) => (
                          <td key={j} className="profile-corr-cell" title={`r=${fmt(v, 4)}`}>
                            <span
                              className="profile-corr-dot"
                              style={{
                                background: v > 0 ? `rgba(213,94,0,${Math.abs(v)})` : `rgba(0,114,178,${Math.abs(v)})`,
                              }}
                            />
                            {fmt(v, 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="profile-columns">
              {p.columns.map((c) => (
                <div key={c.name} className="profile-column-card">
                  <h5>
                    {c.name}{' '}
                    <span className="figures-panel-meta">
                      {c.kind === 'numeric' ? t('profile.column_numeric') : t('profile.column_text')}
                    </span>
                  </h5>
                  {c.kind === 'numeric' ? (
                    <>
                      <div className="profile-stat-grid">
                        <span><em>{t('profile.missing')}</em> {c.missing}</span>
                        <span><em>{t('profile.zeros')}</em> {c.zeros}</span>
                        <span><em>{t('profile.min')}</em> {fmt(c.min)}</span>
                        <span><em>{t('profile.max')}</em> {fmt(c.max)}</span>
                        <span><em>{t('profile.mean')}</em> {fmt(c.mean)}</span>
                        <span><em>{t('profile.sd')}</em> {fmt(c.sd)}</span>
                        <span><em>{t('profile.q25')}</em> {fmt(c.q25)}</span>
                        <span><em>{t('profile.q50')}</em> {fmt(c.q50)}</span>
                        <span><em>{t('profile.q75')}</em> {fmt(c.q75)}</span>
                        <span><em>{t('profile.mad')}</em> {fmt(c.mad)}</span>
                        <span><em>{t('profile.outliers')}</em> {c.outlierCount}</span>
                      </div>
                      <div className="analysis-svg profile-hist" dangerouslySetInnerHTML={{ __html: renderSVG(numericHistogramSpec(c.name, c.histogram)) }} />
                    </>
                  ) : (
                    <>
                      <div className="profile-stat-grid">
                        <span><em>{t('profile.missing')}</em> {c.missing}</span>
                        <span><em>{t('profile.distinct')}</em> ≈{fmt(c.distinctEstimate)}</span>
                        <span><em>{t('profile.lengths')}</em> {c.minLength}/{fmt(c.avgLength, 1)}/{c.maxLength}</span>
                      </div>
                      <ul className="profile-top">
                        {c.topValues.map((v) => (
                          <li key={v.value}><code>{v.value}</code> × {v.count}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}
