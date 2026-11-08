// ==========================================================================
// Ergalics Studio — synthetic data page (/studio/synth).
//
// Standalone research tool over the pure core kernel (src/core/dataeng/synth):
// CSV upload, generation options (rows / seed / mode / privacy budget), a
// column-by-column quality report (KS / TVD / correlation gap / overall
// score), original-vs-synthetic distribution histograms and CSV / metrics
// exports. Academic, low-saturation style; all copy from global i18n.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import {
  generateSynthetic,
  parseCsvTable,
  parseNum,
  toCsv,
} from '@/core/dataeng/synth';
import type { PrivacyMode, SynthMode, SynthResult, SynthTable } from '@/core/dataeng/synth';
import { downloadBlob } from '@/core/download';
import { ToolShell } from '@/components/ToolShell';

const MODES: readonly SynthMode[] = ['copula', 'independent', 'timeseries'];
const PRIVACY_MODES: readonly PrivacyMode[] = ['none', 'dp', 'k-anonymity'];

const HIST_BINS = 24;
const HIST_COLUMN_CAP = 4;

/** Shared numeric columns of two tables, capped for the histogram panel. */
function sharedNumericColumns(original: SynthTable, synthetic: SynthTable): string[] {
  const out: string[] = [];
  for (const name of original.columns) {
    if (!synthetic.columns.includes(name)) continue;
    const oi = original.columns.indexOf(name);
    let numeric = false;
    for (const row of original.rows) {
      if (parseNum(String(row[oi] ?? '')) !== null) {
        numeric = true;
        break;
      }
    }
    if (numeric) out.push(name);
    if (out.length >= HIST_COLUMN_CAP) break;
  }
  return out;
}

function columnNumbers(table: SynthTable, column: string): number[] {
  const idx = table.columns.indexOf(column);
  if (idx < 0) return [];
  const out: number[] = [];
  for (const row of table.rows) {
    const v = parseNum(String(row[idx] ?? ''));
    if (v !== null) out.push(v);
  }
  return out;
}

function fmt(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

// ---- histogram canvas --------------------------------------------------------

/** Overlaid density histograms (original in blue, synthetic in orange). */
function CompareHistogram({
  original,
  synthetic,
  column,
}: {
  original: SynthTable;
  synthetic: SynthTable;
  column: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(parent.clientWidth, 240);
    const height = 200;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const a = columnNumbers(original, column);
    const b = columnNumbers(synthetic, column);
    if (a.length < 2 || b.length < 2) return;

    const lo = Math.min(Math.min(...a), Math.min(...b));
    const hi = Math.max(Math.max(...a), Math.max(...b));
    if (!(hi > lo)) return;
    const binWidth = (hi - lo) / HIST_BINS;

    const density = (values: number[]): number[] => {
      const counts = new Array<number>(HIST_BINS).fill(0);
      for (const v of values) {
        let bin = Math.floor((v - lo) / binWidth);
        if (bin < 0) bin = 0;
        if (bin >= HIST_BINS) bin = HIST_BINS - 1;
        counts[bin] = (counts[bin] ?? 0) + 1;
      }
      return counts.map((c) => c / values.length / binWidth);
    };
    const da = density(a);
    const db = density(b);
    const peak = Math.max(...da, ...db) || 1;

    const padL = 8;
    const padB = 18;
    const plotW = width - padL * 2;
    const plotH = height - padB - 6;
    const barW = plotW / HIST_BINS;
    const scale = (d: number[]): void => {
      ctx.beginPath();
      for (let i = 0; i < HIST_BINS; i += 1) {
        const h = (d[i]! / peak) * plotH;
        ctx.rect(padL + i * barW, 6 + plotH - h, barW, h);
      }
      ctx.fill();
    };
    // Wide series first, narrow on top; both semi-transparent.
    ctx.fillStyle = 'rgba(0, 114, 178, 0.55)';
    scale(da);
    ctx.fillStyle = 'rgba(213, 94, 0, 0.55)';
    scale(db);

    // Baseline + range labels.
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, 6 + plotH + 0.5);
    ctx.lineTo(width - padL, 6 + plotH + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(128, 128, 128, 0.9)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmt(lo, 2), padL, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(hi, 2), width - padL, height - 4);
  }, [original, synthetic, column]);

  return <canvas ref={canvasRef} className="synth-histogram" />;
}

// ---- page ----------------------------------------------------------------------

export function SynthPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<SynthTable | null>(null);
  const [result, setResult] = useState<SynthResult | null>(null);
  const [activeColumn, setActiveColumn] = useState<string>('');

  const [rows, setRows] = useState(500);
  const [seed, setSeed] = useState(42);
  const [mode, setMode] = useState<SynthMode>('copula');
  const [privacy, setPrivacy] = useState<PrivacyMode>('none');
  const [epsilon, setEpsilon] = useState(1.0);
  const [k, setK] = useState(5);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const text = await file.text();
      const table = parseCsvTable(text);
      if (!table || table.columns.length === 0) {
        notify('error', t('synth.parse_failed'));
        return;
      }
      setSource(table);
      setResult(null);
      notify('success', t('synth.loaded', { rows: table.rows.length, cols: table.columns.length }));
    } catch {
      notify('error', t('synth.parse_failed'));
    }
  };

  const generate = (): void => {
    if (!source) {
      notify('error', t('synth.no_source'));
      return;
    }
    const out = generateSynthetic(source, {
      rows,
      seed,
      mode,
      privacy,
      epsilon,
      k,
    });
    setResult(out);
    const numerics = sharedNumericColumns(source, out.table);
    setActiveColumn(numerics[0] ?? '');
    notify('success', t('synth.done', { rows: out.table.rows.length, ms: out.runtimeMs }));
  };

  const exportCsv = async (): Promise<void> => {
    if (!result) {
      notify('error', t('synth.export_none'));
      return;
    }
    await downloadBlob('synthetic-data.csv', toCsv(result.table), 'text/csv;charset=utf-8');
    notify('success', t('synth.export_done', { name: 'synthetic-data.csv' }));
  };

  const exportMetrics = async (): Promise<void> => {
    if (!result) {
      notify('error', t('synth.export_none'));
      return;
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      seed: result.seed,
      mode: result.mode,
      requestedRows: result.requestedRows,
      privacy: result.privacy,
      skipped: result.skipped,
      runtimeMs: result.runtimeMs,
      quality: {
        overall: result.report.overall,
        meanKs: result.report.meanKs,
        meanTvd: result.report.meanTvd,
        corrAbsDiff: result.report.corrAbsDiff,
        missingRateDiff: result.report.missingRateDiff,
        perColumn: result.report.perColumn,
      },
    };
    await downloadBlob(
      'synthetic-quality.json',
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
    notify('success', t('synth.export_done', { name: 'synthetic-quality.json' }));
  };

  const histColumns = useMemo(
    () => (source && result ? sharedNumericColumns(source, result.table) : []),
    [source, result],
  );

  const report = result?.report ?? null;

  return (
    <ToolShell toolId="synth">
      <div className="analysis-body">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {/* --- source data --- */}
        <div className="share-section-title">{t('synth.source_title')}</div>
        <div className="analysis-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t('synth.upload')}
          </button>
          {source && (
            <span className="figures-panel-meta">
              {t('synth.rows_label', { rows: source.rows.length })} ·{' '}
              {t('synth.cols_label', { cols: source.columns.length })} ·{' '}
              {source.columns.join(', ')}
            </span>
          )}
        </div>

        {/* --- generation options --- */}
        <div className="share-section-title">{t('synth.params_title')}</div>
        <div className="analysis-row synth-params">
          <label className="synth-field">
            <span className="synth-field-label">{t('synth.n_rows')}</span>
            <input
              type="number"
              className="input"
              min={1}
              max={100000}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
          <label className="synth-field">
            <span className="synth-field-label">{t('synth.seed')}</span>
            <input
              type="number"
              className="input"
              value={seed}
              onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))}
            />
          </label>
          <label className="synth-field">
            <span className="synth-field-label">{t('synth.mode')}</span>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as SynthMode)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`synth.mode_${m.replace('-', '_')}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="synth-field">
            <span className="synth-field-label">{t('synth.privacy')}</span>
            <select
              className="input"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as PrivacyMode)}
            >
              {PRIVACY_MODES.map((p) => (
                <option key={p} value={p}>
                  {t(`synth.privacy_${p.replace('-', '_')}`)}
                </option>
              ))}
            </select>
          </label>
          {privacy === 'dp' && (
            <label className="synth-field">
              <span className="synth-field-label">{t('synth.epsilon')}</span>
              <input
                type="number"
                className="input"
                min={0.01}
                step={0.1}
                value={epsilon}
                onChange={(e) => setEpsilon(Math.max(0.01, Number(e.target.value) || 0.01))}
              />
            </label>
          )}
          {privacy === 'k-anonymity' && (
            <label className="synth-field">
              <span className="synth-field-label">{t('synth.k_min')}</span>
              <input
                type="number"
                className="input"
                min={2}
                value={k}
                onChange={(e) => setK(Math.max(2, Math.floor(Number(e.target.value) || 2)))}
              />
            </label>
          )}
          <button type="button" className="btn btn-primary" onClick={generate}>
            {t('synth.generate')}
          </button>
        </div>

        {/* --- quality report --- */}
        {report && (
          <>
            <div className="share-section-title">{t('synth.metrics_title')}</div>
            <div className="analysis-row">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('synth.metric')}</th>
                    <th>{t('synth.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{t('synth.overall')}</td>
                    <td className="mono">{fmt(report.overall)}</td>
                  </tr>
                  <tr>
                    <td>{t('synth.mean_ks')}</td>
                    <td className="mono">{fmt(report.meanKs)}</td>
                  </tr>
                  <tr>
                    <td>{t('synth.mean_tvd')}</td>
                    <td className="mono">{fmt(report.meanTvd)}</td>
                  </tr>
                  <tr>
                    <td>{t('synth.corr_diff')}</td>
                    <td className="mono">{fmt(report.corrAbsDiff)}</td>
                  </tr>
                  <tr>
                    <td>{t('synth.missing_diff')}</td>
                    <td className="mono">{fmt(report.missingRateDiff)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="analysis-row">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('synth.col_metric')}</th>
                    <th>{t('synth.col_kind')}</th>
                    <th>KS</th>
                    <th>TVD</th>
                    <th>{t('synth.similarity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perColumn.map((d) => (
                    <tr key={d.column}>
                      <td className="mono">{d.column}</td>
                      <td>{t(`synth.kind_${d.kind}`)}</td>
                      <td className="mono">{fmt(d.ks)}</td>
                      <td className="mono">{fmt(d.tvd)}</td>
                      <td className="mono">{fmt(d.similarity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* --- distribution comparison --- */}
        {source && result && histColumns.length > 0 && (
          <>
            <div className="share-section-title">{t('synth.hist_title')}</div>
            <div className="analysis-row synth-hist-tabs">
              {histColumns.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`btn ${activeColumn === name ? 'btn-primary' : ''}`}
                  onClick={() => setActiveColumn(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            {activeColumn && (
              <div className="synth-hist-wrap">
                <div className="synth-hist-legend">
                  <span className="synth-swatch synth-swatch-orig" />
                  {t('synth.hist_orig')}
                  <span className="synth-swatch synth-swatch-synth" />
                  {t('synth.hist_synth')}
                </div>
                <CompareHistogram
                  original={source}
                  synthetic={result.table}
                  column={activeColumn}
                />
              </div>
            )}
          </>
        )}

        {/* --- skipped / privacy / export --- */}
        {result && (
          <>
            <div className="share-section-title">{t('synth.notes_title')}</div>
            <div className="analysis-row">
              <div className="schema-list">
                <div>
                  {t('synth.runtime', { ms: result.runtimeMs })} ·{' '}
                  {t('synth.requested', { rows: result.requestedRows })} ·{' '}
                  {t('synth.generated_rows', { rows: result.table.rows.length })}
                </div>
                {result.privacy.mode === 'dp' && (
                  <div>
                    {t('synth.privacy_note_dp', { epsilon: result.privacy.epsilon ?? 0 })}
                  </div>
                )}
                {result.privacy.mode === 'k-anonymity' && (
                  <div>
                    {t('synth.privacy_note_kanon', {
                      k: result.privacy.k ?? 0,
                      min: result.privacy.minClassSize ?? '—',
                      suppressed: result.privacy.suppressed ?? 0,
                    })}
                  </div>
                )}
                {result.skipped.length === 0 ? (
                  <div>{t('synth.skipped_none')}</div>
                ) : (
                  result.skipped.map((s) => (
                    <div key={s.column}>
                      <span className="mono">{s.column}</span> — {s.reason}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <div className="analysis-row">
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            {t('synth.export_csv')}
          </button>
          <button type="button" className="btn" onClick={() => void exportMetrics()}>
            {t('synth.export_metrics')}
          </button>
        </div>
      </div>
    </ToolShell>
  );
}

export default SynthPage;
