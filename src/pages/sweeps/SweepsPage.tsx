// ==========================================================================
// Ergalics Studio — Sweep Studio (/sweeps, F2 / FR2.4–FR2.7)
//
// Left: persisted plan list (project.state.sweeps). Right: plan editor
// (1–3 axes, grid/list/LHS), run/resume/cancel controls, live progress
// matrix, result table and a response-surface preview (1-axis line or
// 2-axis heat map). Every cell becomes a child run (source 'sweep',
// parentSweepId) and the surface can be sent to Figure Studio.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useResearchStore } from '@/stores/researchStore';
import { renderSVG } from '@/core/plot';
import type { PlotSpec } from '@/core/plot';
import { runSweep, summarizePoints } from '@/core/sweep/runner';
import { expandPlan } from '@/core/sweep/design';
import type { SweepAxis, SweepPlan, SweepResult, SweepSource } from '@/core/sweep/types';
import { sendSpecToFigure, fmt as fmtNum } from '../research/researchUi';

type AxisMode = 'grid' | 'list' | 'lhs';

interface AxisDraft {
  param: string;
  mode: AxisMode;
  from: string;
  to: string;
  steps: string;
  list: string;
  n: string;
  seed: string;
}

const EMPTY_AXIS: AxisDraft = {
  param: '',
  mode: 'grid',
  from: '0',
  to: '1',
  steps: '5',
  list: '0.1, 0.2, 0.3',
  n: '8',
  seed: '42',
};

function newPlan(): SweepPlan {
  return {
    id: crypto.randomUUID(),
    name: `sweep-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`,
    source: 'flow',
    sourceRef: '',
    axes: [],
    metric: 'value',
    repeats: 1,
    baseParams: {},
    createdAt: Date.now(),
  };
}

const SOURCES: SweepSource[] = ['flow', 'block', 'code', 'notebook'];

const HEAT_COLORS = ['#08306b', '#2171b5', '#6baed6', '#fdae61', '#f46d43', '#d73027', '#a50f15'];

function heatColor(v: number, lo: number, hi: number): string {
  if (!Number.isFinite(v) || hi === lo) return '#e5e5e5';
  const u = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const idx = Math.min(HEAT_COLORS.length - 1, Math.floor(u * HEAT_COLORS.length));
  return HEAT_COLORS[idx]!;
}

export default function SweepsPage() {
  const t = useT();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const recordRun = useExperimentStore((s) => s.recordRun);
  const savePlan = useResearchStore((s) => s.savePlan);
  const deletePlanStore = useResearchStore((s) => s.deletePlan);
  const saveResult = useResearchStore((s) => s.saveSweepResult);

  const plans = project?.state.sweeps ?? [];
  const results = project?.state.sweepResults ?? {};

  const [selectedId, setSelectedId] = useState<string | null>(plans[0]?.id ?? null);
  const plan = plans.find((p) => p.id === selectedId) ?? null;
  const result = plan ? results[plan.id] ?? null : null;

  // ---- editor draft (local until Save plan) ----
  const [name, setName] = useState('');
  const [source, setSource] = useState<SweepSource>('flow');
  const [sourceRef, setSourceRef] = useState('');
  const [metric, setMetric] = useState('value');
  const [expression, setExpression] = useState('p.a');
  const [repeats, setRepeats] = useState('1');
  const [baseParams, setBaseParams] = useState('{}');
  const [axesDraft, setAxesDraft] = useState<AxisDraft[]>([]);
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [liveResult, setLiveResult] = useState<SweepResult | null>(null);

  const shownResult = liveResult ?? result;

  const beginNew = () => {
    const p = newPlan();
    setSelectedId(p.id);
    setName(p.name);
    setSource(p.source);
    setSourceRef(p.sourceRef);
    setMetric(p.metric);
    setExpression('p.a');
    setRepeats(String(p.repeats));
    setBaseParams('{}');
    setAxesDraft([]);
    setLiveResult(null);
    setEditing(true);
  };

  const editPlan = (p: SweepPlan) => {
    setSelectedId(p.id);
    setName(p.name);
    setSource(p.source);
    setSourceRef(p.sourceRef);
    setMetric(p.metric);
    setRepeats(String(p.repeats));
    setBaseParams(JSON.stringify(p.baseParams ?? {}, null, 2));
    setAxesDraft(
      p.axes.map((a) => ({
        param: a.param,
        mode: a.mode,
        from: String(a.grid?.from ?? 0),
        to: String(a.grid?.to ?? 1),
        steps: String(a.grid?.steps ?? 5),
        list: (a.list ?? []).join(', '),
        n: String(a.lhs?.n ?? 8),
        seed: String(a.lhs?.seed ?? 42),
      })),
    );
    setLiveResult(null);
    setEditing(true);
  };

  const buildAxis = (d: AxisDraft): SweepAxis | null => {
    if (!d.param.trim()) return null;
    if (d.mode === 'grid') {
      return {
        param: d.param.trim(),
        mode: 'grid',
        grid: {
          from: Number(d.from),
          to: Number(d.to),
          steps: Math.max(2, Math.floor(Number(d.steps)) || 2),
        },
      };
    }
    if (d.mode === 'list') {
      const list = d.list
        .split(/[,\s]+/)
        .filter((s) => s.trim() !== '')
        .map((s) => (Number.isFinite(Number(s)) ? Number(s) : s));
      return list.length > 0 ? { param: d.param.trim(), mode: 'list', list } : null;
    }
    return {
      param: d.param.trim(),
      mode: 'lhs',
      lhs: {
        n: Math.max(1, Math.floor(Number(d.n)) || 1),
        seed: Math.floor(Number(d.seed)) || 0,
        from: Number(d.from) || 0,
        to: Number(d.to) || 1,
      },
    };
  };

  const draftToPlan = (): SweepPlan | null => {
    const axes = axesDraft.map(buildAxis).filter((a): a is SweepAxis => a !== null);
    if (axes.length === 0) return null;
    let base: Record<string, unknown> = {};
    try {
      base = baseParams.trim() ? JSON.parse(baseParams) : {};
    } catch {
      return null;
    }
    return {
      id: selectedId ?? crypto.randomUUID(),
      name: name.trim() || 'sweep',
      source,
      sourceRef: sourceRef.trim(),
      axes,
      metric: metric.trim() || 'value',
      repeats: Math.max(1, Math.floor(Number(repeats)) || 1),
      baseParams: base,
      createdAt: plan?.createdAt ?? Date.now(),
    };
  };

  const previewCount = useMemo(() => {
    const p = draftToPlan();
    if (!p) return 0;
    try {
      return expandPlan(p).length;
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axesDraft, name, source, sourceRef, metric, repeats, baseParams]);

  const handleSave = () => {
    const p = draftToPlan();
    if (!p) {
      notify('error', t('sweep.plan_invalid', { reason: 'axes/baseParams' }));
      return;
    }
    savePlan(p);
    setSelectedId(p.id);
    setEditing(false);
  };

  const handleDelete = (p: SweepPlan) => {
    if (!window.confirm(t('sweep.delete_confirm', { name: p.name }))) return;
    deletePlanStore(p.id);
    if (selectedId === p.id) {
      setSelectedId(null);
      setEditing(false);
    }
  };

  const executeRun = async (p: SweepPlan, resume: boolean) => {
    let evaluator: (params: Record<string, unknown>) => number;
    try {
      // Per-cell metric expression evaluated over the flat axis params.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function('p', `"use strict"; return (${expression || 'p'});`) as (
        p: Record<string, unknown>,
      ) => unknown;
      evaluator = (params) => Number(fn(params));
    } catch (err) {
      notify('error', t('sweep.plan_invalid', { reason: String(err) }));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    try {
      const r = await runSweep(p, {
        existing: resume ? results[p.id] ?? null : null,
        signal: controller.signal,
        onProgress: (done, total, partial) => {
          setProgress({ done, total });
          setLiveResult(partial);
        },
        executor: async (cell) => {
          const started = performance.now();
          if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
          const value = evaluator(cell.flatParams);
          const durationMs = Math.max(0, Math.round(performance.now() - started));
          const runRecord = await recordRun({
            source: 'sweep',
            label: `${p.name} ${cell.key}`,
            params: cell.params,
            metrics: { value },
            durationMs,
            seed: cell.seed,
            parentSweepId: p.id,
          });
          return { runId: runRecord?.id ?? cell.key, metrics: { value }, durationMs };
        },
      });
      setLiveResult(r);
      saveResult(r);
      if (r.status === 'done') notify('success', t('sweep.status_done'));
    } catch (err) {
      notify('error', t('sweep.plan_invalid', { reason: String(err) }));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const runDraft = async (resume: boolean) => {
    const p = draftToPlan();
    if (!p) {
      notify('error', t('sweep.plan_invalid', { reason: 'axes/baseParams' }));
      return;
    }
    savePlan(p);
    setSelectedId(p.id);
    setEditing(false);
    await executeRun(p, resume);
  };

  const cancel = () => abortRef.current?.abort();

  // ---- response surface (mean of repeats) ----
  const surface = useMemo(() => {
    if (!shownResult || !plan) return null;
    const points = summarizePoints(shownResult);
    const axisNames = plan.axes.map((a) => a.param);
    if (axisNames.length === 0) return null;
    const xName = axisNames[0]!;
    const xVals = [...new Set(points.map((p) => Number(p.params[xName])))].sort((a, b) => a - b);
    if (axisNames.length === 1) {
      const spec: PlotSpec = {
        width: 620,
        height: 320,
        title: `${plan.metric} vs ${xName}`,
        xLabel: xName,
        yLabel: plan.metric,
        grid: true,
        series: [
          {
            name: plan.metric,
            kind: 'line',
            color: '#0072B2',
            points: xVals.map((x) => {
              const pt = points.find((p) => Number(p.params[xName]) === x);
              return { x, y: pt?.mean ?? Number.NaN };
            }),
          },
        ],
      };
      return { kind: 'line' as const, spec };
    }
    const yName = axisNames[1]!;
    const yVals = [...new Set(points.map((p) => Number(p.params[yName])))].sort((a, b) => a - b);
    const grid: number[][] = yVals.map((y) =>
      xVals.map((x) => {
        const pt = points.find(
          (p) => Number(p.params[xName]) === x && Number(p.params[yName]) === y,
        );
        return pt?.mean ?? Number.NaN;
      }),
    );
    // Figure Studio receives grouped lines (one per second-axis level).
    const spec: PlotSpec = {
      width: 620,
      height: 320,
      title: `${plan.metric}: ${xName} × ${yName}`,
      xLabel: xName,
      yLabel: plan.metric,
      grid: true,
      legend: true,
      series: yVals.map((y, i) => ({
        name: `${yName}=${fmtNum(y, 4)}`,
        kind: 'line' as const,
        color: HEAT_COLORS[Math.round((i / Math.max(1, yVals.length - 1)) * (HEAT_COLORS.length - 1))]!,
        points: xVals.map((x) => {
          const pt = points.find(
            (p) => Number(p.params[xName]) === x && Number(p.params[yName]) === y,
          );
          return { x, y: pt?.mean ?? Number.NaN };
        }),
      })),
    };
    const flat = grid.flat().filter(Number.isFinite);
    const lo = Math.min(...flat);
    const hi = Math.max(...flat);
    return { kind: 'heat' as const, spec, xVals, yVals, grid, lo, hi, xName, yName };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownResult, plan]);

  const sendSurface = () => {
    if (!surface || !plan) {
      notify('error', t('sweep.figure_failed'));
      return;
    }
    const caption = `${plan.name}: ${plan.axes.map((a) => a.param).join(' × ')} → ${plan.metric}`;
    if (sendSpecToFigure(t('sweep.title'), surface.spec, caption)) {
      notify('success', t('sweep.figure_sent'));
      void navigate('/figures');
    }
  };

  const statusKey = shownResult ? `sweep.status_${shownResult.status}` : '';

  return (
    <div className="figures-page">
      <header className="figures-header">
        <button type="button" className="btn" onClick={() => navigate('/workbench')}>
          ← {t('figure.back')}
        </button>
        <h1 className="figures-title">{t('sweep.title')}</h1>
      </header>

      {!project && <div className="empty-hint">{t('sweep.need_project')}</div>}

      {project && (
        <div className="figures-main">
          <aside className="figures-side">
            <div className="figures-side-header">
              <h2 className="figures-subtitle">{t('sweep.plans')}</h2>
              <button type="button" className="btn btn-sm btn-primary" onClick={beginNew}>
                + {t('sweep.new_plan')}
              </button>
            </div>
            {plans.length === 0 && <div className="empty-hint">{t('sweep.no_plans')}</div>}
            <ul className="figures-panel-list">
              {plans.map((p) => {
                const r = results[p.id];
                return (
                  <li
                    key={p.id}
                    className={`figures-panel-item${selectedId === p.id ? ' figures-panel-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="figures-panel-select"
                      onClick={() => {
                        setSelectedId(p.id);
                        setEditing(false);
                        setLiveResult(null);
                      }}
                    >
                      <div className="figures-panel-name">{p.name}</div>
                      <div className="figures-panel-meta">
                        {p.axes.length} axes · {p.source}
                        {r ? ` · ${r.cells.length}/${r.total}` : ''}
                      </div>
                    </button>
                    <div className="figures-panel-actions">
                      <button type="button" className="btn btn-sm" onClick={() => editPlan(p)}>
                        {t('figure.edit')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(p)}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="figures-stage">
            {!plan && !editing && <div className="empty-hint">{t('sweep.no_plans')}</div>}

            {plan && !editing && (
              <div className="sweep-view">
                <div className="sweep-result-head">
                  <div>
                    <h2 className="figures-subtitle">{plan.name}</h2>
                    <div className="figures-panel-meta">
                      {plan.source}
                      {plan.sourceRef ? ` · ${plan.sourceRef}` : ''} · {t('sweep.col_params')}:{' '}
                      {plan.axes.map((a) => a.param).join(' × ')} · {t('sweep.metric')} {plan.metric}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => editPlan(plan)}>
                    {t('figure.edit')}
                  </button>
                </div>
                <div className="sweep-actions">
                  {running ? (
                    <button type="button" className="btn btn-danger" onClick={cancel}>
                      {t('sweep.cancel_run')}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => void executeRun(plan, false)}>
                        {t('sweep.run')}
                      </button>
                      {result && result.cells.length < result.total && (
                        <button type="button" className="btn" onClick={() => void executeRun(plan, true)}>
                          {t('sweep.resume')}
                        </button>
                      )}
                    </>
                  )}
                  {running && progress && (
                    <span className="figures-panel-meta">
                      {t('sweep.progress', { done: progress.done, total: progress.total })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {editing && (
              <div className="sweep-editor">
                <div className="figures-field">
                  <label className="figures-label">{t('sweep.name')}</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={plan?.name}
                  />
                </div>
                <div className="sweep-row">
                  <label className="figures-label">{t('sweep.source')}
                    <select className="input" value={source} onChange={(e) => setSource(e.target.value as SweepSource)}>
                      {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="figures-label">{t('sweep.source_ref')}
                    <input className="input" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
                  </label>
                  <label className="figures-label">{t('sweep.repeats')}
                    <input className="input research-num" type="number" min={1} value={repeats}
                      onChange={(e) => setRepeats(e.target.value)} />
                  </label>
                </div>
                <div className="sweep-row">
                  <label className="figures-label">{t('sweep.metric')}
                    <input className="input" value={metric} onChange={(e) => setMetric(e.target.value)} />
                  </label>
                  <label className="figures-label">{t('sweep.expression')}
                    <input className="input" value={expression} onChange={(e) => setExpression(e.target.value)} />
                  </label>
                </div>
                <p className="figures-field-hint">{t('sweep.expression_hint')}</p>

                <div className="figures-field">
                  <label className="figures-label">{t('sweep.base_params')}</label>
                  <textarea className="input" rows={2} value={baseParams} onChange={(e) => setBaseParams(e.target.value)} />
                </div>

                <div className="figures-side-header">
                  <h2 className="figures-subtitle">{t('sweep.axes')}</h2>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={axesDraft.length >= 3}
                    onClick={() => setAxesDraft((a) => [...a, { ...EMPTY_AXIS }])}
                  >
                    + {t('sweep.add_axis')}
                  </button>
                </div>
                {axesDraft.map((axis, i) => (
                  <div key={i} className="sweep-axis">
                    <input
                      className="input"
                      placeholder={t('sweep.axis_param')}
                      value={axis.param}
                      onChange={(e) =>
                        setAxesDraft((arr) => arr.map((a, j) => (j === i ? { ...a, param: e.target.value } : a)))
                      }
                    />
                    <select
                      className="input"
                      value={axis.mode}
                      onChange={(e) =>
                        setAxesDraft((arr) =>
                          arr.map((a, j) => (j === i ? { ...a, mode: e.target.value as AxisMode } : a)),
                        )
                      }
                    >
                      <option value="grid">{t('sweep.mode_grid')}</option>
                      <option value="list">{t('sweep.mode_list')}</option>
                      <option value="lhs">{t('sweep.mode_lhs')}</option>
                    </select>
                    {axis.mode === 'grid' && (
                      <>
                        <input className="input research-num" title={t('sweep.grid_from')} value={axis.from}
                          onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, from: e.target.value } : a))} />
                        <input className="input research-num" title={t('sweep.grid_to')} value={axis.to}
                          onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, to: e.target.value } : a))} />
                        <input className="input research-num" title={t('sweep.grid_steps')} value={axis.steps}
                          onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, steps: e.target.value } : a))} />
                      </>
                    )}
                    {axis.mode === 'list' && (
                      <input className="input sweep-list-input" title={t('sweep.list_values')} value={axis.list}
                        onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, list: e.target.value } : a))} />
                    )}
                    {axis.mode === 'lhs' && (
                      <>
                        <input className="input research-num" title={t('sweep.lhs_n')} value={axis.n}
                          onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, n: e.target.value } : a))} />
                        <input className="input research-num" title={t('sweep.lhs_seed')} value={axis.seed}
                          onChange={(e) => setAxesDraft((arr) => arr.map((a, j) => j === i ? { ...a, seed: e.target.value } : a))} />
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setAxesDraft((arr) => arr.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="sweep-actions">
                  <span className="figures-panel-meta">{t('sweep.cell_count', { count: previewCount })}</span>
                  <button type="button" className="btn" onClick={handleSave}>
                    {t('sweep.save_plan')}
                  </button>
                  {running ? (
                    <button type="button" className="btn btn-danger" onClick={cancel}>
                      {t('sweep.cancel_run')}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" disabled={previewCount === 0}
                        onClick={() => void runDraft(false)}>
                        {t('sweep.run')}
                      </button>
                      {result && result.cells.length < result.total && (
                        <button type="button" className="btn" onClick={() => void runDraft(true)}>
                          {t('sweep.resume')}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {running && progress && (
                  <div className="analysis-output">
                    {t('sweep.progress', { done: progress.done, total: progress.total })}
                  </div>
                )}
              </div>
            )}

            {shownResult && (
              <div className="sweep-results">
                <div className="sweep-result-head">
                  <h2 className="figures-subtitle">
                    {t('sweep.cells')} — {statusKey ? t(statusKey) : ''} ({shownResult.cells.length}/{shownResult.total})
                  </h2>
                  <button type="button" className="btn btn-sm" onClick={sendSurface}>
                    {t('sweep.to_figure')}
                  </button>
                </div>
                {shownResult.lastError && (
                  <p className="analysis-error">
                    {t('sweep.last_error')}: {shownResult.lastError}
                  </p>
                )}

                {surface && (
                  <div className="research-chart-card">
                    {surface.kind === 'line' ? (
                      <div className="analysis-svg" dangerouslySetInnerHTML={{ __html: renderSVG(surface.spec) }} />
                    ) : (
                      <HeatMap
                        xVals={surface.xVals}
                        yVals={surface.yVals}
                        grid={surface.grid}
                        lo={surface.lo}
                        hi={surface.hi}
                        xName={surface.xName}
                        yName={surface.yName}
                        colorAt={heatColor}
                      />
                    )}
                  </div>
                )}

                <div className="sweep-table-wrap">
                  <table className="sweep-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('sweep.col_params')}</th>
                        <th>{t('sweep.col_rep')}</th>
                        <th>{t('sweep.col_value')}</th>
                        <th>{t('sweep.col_seed')}</th>
                        <th>{t('sweep.col_duration')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownResult.cells.map((c, i) => (
                        <tr key={c.key}>
                          <td>{i + 1}</td>
                          <td>{Object.entries(c.params).map(([k, v]) => `${k}=${fmtNum(Number(v), 5)}`).join(', ')}</td>
                          <td>{c.rep}</td>
                          <td>{fmtNum(c.value, 7)}</td>
                          <td>{c.seed >>> 0}</td>
                          <td>{c.durationMs ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function HeatMap(props: {
  xVals: number[];
  yVals: number[];
  grid: number[][];
  lo: number;
  hi: number;
  xName: string;
  yName: string;
  colorAt: (v: number, lo: number, hi: number) => string;
}) {
  const { xVals, yVals, grid, lo, hi, xName, yName, colorAt } = props;
  const cell = 34;
  const pad = 70;
  const w = pad + xVals.length * cell + 20;
  const h = pad + yVals.length * cell + 30;
  return (
    <svg className="sweep-heat" width={w} height={h} role="img">
      {grid.map((row, yi) =>
        row.map((v, xi) => (
          <rect
            key={`${xi}-${yi}`}
            x={pad + xi * cell}
            y={h - 60 - (yi + 1) * cell}
            width={cell - 1}
            height={cell - 1}
            fill={colorAt(v, lo, hi)}
          >
            <title>{`${xName}=${xVals[xi]}, ${yName}=${yVals[yi]}: ${fmtNum(v, 5)}`}</title>
          </rect>
        )),
      )}
      {xVals.map((x, i) => (
        <text key={`x${i}`} x={pad + i * cell + cell / 2} y={h - 42} fontSize={10} textAnchor="middle">
          {fmtNum(x, 4)}
        </text>
      ))}
      {yVals.map((y, i) => (
        <text key={`y${i}`} x={pad - 6} y={h - 60 - (i + 1) * cell + cell / 2 + 3} fontSize={10} textAnchor="end">
          {fmtNum(y, 4)}
        </text>
      ))}
      <text x={pad + (xVals.length * cell) / 2} y={h - 20} fontSize={11} textAnchor="middle">
        {xName}
      </text>
      <text x={14} y={h / 2} fontSize={11} textAnchor="middle" transform={`rotate(-90 14 ${h / 2})`}>
        {yName}
      </text>
    </svg>
  );
}
