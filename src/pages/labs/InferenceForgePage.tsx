// ==========================================================================
// Ergalics Studio — Inference Forge page (F9 / FR9.6–FR9.8)
//
// Pick a data file + a declarative likelihood template → HMC / NUTS sampling
// (chains · warmup · samples · seed configurable, cancellable) → posterior
// summary table (mean / sd / median / HDI94 / MCSE / R-hat / ESS) → trace +
// density charts (sendable to Figure Studio) → WAIC / PSIS-LOO + PPC.
// The whole inference is recorded as a single run (source 'inference').
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { renderSVG } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import { buildModel } from '@/core/inference/model';
import { runHmc } from '@/core/inference/hmc';
import { runNuts } from '@/core/inference/nuts';
import { constrainChains, posteriorPredictive, summarizeChains } from '@/core/inference/diag';
import { loo, waic } from '@/core/inference/compare';
import {
  buildTemplate,
  templateLogLik,
  templateSim,
  type TemplateKind,
} from '@/core/inference/templates';
import type { ChainSamples, InferenceConfig, InferenceResult } from '@/core/inference/types';
import { groupedDataFiles, loadTable, sendSpecToFigure, fmt } from '../research/researchUi';
import { DATA_EXTS_SERIES } from '@/core/dataFiles';
import { LabPageShell } from './LabPageShell';

const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7'];
const MAX_CHART_PARAMS = 4;
const MAX_CRITERION_DRAWS = 400;

interface ForgeOutcome {
  result: InferenceResult;
  chains: ChainSamples[];
  params: string[];
  charts: PlotSpec[];
  waic?: { elpd: number; se: number; p_eff: number };
  loo?: { elpd: number; se: number; p_eff: number; maxParetoK: number };
  ppc?: { stat: string; observed: number; pValue: number };
  rHatWarn: string[];
}

function traceSpec(name: string, perChain: Float64Array[]): PlotSpec {
  const series = perChain.slice(0, PALETTE.length).map((draws, c) => {
    const step = Math.max(1, Math.floor(draws.length / 400));
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < draws.length; i += step) pts.push({ x: i, y: draws[i]! });
    return { name: `chain ${c + 1}`, kind: 'line' as const, color: PALETTE[c % PALETTE.length]!, points: pts };
  });
  return {
    width: 330,
    height: 230,
    title: `${name} — trace`,
    xLabel: 'draw',
    yLabel: name,
    grid: true,
    series,
  };
}

function densitySpec(name: string, pooled: Float64Array): PlotSpec {
  const sorted = Float64Array.from(pooled).sort();
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  const bins = 28;
  const span = hi - lo || 1;
  const counts = new Float64Array(bins);
  for (let i = 0; i < pooled.length; i += 1) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((pooled[i]! - lo) / span) * bins)));
    counts[b]! += 1;
  }
  const bars = Array.from({ length: bins }, (_, b) => ({
    x0: lo + (span * b) / bins,
    x1: lo + (span * (b + 1)) / bins,
    y: counts[b]! / (pooled.length * (span / bins)),
  }));
  return {
    width: 330,
    height: 230,
    title: `${name} — posterior`,
    xLabel: name,
    yLabel: 'density',
    grid: true,
    series: [{ name, kind: 'histogram', color: PALETTE[0]!, bars }],
  };
}

export default function InferenceForgePage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const recordRun = useExperimentStore((s) => s.recordRun);
  const fileGroups = useMemo(() => groupedDataFiles(DATA_EXTS_SERIES), [project?.data.files]);

  const [file, setFile] = useState('');
  const [kind, setKind] = useState<TemplateKind>('normal-mean');
  const [yCol, setYCol] = useState('');
  const [xCol, setXCol] = useState('');
  const [groupCol, setGroupCol] = useState('');
  const [algorithm, setAlgorithm] = useState<'hmc' | 'nuts'>('nuts');
  const [chains, setChains] = useState('4');
  const [warmup, setWarmup] = useState('500');
  const [samples, setSamples] = useState('1000');
  const [seed, setSeed] = useState('2026');
  const [targetAccept, setTargetAccept] = useState('0.8');
  const [thin, setThin] = useState('1');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<ForgeOutcome | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cols = useMemo(() => {
    if (!file) return [] as string[];
    try {
      return loadTable(file).numericCols;
    } catch {
      return [];
    }
  }, [file]);

  const cancel = () => abortRef.current?.abort();

  const run = async () => {
    setError('');
    setOutcome(null);
    if (!file || !yCol || (kind === 'normal-linear' && !xCol) || (kind === 'normal-hierarchical' && !groupCol)) {
      setError(t('inference.need_data'));
      return;
    }
    const cfg: InferenceConfig = {
      chains: Math.max(1, Math.min(8, Math.floor(Number(chains)) || 4)),
      warmup: Math.max(0, Math.floor(Number(warmup)) || 500),
      samples: Math.max(10, Math.floor(Number(samples)) || 1000),
      seed: Math.floor(Number(seed)) || 2026,
      algorithm,
      targetAccept: Math.min(0.99, Math.max(0.5, Number(targetAccept) || 0.8)),
      thin: Math.max(1, Math.floor(Number(thin)) || 1),
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ done: 0, total: cfg.chains });
    try {
      const { table } = loadTable(file);
      const arrays = {
        y: (table.getColumn(yCol) as Float64Array | undefined) ?? new Float64Array(0),
        x: kind === 'normal-linear' ? (table.getColumn(xCol) as Float64Array | undefined) ?? undefined : undefined,
        group:
          kind === 'normal-hierarchical' ? (table.getColumn(groupCol) as Float64Array | undefined) ?? undefined : undefined,
      };
      const built = buildTemplate(kind, arrays);
      if (kind === 'normal-hierarchical' && built.groups.length < 2) {
        setError(t('inference.need_groups'));
        return;
      }
      const model = buildModel(built.spec, built.data);
      const sampler = algorithm === 'hmc' ? runHmc : runNuts;
      const samplerRun = await sampler(model, cfg, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const constrained = constrainChains(samplerRun.chains, model);
      const { samples: draws, diagnostics, summary } = summarizeChains(constrained, model.paramNames);

      // Charts: trace per chain + posterior density, capped for rendering.
      const charts: PlotSpec[] = [];
      for (const name of model.paramNames.slice(0, MAX_CHART_PARAMS)) {
        const d = model.paramNames.indexOf(name);
        charts.push(traceSpec(name, constrained.map((c) => c[d]!)));
        charts.push(densitySpec(name, draws[name]!));
      }

      // WAIC / LOO on a strided subsample of posterior draws.
      let criterion: ForgeOutcome['waic'];
      let looRes: ForgeOutcome['loo'];
      if (built.spec.likelihood) {
        const n = draws[model.paramNames[0]!]!.length;
        const stride = Math.max(1, Math.floor(n / MAX_CRITERION_DRAWS));
        const names = model.paramNames;
        const theta: Record<string, number> = {};
        const logLik: Float64Array[] = [];
        for (let s = 0; s < n; s += stride) {
          for (const p of names) theta[p] = draws[p]![s]!;
          logLik.push(
            Float64Array.from(arrays.y, (_, i) => templateLogLik(kind, theta, arrays, i)),
          );
        }
        const w = waic(logLik);
        criterion = { elpd: w.elpd, se: w.se, p_eff: w.p_eff };
        const l = loo(logLik);
        looRes = { elpd: l.elpd, se: l.se, p_eff: l.p_eff, maxParetoK: l.maxParetoK };
      }

      const ppcRes = posteriorPredictive(
        (theta, rand) => templateSim(kind, theta, arrays, rand),
        arrays.y,
        draws,
        { maxDraws: 400, seed: cfg.seed },
      );

      const rHatWarn = model.paramNames.filter((p) => (diagnostics.rHat[p] ?? 1) > 1.01);
      setOutcome({
        result: {
          samples: draws,
          diagnostics,
          summary,
          waic: criterion,
          loo: looRes ? { elpd: looRes.elpd, se: looRes.se, paretoK: [] } : undefined,
          ppc: { stat: ppcRes.stat, observed: ppcRes.observed, simulated: ppcRes.simulated, pValue: ppcRes.pValue },
          timing: samplerRun.timing,
        },
        chains: samplerRun.chains,
        params: model.paramNames,
        charts,
        waic: criterion,
        loo: looRes,
        ppc: { stat: ppcRes.stat, observed: ppcRes.observed, pValue: ppcRes.pValue },
        rHatWarn,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        notify('info', t('inference.cancel'));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const sendCharts = () => {
    if (!outcome || outcome.charts.length === 0) return;
    let ok = true;
    outcome.charts.forEach((spec, i) => {
      if (
        !sendSpecToFigure(
          t('inference.title'),
          spec,
          i === 0 ? `${file} — ${algorithm} posterior (${outcome.params.length} params)` : undefined,
        )
      ) {
        ok = false;
      }
    });
    notify(ok ? 'success' : 'error', ok ? t('inference.figure_sent') : t('figure.export_failed', { reason: 'no project' }));
  };

  const record = async () => {
    if (!outcome) return;
    const rHatMax = Math.max(...outcome.params.map((p) => outcome.result.diagnostics.rHat[p] ?? 1));
    const essMin = Math.min(...outcome.params.map((p) => outcome.result.diagnostics.essBulk[p] ?? 0));
    const divergences = outcome.chains.reduce((s, c) => s + c.divergences, 0);
    const acceptRate = outcome.chains.reduce((s, c) => s + c.acceptRate, 0) / outcome.chains.length;
    await recordRun({
      source: 'inference',
      label: `${algorithm} · ${kind} · ${file}`,
      params: {
        algorithm,
        template: kind,
        file,
        y: yCol,
        x: kind === 'normal-linear' ? xCol : undefined,
        group: kind === 'normal-hierarchical' ? groupCol : undefined,
        chains: outcome.result.timing.chains,
        warmup: Number(warmup),
        samples: Number(samples),
        seed: Number(seed),
        targetAccept: Number(targetAccept),
      },
      metrics: {
        rHatMax,
        essBulkMin: essMin,
        divergences,
        acceptRate,
        ...(outcome.waic ? { elpdWaic: outcome.waic.elpd } : {}),
        ...(outcome.loo ? { elpdLoo: outcome.loo.elpd } : {}),
      },
      durationMs: Math.round(outcome.result.timing.warmupMs + outcome.result.timing.samplingMs),
      seed: Number(seed) || undefined,
    });
    notify('success', t('inference.recorded'));
  };

  const summaryRows = outcome?.params ?? [];

  return (
    <LabPageShell title={t('inference.title')}>
      <div className="analysis-body">
        <div className="analysis-row">
          <select className="input" value={file} onChange={(e) => { setFile(e.target.value); setYCol(''); setXCol(''); setGroupCol(''); setOutcome(null); setError(''); }}>
            <option value="">{t('analysis.select_file')}</option>
            {fileGroups.project.map((n) => <option key={n} value={n}>{n}</option>)}
            {fileGroups.examples.length > 0 && (
              <optgroup label={t('datafiles.group_examples')}>
                {fileGroups.examples.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as TemplateKind); setOutcome(null); setError(''); }}>
            <option value="normal-mean">{t('inference.template_mean')}</option>
            <option value="normal-linear">{t('inference.template_linear')}</option>
            <option value="normal-hierarchical">{t('inference.template_hier')}</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running}>
            {t('inference.run')}
          </button>
          {running && (
            <button type="button" className="btn" onClick={cancel}>{t('inference.cancel')}</button>
          )}
        </div>

        {file && (
          <div className="analysis-row">
            <select className="input" value={yCol} onChange={(e) => { setYCol(e.target.value); setOutcome(null); }}>
              <option value="">{t('inference.y')}</option>
              {cols.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {kind === 'normal-linear' && (
              <select className="input" value={xCol} onChange={(e) => { setXCol(e.target.value); setOutcome(null); }}>
                <option value="">{t('inference.x')}</option>
                {cols.filter((c) => c !== yCol).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {kind === 'normal-hierarchical' && (
              <select className="input" value={groupCol} onChange={(e) => { setGroupCol(e.target.value); setOutcome(null); }}>
                <option value="">{t('inference.group')}</option>
                {cols.filter((c) => c !== yCol).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        )}

        <div className="analysis-row" title={t('inference.algorithm')}>
          <select className="input" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as 'hmc' | 'nuts')}>
            <option value="nuts">{t('inference.algo_nuts')}</option>
            <option value="hmc">{t('inference.algo_hmc')}</option>
          </select>
          <input className="input research-num" title={t('inference.chains')} value={chains} onChange={(e) => setChains(e.target.value)} />
          <input className="input research-num" title={t('inference.warmup')} value={warmup} onChange={(e) => setWarmup(e.target.value)} />
          <input className="input research-num" title={t('inference.samples')} value={samples} onChange={(e) => setSamples(e.target.value)} />
          <input className="input research-num" title={t('inference.seed')} value={seed} onChange={(e) => setSeed(e.target.value)} />
          <input className="input research-num" title={t('inference.target_accept')} value={targetAccept} onChange={(e) => setTargetAccept(e.target.value)} />
          <input className="input research-num" title={t('inference.thin')} value={thin} onChange={(e) => setThin(e.target.value)} />
        </div>

        {running && progress && <p className="analysis-note">{t('inference.running', { done: progress.done, total: progress.total })}</p>}
        {error && <p className="analysis-error">{error}</p>}

        {outcome && (
          <>
            {outcome.rHatWarn.length > 0 && (
              <p className="analysis-note">{t('inference.rhat_warn', { n: outcome.rHatWarn.join(', ') })}</p>
            )}

            <h4 className="share-section-title">{t('inference.summary')}</h4>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('inference.param')}</th>
                    <th>{t('inference.mean')}</th>
                    <th>{t('inference.sd')}</th>
                    <th>{t('inference.median')}</th>
                    <th colSpan={2}>{t('inference.hdi')}</th>
                    <th>{t('inference.mcse')}</th>
                    <th>{t('inference.rhat')}</th>
                    <th>{t('inference.ess_bulk')}</th>
                    <th>{t('inference.ess_tail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((p) => {
                    const s = outcome.result.summary[p]!;
                    const d = outcome.result.diagnostics;
                    return (
                      <tr key={p}>
                        <td>{p}</td>
                        <td>{fmt(s.mean)}</td>
                        <td>{fmt(s.sd)}</td>
                        <td>{fmt(s.median)}</td>
                        <td>{fmt(s.hdi94[0])}</td>
                        <td>{fmt(s.hdi94[1])}</td>
                        <td>{fmt(s.mcse)}</td>
                        <td>{fmt(d.rHat[p] ?? 1, 4)}</td>
                        <td>{fmt(d.essBulk[p] ?? 0, 4)}</td>
                        <td>{fmt(d.essTail[p] ?? 0, 4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <pre className="analysis-output">
              {[
                ...outcome.chains.map(
                  (c, i) =>
                    `chain ${i + 1}: ${t('inference.accept')} ${fmt(c.acceptRate, 4)} · ${t('inference.step_size')} ${fmt(c.stepSize, 5)} · ${t('inference.divergences')} ${c.divergences}`,
                ),
                `warmup ${fmt(outcome.result.timing.warmupMs, 0)} ms · sampling ${fmt(outcome.result.timing.samplingMs, 0)} ms`,
              ].join('\n')}
            </pre>

            {outcome.waic && (
              <>
                <h4 className="share-section-title">{t('inference.criteria')}</h4>
                <pre className="analysis-output">
                  {[
                    `${t('inference.waic')} = ${fmt(outcome.waic.elpd, 4)} ± ${fmt(outcome.waic.se, 4)}  (p_eff ${fmt(outcome.waic.p_eff, 4)})`,
                    outcome.loo
                      ? `${t('inference.loo')} = ${fmt(outcome.loo.elpd, 4)} ± ${fmt(outcome.loo.se, 4)}  (p_eff ${fmt(outcome.loo.p_eff, 4)})`
                      : '',
                    outcome.loo && outcome.loo.maxParetoK > 0.7
                      ? t('inference.pareto_warn', { k: fmt(outcome.loo.maxParetoK, 3) })
                      : '',
                  ].filter(Boolean).join('\n')}
                </pre>
              </>
            )}

            {outcome.ppc && (
              <pre className="analysis-output">
                {`${t('inference.ppc')} — ${t('inference.ppc_stat')}: ${outcome.ppc.stat} · ${t('inference.ppc_observed')}: ${fmt(outcome.ppc.observed, 5)} · ${t('inference.ppc_p')}: ${fmt(outcome.ppc.pValue, 4)}`}
              </pre>
            )}

            {outcome.charts.length > 0 && (
              <>
                <h4 className="share-section-title">{t('inference.traces')}</h4>
                <div className="research-charts">
                  {outcome.charts.map((spec, i) => (
                    <div key={i} className="research-chart-card">
                      <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: renderSVG(spec) }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="sweep-actions">
              <button type="button" className="btn" onClick={sendCharts} disabled={outcome.charts.length === 0}>
                {t('inference.to_figure')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void record()}>
                {t('inference.record')}
              </button>
            </div>
          </>
        )}
      </div>
    </LabPageShell>
  );
}
