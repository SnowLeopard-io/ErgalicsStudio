// ==========================================================================
// Ergalics Studio — Model Lab page (F4 / FR4.1–FR4.7)
//
// Target + predictor columns → OLS / logistic / ridge (K-fold CV) /
// univariate polynomial. Coefficient table (se/t/p/CI), model summaries,
// confusion matrix for logistic fits, and the 2×2 diagnostic quartet for
// least-squares fits (sent to Figure Studio as one multi-panel sheet).
// Fits can be recorded in experiment history (source 'model').
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { renderSVG } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import { ols, type OlsResult } from '@/core/model/ols';
import { logisticFit, type LogisticResult } from '@/core/model/logistic';
import { ridgeCV, type RidgeResult } from '@/core/model/ridge';
import { polyFit, type PolyResult } from '@/core/model/poly';
import { diagnosticSeries, type DiagnosticSeries } from '@/core/model/diagnostics';
import { std } from '@/core/stats';
import type { NarrativeInput } from '@/core/stats/narrative';
import { tabularDataGroups, loadTable, sendSpecToFigure, fmt } from '../research/researchUi';
import { DATA_EXTS_SERIES } from '@/core/dataFiles';
import { ToolShell } from '@/components/ToolShell';
import { NarrativePanel } from '@/components/NarrativePanel';

type ModelKind = 'ols' | 'logistic' | 'ridge' | 'poly';

const LARGE_N = 200_000;

interface FitOutcome {
  kind: ModelKind;
  coefficients: Array<{ name: string; coef: number; se?: number; stat?: number; p?: number; lo?: number; hi?: number }>;
  lines: string[];
  ols?: OlsResult;
  logistic?: LogisticResult;
  ridge?: RidgeResult;
  diagnosticSpecs: PlotSpec[];
  metrics: Record<string, number>;
  sampled: boolean;
}

const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7'];

function scatterSpec(title: string, xLabel: string, yLabel: string, xs: number[], ys: number[]): PlotSpec {
  const n = xs.length;
  const step = Math.max(1, Math.floor(n / 900));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += step) pts.push({ x: xs[i]!, y: ys[i]! });
  return {
    width: 330,
    height: 250,
    title,
    xLabel,
    yLabel,
    grid: true,
    series: [{ name: title, kind: 'scatter', color: PALETTE[0]!, points: pts }],
  };
}

function quartetSpecs(d: DiagnosticSeries): PlotSpec[] {
  return [
    scatterSpec('residuals vs fitted', 'fitted', 'residual', d.fitted, d.residuals),
    scatterSpec('normal Q-Q', 'theoretical', 'sample', d.qqTheoretical, d.qqSample),
    scatterSpec('scale-location', 'fitted', '√|std resid|', d.fitted, d.scaleLocation),
    scatterSpec("leverage vs Cook's D", 'leverage', "Cook's D", d.leverage, d.cooksD),
  ];
}

/**
 * Convert an OLS fit into an FR-02 regression narrative: global F test plus
 * the first predictor's standardized coefficient (β = b·sd_x/sd_y).
 */
function olsNarrative(r: OlsResult, y: number[], X: number[][]): NarrativeInput | null {
  if (!Number.isFinite(r.f)) return null;
  const k = r.p - 1;
  const sy = std(y);
  const first = r.coefficients[1];
  const sx = X[0] ? std(Array.from(X[0])) : 0;
  return {
    kind: 'regression',
    f: r.f,
    df: [k, r.df],
    pValue: r.fP,
    r2: r.r2,
    predictor:
      first && sy > 0 && sx > 0
        ? { name: first.name, beta: (first.coef * sx) / sy, t: first.t, df: r.df, pValue: first.p }
        : undefined,
  };
}

/** Fixed-seed reservoir-ish sampling for the FR4.7 big-data guard. */
function sampleRows(n: number, cap: number, seed = 20240501): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const idx = Array.from({ length: cap }, (_, i) => i);
  for (let i = cap; i < n; i += 1) {
    const j = Math.floor(rand() * (i + 1));
    if (j < cap) idx[j] = i;
  }
  return idx.sort((a, b) => a - b);
}

export default function ModelLabPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const recordRun = useExperimentStore((s) => s.recordRun);
  const fileGroups = useMemo(() => tabularDataGroups(DATA_EXTS_SERIES), [project?.data.files]);

  const [file, setFile] = useState('');
  const [target, setTarget] = useState('');
  const [predictors, setPredictors] = useState<string[]>([]);
  const [kind, setKind] = useState<ModelKind>('ols');
  const [degree, setDegree] = useState('2');
  const [folds, setFolds] = useState('5');
  const [threshold, setThreshold] = useState('0.5');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<FitOutcome | null>(null);
  const [narrativeInput, setNarrativeInput] = useState<NarrativeInput | null>(null);

  const cols = useMemo(() => {
    if (!file) return [] as string[];
    try {
      return loadTable(file).numericCols;
    } catch {
      return [];
    }
  }, [file]);

  const selectFile = (name: string) => {
    setFile(name);
    setTarget('');
    setPredictors([]);
    setOutcome(null);
    setError('');
  };

  const togglePredictor = (name: string) => {
    // A fit on the previous predictor set must not stay on screen: Record
    // reads the live form state, so a stale outcome would be logged under the
    // new predictors.
    setOutcome(null);
    setPredictors((arr) =>
      kind === 'poly' ? [name] : arr.includes(name) ? arr.filter((c) => c !== name) : [...arr, name],
    );
  };

  const fit = () => {
    setError('');
    setOutcome(null);
    setNarrativeInput(null);
    if (!file || !target) {
      setError(t('model.need_two'));
      return;
    }
    if (kind !== 'poly' && predictors.length === 0) {
      setError(t('model.need_two'));
      return;
    }
    if (kind === 'poly' && predictors.length !== 1) {
      setError(t('model.need_two'));
      return;
    }
    try {
      const { table } = loadTable(file);
      const fullY = Array.from((table.getColumn(target) as Float64Array | undefined) ?? []) as number[];
      const fullXs = predictors.map((c) =>
        Array.from((table.getColumn(c) as Float64Array | undefined) ?? []) as number[],
      );
      const idx = sampleRows(fullY.length, LARGE_N);
      const sampled = idx.length !== fullY.length;
      const y = idx.map((i) => fullY[i]!);
      const X = fullXs.map((col) => idx.map((i) => col[i]!));

      if (kind === 'logistic' && y.some((v) => v !== 0 && v !== 1)) {
        setError(t('model.need_two'));
        return;
      }

      if (kind === 'ols') {
        const rows = X[0]!.map((_, i) => X.map((col) => col[i]!));
        const r = ols(y, rows, predictors);
        setNarrativeInput(olsNarrative(r, y, X));
        setOutcome({
          kind,
          coefficients: r.coefficients.map((c) => ({
            name: c.name, coef: c.coef, se: c.se, stat: c.t, p: c.p, lo: c.ciLow, hi: c.ciHigh,
          })),
          lines: [
            `${t('model.n_obs')}: ${r.n}`,
            `${t('model.r2')}: ${fmt(r.r2, 5)}  ${t('model.adj_r2')}: ${fmt(r.adjR2, 5)}`,
            `F = ${fmt(r.f, 5)} (p = ${fmt(r.fP, 4)})  σ = ${fmt(r.sigma, 5)}`,
          ],
          ols: r,
          diagnosticSpecs: quartetSpecs(diagnosticSeries(r)),
          metrics: { r2: r.r2, adjR2: r.adjR2, f: r.f, sigma: r.sigma, coefficients: r.coefficients.length },
          sampled,
        });
        return;
      }

      if (kind === 'logistic') {
        const rows = X[0]!.map((_, i) => X.map((col) => col[i]!));
        const r = logisticFit(y, rows, { names: predictors });
        const cm = r.confusionAt(Number(threshold) || 0.5);
        setOutcome({
          kind,
          coefficients: r.coefficients.map((c) => ({
            name: c.name, coef: c.coef, se: c.se, stat: c.z, p: c.p, lo: c.ciLow, hi: c.ciHigh,
          })),
          lines: [
            `${t('model.n_obs')}: ${y.length}  iter: ${r.iterations}  converged: ${r.converged}`,
            `${t('model.pseudo_r2')}: ${fmt(r.pseudoR2, 5)}`,
            `${t('model.accuracy')} @ ${threshold}: ${fmt(cm.accuracy, 5)}`,
            `TP ${cm.tp}  FP ${cm.fp}  FN ${cm.fn}  TN ${cm.tn}`,
          ],
          logistic: r,
          diagnosticSpecs: [],
          metrics: { pseudoR2: r.pseudoR2, accuracy: cm.accuracy, iterations: r.iterations },
          sampled,
        });
        return;
      }

      if (kind === 'ridge') {
        const rows = X[0]!.map((_, i) => X.map((col) => col[i]!));
        const r = ridgeCV(y, rows, { folds: Math.max(2, Math.floor(Number(folds)) || 5), seed: 42 });
        const resid = y.map((v, i) => v - r.fitted[i]!);
        const sse = resid.reduce((a, b) => a + b * b, 0);
        const rmse = Math.sqrt(sse / y.length);
        const names = [t('model.intercept'), ...predictors];
        setOutcome({
          kind,
          coefficients: r.beta.map((b, i) => ({ name: names[i] ?? `β${i}`, coef: b })),
          lines: [
            `${t('model.n_obs')}: ${y.length}  K=${Number(folds) || 5}`,
            `${t('model.lambda')}: ${fmt(r.lambda, 6)}  ${t('model.rmse')}: ${fmt(rmse, 5)}`,
          ],
          ridge: r,
          diagnosticSpecs: [scatterSpec('residuals vs fitted', 'fitted', 'residual', r.fitted, resid)],
          metrics: { lambda: r.lambda, rmse, coefficients: r.beta.length },
          sampled,
        });
        return;
      }

      // poly
      const deg = Math.min(6, Math.max(1, Math.floor(Number(degree)) || 2));
      const r: PolyResult = polyFit(X[0]!, y, deg);
      const q = diagnosticSeries(r.ols);
      const xMin = Math.min(...X[0]!);
      const xMax = Math.max(...X[0]!);
      const curve = Array.from({ length: 120 }, (_, i) => {
        const x = xMin + ((xMax - xMin) * i) / 119;
        return { x, y: r.predict(x) };
      });
      const dataSpec: PlotSpec = {
        width: 330,
        height: 250,
        title: `poly degree ${deg}`,
        grid: true,
        legend: true,
        series: [
          { name: target, kind: 'scatter', color: PALETTE[1]!, points: scatterSpec('', '', '', X[0]!, y).series[0]!.points },
          { name: 'fit', kind: 'line', color: PALETTE[0]!, points: curve },
        ],
      };
      setOutcome({
        kind,
        coefficients: r.ols.coefficients.map((c, i) => ({
          name: `(x−c)^${i}`, coef: c.coef, se: c.se, stat: c.t, p: c.p, lo: c.ciLow, hi: c.ciHigh,
        })),
        lines: [
          `${t('model.n_obs')}: ${r.ols.n}  degree=${r.degree}  centre=${fmt(r.centre, 5)}`,
          `${t('model.r2')}: ${fmt(r.ols.r2, 5)}  ${t('model.adj_r2')}: ${fmt(r.ols.adjR2, 5)}`,
        ],
        ols: r.ols,
        diagnosticSpecs: [dataSpec, ...quartetSpecs(q)],
        metrics: { r2: r.ols.r2, adjR2: r.ols.adjR2, degree: r.degree },
        sampled,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendDiagnostics = () => {
    if (!outcome || outcome.diagnosticSpecs.length === 0) return;
    let ok = true;
    outcome.diagnosticSpecs.forEach((spec, i) => {
      if (!sendSpecToFigure(t('model.title'), spec, i === 0 ? `${file} — ${kind} model diagnostics` : undefined)) {
        ok = false;
      }
    });
    notify(ok ? 'success' : 'error', ok ? t('model.figure_sent') : t('figure.export_failed', { reason: 'no project' }));
  };

  const record = async () => {
    if (!outcome) return;
    await recordRun({
      source: 'model',
      label: `${kind} on ${file}: ${target} ~ ${predictors.join('+') || '1'}`,
      params: { kind, file, target, predictors, degree: Number(degree), folds: Number(folds) },
      metrics: outcome.metrics,
      durationMs: 0,
    });
    notify('success', t('model.recorded'));
  };

  return (
    <ToolShell toolId="model-lab">
      <div className="analysis-body">
        <div className="analysis-row">
          <select className="input" value={file} onChange={(e) => selectFile(e.target.value)}>
            <option value="">{t('analysis.select_file')}</option>
            {fileGroups.project.map((n) => <option key={n} value={n}>{n}</option>)}
            {fileGroups.examples.length > 0 && (
              <optgroup label={t('datafiles.group_examples')}>
                {fileGroups.examples.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          <select className="input" value={kind} onChange={(e) => {
            setKind(e.target.value as ModelKind);
            setPredictors([]);
            setOutcome(null);
            setError('');
          }}>
            <option value="ols">{t('model.kind_ols')}</option>
            <option value="logistic">{t('model.kind_logistic')}</option>
            <option value="ridge">{t('model.kind_ridge')}</option>
            <option value="poly">{t('model.kind_poly')}</option>
          </select>
          {kind === 'poly' && (
            <input className="input research-num" title={t('model.degree')} value={degree}
              onChange={(e) => { setDegree(e.target.value); setOutcome(null); }} />
          )}
          {kind === 'ridge' && (
            <input className="input research-num" title={t('model.folds')} value={folds}
              onChange={(e) => { setFolds(e.target.value); setOutcome(null); }} />
          )}
          {kind === 'logistic' && (
            <input className="input research-num" title={t('model.threshold')} value={threshold}
              onChange={(e) => { setThreshold(e.target.value); setOutcome(null); }} />
          )}
          <button type="button" className="btn btn-primary" onClick={fit}>{t('model.fit')}</button>
        </div>

        {file && (
          <div className="analysis-row model-cols">
            <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setOutcome(null); }}>
              <option value="">{t('model.target')}</option>
              {cols.filter((c) => kind === 'poly' || !predictors.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="model-predictors" title={t('model.predictors')}>
              {cols.filter((c) => c !== target).map((c) => (
                <label key={c} className="research-check">
                  <input
                    type="checkbox"
                    checked={predictors.includes(c)}
                    disabled={kind === 'poly' && predictors.length > 0 && !predictors.includes(c)}
                    onChange={() => togglePredictor(c)}
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="analysis-error">{error}</p>}
        {outcome?.sampled && <p className="analysis-note">{t('model.sample_warn', { n: LARGE_N })}</p>}

        {outcome && (
          <>
            <pre className="analysis-output">{outcome.lines.join('\n')}</pre>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('model.term')}</th>
                    <th>{t('model.estimate')}</th>
                    {outcome.coefficients[0]?.se !== undefined && <th>{t('model.se')}</th>}
                    {outcome.coefficients[0]?.stat !== undefined && <th>{t('model.tvalue')}</th>}
                    {outcome.coefficients[0]?.p !== undefined && <th>{t('model.pvalue')}</th>}
                    {outcome.coefficients[0]?.lo !== undefined && <th colSpan={2}>{t('model.ci95')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {outcome.coefficients.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{fmt(c.coef, 6)}</td>
                      {c.se !== undefined && <td>{fmt(c.se, 5)}</td>}
                      {c.stat !== undefined && <td>{fmt(c.stat, 4)}</td>}
                      {c.p !== undefined && <td>{fmt(c.p, 4)}</td>}
                      {c.lo !== undefined && <td>{fmt(c.lo, 4)}</td>}
                      {c.hi !== undefined && <td>{fmt(c.hi, 4)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {outcome.diagnosticSpecs.length > 0 && (
              <>
                <h4 className="share-section-title">{t('model.diagnostics')}</h4>
                <div className="research-charts">
                  {outcome.diagnosticSpecs.map((spec, i) => (
                    <div key={i} className="research-chart-card">
                      <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: renderSVG(spec) }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="sweep-actions">
              <button type="button" className="btn" onClick={sendDiagnostics} disabled={outcome.diagnosticSpecs.length === 0}>
                {t('model.to_figure')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void record()}>
                {t('model.record_fit')}
              </button>
            </div>
            <NarrativePanel input={narrativeInput} />
          </>
        )}
      </div>
    </ToolShell>
  );
}
