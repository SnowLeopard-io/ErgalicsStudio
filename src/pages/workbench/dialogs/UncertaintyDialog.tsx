import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useProjectStore } from '@/stores/projectStore';
import { listDataFiles, resolveDataFile } from '@/core/dataFiles';
import { parseDataText } from '@/blocks/fileData';
import { asFloat64, isNumericType } from '@/blocks/ops';
import { renderSVG, dataTableToHistogram } from '@/core/plot';
import { createDataTable } from '@/types/datatable';
import type { DataTable } from '@/types/datatable';
import type { SvgPlotPayload } from '@/core/plot/types';
import { mean, median, std } from '@/core/stats/descriptive';
import { bootstrapCI } from '@/core/uncertainty/bootstrap';
import { propagateError, type DistSpec } from '@/core/uncertainty/montecarlo';
import { metropolisHastings } from '@/core/uncertainty/mcmc';

type StatKind = 'mean' | 'median' | 'std';
type DistKind = 'normal' | 'uniform' | 'lognormal' | 'triangular';

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

/**
 * Uncertainty suite (research menu): bootstrap CIs, Monte-Carlo sampling /
 * error propagation, and Bayesian MCMC estimation — one dialog per concern,
 * sharing the data-file picker with AnalysisDialog.
 */
export function UncertaintyDialog({ open, onClose }: UncertaintyDialogProps) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const fileNames = useMemo(() => listDataFiles(), [project?.data.files]);

  const [file, setFile] = useState('');
  const [table, setTable] = useState<DataTable | null>(null);
  const [parseError, setParseError] = useState('');

  // ---- bootstrap state ----
  const [bsCol, setBsCol] = useState('');
  const [bsStat, setBsStat] = useState<StatKind>('mean');
  const [bsIters, setBsIters] = useState('2000');
  const [bsAlpha, setBsAlpha] = useState('0.05');
  const [bsSeed, setBsSeed] = useState('');
  const [bsResult, setBsResult] = useState('');
  const [bsChart, setBsChart] = useState<SvgPlotPayload | null>(null);

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
  const [mcmcCol, setMcmcCol] = useState('');
  const [mcmcIters, setMcmcIters] = useState('10000');
  const [mcmcBurn, setMcmcBurn] = useState('5000');
  const [mcmcSeed, setMcmcSeed] = useState('');
  const [mcmcResult, setMcmcResult] = useState('');
  const [mcmcChart, setMcmcChart] = useState<SvgPlotPayload | null>(null);
  const [mcmcRunning, setMcmcRunning] = useState(false);
  const cancelRef = useRef(false);

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

  const runBootstrap = () => {
    if (!table || !bsCol) return;
    try {
      const x = Array.from(asFloat64(table, bsCol));
      const stat = bsStat === 'median' ? median : bsStat === 'std' ? std : mean;
      const r = bootstrapCI(x, stat, {
        iters: Number(bsIters) || 2000,
        alpha: Number(bsAlpha) || 0.05,
        seed: seedOf(bsSeed),
      });
      setBsResult(
        [
          `${t('uncertainty.estimate')} = ${fmt(r.estimate)}`,
          `ci95 = [${fmt(r.lower)}, ${fmt(r.upper)}]`,
          `se = ${fmt(r.se)}`,
          `iters = ${r.iters}`,
        ].join('\n'),
      );
      setBsChart(sampleHistogram(r.replicates, `bootstrap ${bsStat}(${bsCol})`));
    } catch (err) {
      setBsResult(err instanceof Error ? err.message : String(err));
      setBsChart(null);
    }
  };

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
          `ci95 = [${fmt(r.ci95[0])}, ${fmt(r.ci95[1])}]`,
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
    const mu = yBar;
    let ss = 0;
    for (const v of y) ss += (v - mu) * (v - mu);
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
    cancelRef.current = false;
    setMcmcRunning(true);
    setMcmcResult('');
    try {
      const r = await metropolisHastings(logPost, [yBar, Math.log(Math.max(sd, 1e-12))], {
        iters: Number(mcmcIters) || 10000,
        burnIn: Number(mcmcBurn) || 5000,
        seed: seedOf(mcmcSeed),
        shouldCancel: () => cancelRef.current,
      });
      const muDraws = Array.from(r.samples[0] ?? []);
      if (muDraws.length === 0) {
        setMcmcResult(t('uncertainty.cancelled'));
        setMcmcChart(null);
        return;
      }
      const sorted = [...muDraws].sort((a, b) => a - b);
      const mean = muDraws.reduce((s, v) => s + v, 0) / muDraws.length;
      setMcmcResult(
        [
          r.cancelled ? t('uncertainty.cancelled') : t('uncertainty.done'),
          `mu = ${fmt(mean)}`,
          `mu_ci95 = [${fmt(sorted[Math.floor(0.025 * sorted.length)]!)}, ${
            sorted[Math.floor(0.975 * sorted.length)]!
          }]`,
          `acceptance = ${(r.acceptanceRate * 100).toFixed(1)}%`,
          `iters = ${r.iters} (burn-in ${r.burnIn})`,
        ].join('\n'),
      );
      setMcmcChart(sampleHistogram(muDraws, `posterior μ (${mcmcCol})`));
    } catch (err) {
      setMcmcResult(err instanceof Error ? err.message : String(err));
      setMcmcChart(null);
    } finally {
      setMcmcRunning(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('uncertainty.title')} width={720}>
      <div className="analysis-body">
        {/* ---- Data source (shared) ---- */}
        <div className="analysis-row">
          <label className="analysis-label">{t('analysis.data_file')}</label>
          {fileNames.length === 0 ? (
            <span className="analysis-note">{t('analysis.no_data')}</span>
          ) : (
            <select className="input" value={file} onChange={(e) => loadFile(e.target.value)}>
              <option value="">{t('analysis.select_file')}</option>
              {fileNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </div>
        {parseError && <p className="analysis-error">{parseError}</p>}

        {table && (
          <>
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
              <select
                className="input"
                value={bsStat}
                onChange={(e) => setBsStat(e.target.value as StatKind)}
              >
                <option value="mean">{t('uncertainty.stat_mean')}</option>
                <option value="median">{t('uncertainty.stat_median')}</option>
                <option value="std">{t('uncertainty.stat_std')}</option>
              </select>
              <input
                className="input"
                style={{ maxWidth: 90 }}
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
              <button type="button" className="btn btn-primary" onClick={runBootstrap}>
                {t('analysis.run')}
              </button>
            </div>
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
              {mcmcRunning ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  {t('uncertainty.cancel')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void runMcmc()}>
                  {t('analysis.run')}
                </button>
              )}
            </div>
            {(mcmcResult || mcmcRunning) && (
              <pre className="analysis-output">
                {mcmcRunning ? t('uncertainty.running') : mcmcResult}
              </pre>
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
