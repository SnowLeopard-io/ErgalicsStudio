import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { listDataFilesGrouped, resolveDataFile } from '@/core/dataFiles';
import { parseDataText } from '@/blocks/fileData';
import { asFloat64, isNumericType } from '@/blocks/ops';
import { renderSVG, dataTableToHistogram } from '@/core/plot';
import { createDataTable } from '@/types/datatable';
import type { DataTable } from '@/types/datatable';
import type { SvgPlotPayload } from '@/core/plot/types';
import { propagateError, type DistSpec } from '@/core/uncertainty/montecarlo';
import {
  bootstrapEngine,
  hasGpuEngine,
  type EngineChoice,
  type GpuStat,
} from '@/core/uncertainty/gpu-engine';
import { mcmcEngine, type McmcEngineResult } from '@/core/uncertainty/gpu-mcmc';

type StatKind = GpuStat;
type DistKind = 'normal' | 'uniform' | 'lognormal' | 'triangular';
const STAT_KINDS: StatKind[] = ['mean', 'median', 'variance', 'sd', 'correlation', 'ols-slope'];

interface UncertaintyDialogProps {
  open: boolean;
  onClose: () => void;
}

function fmt(v: number): string {
  return Number.isNaN(v) ? '—' : String(Number(v.toPrecision(6)));
}

/** Histogram SVG of a numeric sample, styled like the analysis previews. */
function sampleHistogram(x: ArrayLike<number>, title: string): SvgPlotPayload | null {
  const finite = Array.from(x).filter(Number.isFinite);
  if (finite.length < 2) return null;
  const table = createDataTable(
    'uncertainty-preview',
    [{ name: 'x', type: 'f64', data: Float64Array.from(finite) }],
    { provenance: 'uncertainty' },
  );
  const spec = dataTableToHistogram(table, 'x', { title, bins: 30 });
  return { svg: true, markup: renderSVG(spec), title };
}

function EnginePicker({
  value,
  onChange,
  gpuAvailable,
}: {
  value: EngineChoice;
  onChange: (v: EngineChoice) => void;
  gpuAvailable: boolean;
}) {
  const t = useT();
  const choices: Array<{ id: EngineChoice; label: string }> = [
    { id: 'auto', label: t('uncertainty.engine_auto') },
    { id: 'cpu', label: t('uncertainty.engine_cpu') },
    { id: 'gpu', label: t('uncertainty.engine_gpu') },
  ];
  return (
    <div className="engine-picker" role="radiogroup" aria-label={t('uncertainty.engine')}>
      {choices.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          className={`engine-choice${value === c.id ? ' engine-choice-active' : ''}`}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
      {!gpuAvailable && <span className="analysis-note">{t('uncertainty.gpu_unavailable', { reason: 'WebGPU' })}</span>}
    </div>
  );
}

/**
 * Uncertainty suite (research menu): GPU/CPU bootstrap CIs, Monte-Carlo
 * sampling / error propagation, and multi-chain Bayesian MCMC with R-hat /
 * ESS diagnostics — one dialog per concern, sharing the data-file picker.
 */
export function UncertaintyDialog({ open, onClose }: UncertaintyDialogProps) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const recordRun = useExperimentStore((s) => s.recordRun);
  const fileGroups = useMemo(() => listDataFilesGrouped(), [project?.data.files, open]);
  const gpuAvailable = useMemo(() => hasGpuEngine(), [open]);

  const [file, setFile] = useState('');
  const [table, setTable] = useState<DataTable | null>(null);
  const [parseError, setParseError] = useState('');

  // ---- bootstrap state ----
  const [bsCol, setBsCol] = useState('');
  const [bsColX, setBsColX] = useState('');
  const [bsStat, setBsStat] = useState<StatKind>('mean');
  const [bsIters, setBsIters] = useState('2000');
  const [bsAlpha, setBsAlpha] = useState('0.05');
  const [bsSeed, setBsSeed] = useState('');
  const [bsResult, setBsResult] = useState('');
  const [bsChart, setBsChart] = useState<SvgPlotPayload | null>(null);
  const [bsProgress, setBsProgress] = useState<{ done: number; total: number } | null>(null);
  const bsAbort = useRef<AbortController | null>(null);

  // ---- monte-carlo state ----
  const [dist, setDist] = useState<DistKind>('normal');
  const [p1, setP1] = useState('0');
  const [p2, setP2] = useState('1');
  const [p3, setP3] = useState('0');
  const [mcN, setMcN] = useState('10000');
  const [mcSeed, setMcSeed] = useState('');
  const [mcResult, setMcResult] = useState('');
  const [mcChart, setMcChart] = useState<SvgPlotPayload | null>(null);

  // ---- mcmc state ----
  const [engine, setEngine] = useState<EngineChoice>('auto');
  const [mcmcCol, setMcmcCol] = useState('');
  const [mcmcIters, setMcmcIters] = useState('10000');
  const [mcmcBurn, setMcmcBurn] = useState('5000');
  const [mcmcSeed, setMcmcSeed] = useState('');
  const [mcmcResult, setMcmcResult] = useState('');
  const [mcmcChart, setMcmcChart] = useState<SvgPlotPayload | null>(null);
  const [mcmcEngineResult, setMcmcEngineResult] = useState<McmcEngineResult | null>(null);
  const [mcmcProgress, setMcmcProgress] = useState<{ done: number; total: number } | null>(null);
  const [mcmcRunning, setMcmcRunning] = useState(false);
  const [recordEnabled, setRecordEnabled] = useState(false);
  const mcmcAbort = useRef<AbortController | null>(null);

  const numericCols = useMemo(
    () => (table ? table.columns.filter((c) => isNumericType(c.type)).map((c) => c.name) : []),
    [table],
  );

  const loadFile = (name: string) => {
    setFile(name);
    setParseError('');
    if (!name) {
      setTable(null);
      return;
    }
    const text = resolveDataFile(name);
    if (text === undefined) {
      setTable(null);
      setParseError(t('analysis.no_data'));
      return;
    }
    try {
      const tbl = parseDataText(text, name);
      const nums = tbl.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
      if (nums.length === 0) {
        setTable(null);
        setParseError(t('analysis.numeric_only'));
        return;
      }
      setTable(tbl);
      setBsCol(nums[0] ?? '');
      setBsColX(nums[1] ?? nums[0] ?? '');
      setMcmcCol(nums[0] ?? '');
    } catch (err) {
      setTable(null);
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  const seedOf = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };

  const paired = bsStat === 'correlation' || bsStat === 'ols-slope';

  const runBootstrap = async () => {
    if (!table || !bsCol) return;
    try {
      const x = Array.from(asFloat64(table, bsCol));
      const sample = paired
        ? { x, y: Array.from(asFloat64(table, bsColX || bsCol)) }
        : x;
      const controller = new AbortController();
      bsAbort.current = controller;
      setBsProgress({ done: 0, total: Number(bsIters) || 2000 });
      setBsResult('');
      const r = await bootstrapEngine(sample, bsStat, {
        iters: Number(bsIters) || 2000,
        alpha: Number(bsAlpha) || 0.05,
        seed: seedOf(bsSeed),
        engine,
        signal: controller.signal,
        onProgress: (done, total) => setBsProgress({ done, total }),
      });
      setBsResult(
        [
          `${t('uncertainty.estimate')} = ${fmt(r.estimate)}`,
          `ci95 = [${fmt(r.lower)}, ${fmt(r.upper)}]`,
          `se = ${fmt(r.se)}`,
          `iters = ${r.iters}`,
          `${t('uncertainty.used_engine')}: ${r.engine}${r.device ? ` (${r.device})` : ''}`,
          `${t('uncertainty.duration_ms')}: ${Math.round(r.durationMs)}`,
          r.fallbackReason ? `fallback: ${r.fallbackReason}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      setBsChart(sampleHistogram(r.replicates, `bootstrap ${bsStat}(${bsCol})`));
      if (recordEnabled && project) {
        await recordRun({
          source: 'uncertainty',
          label: `bootstrap ${bsStat}(${bsCol})`,
          params: { method: 'bootstrap', stat: bsStat, file, column: bsCol, iters: r.iters, alpha: r.alpha, engine: r.engine },
          metrics: { estimate: r.estimate, ciLow: r.lower, ciHigh: r.upper, se: r.se, durationMs: Math.round(r.durationMs) },
          durationMs: Math.round(r.durationMs),
          seed: seedOf(bsSeed),
        });
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setBsResult(t('uncertainty.cancelled'));
      } else {
        setBsResult(err instanceof Error ? err.message : String(err));
      }
      setBsChart(null);
    } finally {
      setBsProgress(null);
      bsAbort.current = null;
    }
  };

  const cancelBootstrap = () => bsAbort.current?.abort();

  const runMonteCarlo = () => {
    try {
      const spec: DistSpec =
        dist === 'uniform'
          ? { kind: 'uniform', low: Number(p1), high: Number(p2) }
          : dist === 'lognormal'
            ? { kind: 'lognormal', logMean: Number(p1), logSd: Number(p2) }
            : dist === 'triangular'
              ? { kind: 'triangular', low: Number(p1), mode: Number(p2), high: Number(p3) }
              : { kind: 'normal', mean: Number(p1), sd: Number(p2) };
      const r = propagateError((xs) => xs[0]!, [spec], Number(mcN) || 10000, {
        seed: seedOf(mcSeed),
      });
      setMcResult(
        [
          `${t('uncertainty.draws')} = ${r.n}`,
          `mean = ${fmt(r.mean)}`,
          `std = ${fmt(r.std)}`,
          `median = ${fmt(r.median)}`,
          `ci95 = [${fmt(r.ci95[0]!)}, ${fmt(r.ci95[1]!)}]`,
        ].join('\n'),
      );
      setMcChart(sampleHistogram(r.samples, `MC draws (${dist})`));
    } catch (err) {
      setMcResult(err instanceof Error ? err.message : String(err));
      setMcChart(null);
    }
  };

  const runMcmc = async () => {
    if (!table || !mcmcCol || mcmcRunning) return;
    const y = Array.from(asFloat64(table, mcmcCol));
    if (y.length < 2) {
      setMcmcResult(t('uncertainty.need_two'));
      return;
    }
    const n = y.length;
    const yBar = y.reduce((s, v) => s + v, 0) / n;
    let ss = 0;
    for (const v of y) ss += (v - yBar) * (v - yBar);
    const sd = Math.sqrt(ss / (n - 1));
    // Normal likelihood with flat priors on μ and log σ (constants dropped).
    const logPost = (theta: number[]): number => {
      const m = theta[0]!;
      const ls = theta[1]!;
      if (!Number.isFinite(m) || !Number.isFinite(ls)) return -Infinity;
      const inv = Math.exp(-2 * ls);
      if (!Number.isFinite(inv)) return -Infinity;
      let s2 = 0;
      for (const v of y) s2 += (v - m) * (v - m);
      return -n * ls - s2 * inv * 0.5;
    };
    const controller = new AbortController();
    mcmcAbort.current = controller;
    setMcmcRunning(true);
    setMcmcResult('');
    setMcmcEngineResult(null);
    setMcmcProgress({ done: 0, total: Number(mcmcIters) || 10000 });
    try {
      const seed = seedOf(mcmcSeed);
      const r = await mcmcEngine(logPost, [yBar, Math.log(Math.max(sd, 1e-12))], {
        engine,
        iters: Number(mcmcIters) || 10000,
        burnIn: Number(mcmcBurn) || 5000,
        seed,
        signal: controller.signal,
        onProgress: (done, total) => setMcmcProgress({ done, total }),
      });
      setMcmcEngineResult(r);
      const muDraws = Array.from(r.samples[0] ?? []);
      if (muDraws.length === 0) {
        setMcmcResult(t('uncertainty.cancelled'));
        setMcmcChart(null);
        return;
      }
      const sorted = [...muDraws].sort((a, b) => a - b);
      const meanMu = muDraws.reduce((s, v) => s + v, 0) / muDraws.length;
      setMcmcResult(
        [
          `mu = ${fmt(meanMu)}`,
          `mu_ci95 = [${fmt(sorted[Math.floor(0.025 * sorted.length)]!)}, ${
            fmt(sorted[Math.floor(0.975 * sorted.length)]!)
          }]`,
          `acceptance = ${(r.acceptanceRate.reduce((a, b) => a + b, 0) / r.acceptanceRate.length * 100).toFixed(1)}%`,
          `iters = ${r.iters} (burn-in ${r.burnIn})`,
          `${t('uncertainty.used_engine')}: ${r.engine}${r.device ? ` (${r.device})` : ''}`,
          `${t('uncertainty.duration_ms')}: ${Math.round(r.durationMs)}`,
          r.fallbackReason ? `fallback: ${r.fallbackReason}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      setMcmcChart(sampleHistogram(muDraws, `posterior μ (${mcmcCol})`));
      if (recordEnabled && project) {
        await recordRun({
          source: 'uncertainty',
          label: `mcmc μ(${mcmcCol})`,
          params: { method: 'mcmc', file, column: mcmcCol, iters: r.iters, burnIn: r.burnIn, engine: r.engine },
          metrics: {
            mean: meanMu,
            ciLow: sorted[Math.floor(0.025 * sorted.length)]!,
            ciHigh: sorted[Math.floor(0.975 * sorted.length)]!,
            rHatMu: r.diagnostics.rHat[0] ?? Number.NaN,
            essMu: r.diagnostics.ess[0] ?? 0,
            durationMs: Math.round(r.durationMs),
          },
          durationMs: Math.round(r.durationMs),
          seed,
        });
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setMcmcResult(t('uncertainty.cancelled'));
      } else {
        setMcmcResult(err instanceof Error ? err.message : String(err));
      }
      setMcmcChart(null);
    } finally {
      setMcmcRunning(false);
      setMcmcProgress(null);
      mcmcAbort.current = null;
    }
  };

  const cancelMcmc = () => mcmcAbort.current?.abort();

  return (
    <Modal open={open} onClose={onClose} title={t('uncertainty.title')} width={760}>
      <div className="analysis-body">
        {/* ---- Data source (shared) ---- */}
        <div className="analysis-row">
          <label className="analysis-label">{t('analysis.data_file')}</label>
          {fileGroups.project.length === 0 && fileGroups.examples.length === 0 ? (
            <span className="analysis-note">{t('analysis.no_data')}</span>
          ) : (
            <select className="input" value={file} onChange={(e) => loadFile(e.target.value)}>
              <option value="">{t('analysis.select_file')}</option>
              {fileGroups.project.length > 0 && (
                <optgroup label={t('datafiles.group_project')}>
                  {fileGroups.project.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
              {fileGroups.examples.length > 0 && (
                <optgroup label={t('datafiles.group_examples')}>
                  {fileGroups.examples.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          <label className="research-check">
            <input type="checkbox" checked={recordEnabled} onChange={(e) => setRecordEnabled(e.target.checked)} />
            {t('uncertainty.record_run')}
          </label>
        </div>
        {parseError && <p className="analysis-error">{parseError}</p>}

        {table && (
          <>
            <EnginePicker value={engine} onChange={setEngine} gpuAvailable={gpuAvailable} />

            {/* ---- Bootstrap ---- */}
            <h4 className="share-section-title">{t('uncertainty.bootstrap')}</h4>
            <div className="analysis-row">
              <select className="input" value={bsCol} onChange={(e) => setBsCol(e.target.value)}>
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.column')}: {c}
                  </option>
                ))}
              </select>
              {paired && (
                <select className="input" value={bsColX} onChange={(e) => setBsColX(e.target.value)}>
                  {numericCols.filter((c) => c !== bsCol).map((c) => (
                    <option key={c} value={c}>
                      {t('uncertainty.pair_x')}: {c}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="input"
                value={bsStat}
                onChange={(e) => setBsStat(e.target.value as StatKind)}
              >
                {STAT_KINDS.map((s) => (
                  <option key={s} value={s}>
                    {t(`uncertainty.stat_${s.replace('-', '_')}`)}
                  </option>
                ))}
              </select>
              <input
                className="input"
                style={{ maxWidth: 100 }}
                title={t('uncertainty.iters')}
                value={bsIters}
                onChange={(e) => setBsIters(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 70 }}
                title={t('uncertainty.alpha')}
                value={bsAlpha}
                onChange={(e) => setBsAlpha(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                placeholder={t('uncertainty.seed')}
                value={bsSeed}
                onChange={(e) => setBsSeed(e.target.value)}
              />
              {bsProgress ? (
                <button type="button" className="btn btn-danger" onClick={cancelBootstrap}>
                  {t('uncertainty.cancel')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void runBootstrap()}>
                  {t('analysis.run')}
                </button>
              )}
            </div>
            {bsProgress && (
              <p className="analysis-note">
                {t('uncertainty.progress', { done: bsProgress.done, total: bsProgress.total })}
              </p>
            )}
            {bsResult && <pre className="analysis-output">{bsResult}</pre>}
            {bsChart && (
              <div className="analysis-preview">
                <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: bsChart.markup }} />
              </div>
            )}

            {/* ---- Monte-Carlo ---- */}
            <h4 className="share-section-title">{t('uncertainty.montecarlo')}</h4>
            <div className="analysis-row">
              <select
                className="input"
                value={dist}
                onChange={(e) => setDist(e.target.value as DistKind)}
              >
                <option value="normal">{t('uncertainty.dist_normal')}</option>
                <option value="uniform">{t('uncertainty.dist_uniform')}</option>
                <option value="lognormal">{t('uncertainty.dist_lognormal')}</option>
                <option value="triangular">{t('uncertainty.dist_triangular')}</option>
              </select>
              <input
                className="input"
                style={{ maxWidth: 90 }}
                title={dist === 'triangular' ? t('uncertainty.p_low') : t('uncertainty.p_a')}
                value={p1}
                onChange={(e) => setP1(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                title={dist === 'triangular' ? t('uncertainty.p_mode') : t('uncertainty.p_b')}
                value={p2}
                onChange={(e) => setP2(e.target.value)}
              />
              {dist === 'triangular' && (
                <input
                  className="input"
                  style={{ maxWidth: 90 }}
                  title={t('uncertainty.p_high')}
                  value={p3}
                  onChange={(e) => setP3(e.target.value)}
                />
              )}
              <input
                className="input"
                style={{ maxWidth: 100 }}
                title={t('uncertainty.draws')}
                value={mcN}
                onChange={(e) => setMcN(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                placeholder={t('uncertainty.seed')}
                value={mcSeed}
                onChange={(e) => setMcSeed(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={runMonteCarlo}>
                {t('analysis.run')}
              </button>
            </div>
            {mcResult && <pre className="analysis-output">{mcResult}</pre>}
            {mcChart && (
              <div className="analysis-preview">
                <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: mcChart.markup }} />
              </div>
            )}

            {/* ---- MCMC ---- */}
            <h4 className="share-section-title">{t('uncertainty.mcmc')}</h4>
            <div className="analysis-row">
              <select
                className="input"
                value={mcmcCol}
                onChange={(e) => setMcmcCol(e.target.value)}
              >
                {numericCols.map((c) => (
                  <option key={c} value={c}>
                    {t('analysis.column')}: {c}
                  </option>
                ))}
              </select>
              <input
                className="input"
                style={{ maxWidth: 100 }}
                title={t('uncertainty.iters')}
                value={mcmcIters}
                onChange={(e) => setMcmcIters(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                title={t('uncertainty.burn_in')}
                value={mcmcBurn}
                onChange={(e) => setMcmcBurn(e.target.value)}
              />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                placeholder={t('uncertainty.seed')}
                value={mcmcSeed}
                onChange={(e) => setMcmcSeed(e.target.value)}
              />
              {mcmcRunning || mcmcProgress ? (
                <button type="button" className="btn btn-danger" onClick={cancelMcmc}>
                  {t('uncertainty.cancel')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void runMcmc()}>
                  {t('analysis.run')}
                </button>
              )}
            </div>
            {mcmcProgress && (
              <p className="analysis-note">
                {t('uncertainty.progress', { done: mcmcProgress.done, total: mcmcProgress.total })}
              </p>
            )}
            {(mcmcResult || mcmcRunning) && (
              <pre className="analysis-output">
                {mcmcRunning && !mcmcResult ? t('uncertainty.running') : mcmcResult}
              </pre>
            )}

            {mcmcEngineResult && (
              <div className={`mcmc-diag${mcmcEngineResult.diagnostics.converged ? '' : ' mcmc-diag-bad'}`}>
                <h4 className="share-section-title">{t('uncertainty.diagnostics')}</h4>
                <table className="sweep-table">
                  <thead>
                    <tr>
                      <th>param</th>
                      <th>{t('uncertainty.rhat')}</th>
                      <th>{t('uncertainty.ess')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mcmcEngineResult.diagnostics.rHat.map((rhat, i) => (
                      <tr key={i} className={rhat > 1.01 || !Number.isFinite(rhat) ? 'repro-drift-fail' : ''}>
                        <td>{i === 0 ? 'μ' : 'log σ'}</td>
                        <td>{fmt(rhat)}</td>
                        <td>{mcmcEngineResult.diagnostics.ess[i]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!mcmcEngineResult.diagnostics.converged && (
                  <p className="analysis-error">{t('uncertainty.rhat_bad')}</p>
                )}
              </div>
            )}

            {mcmcChart && (
              <div className="analysis-preview">
                <div
                  className="analysis-svg"
                  dangerouslySetInnerHTML={{ __html: mcmcChart.markup }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
