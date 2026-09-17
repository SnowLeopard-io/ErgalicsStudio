// ==========================================================================
// Sweep Studio — plan editor with inline field validation
// ==========================================================================

import type { ChangeEvent } from 'react';
import type { TFn } from '../useSweepExecution';
import type { AxisDraft, DraftIssue, PlanDraft } from '../draft';
import { EMPTY_AXIS, MAX_AXES, SOURCES } from '../draft';
import type { SweepSource } from '@/core/sweep/types';

export interface PlanEditorProps {
  t: TFn;
  draft: PlanDraft;
  issues: DraftIssue[];
  previewCount: number;
  running: boolean;
  progress: { done: number; total: number } | null;
  canResume: boolean;
  onChange: (next: PlanDraft) => void;
  onSave: () => void;
  onRun: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function PlanEditor({
  t,
  draft,
  issues,
  previewCount,
  running,
  progress,
  canResume,
  onChange,
  onSave,
  onRun,
  onResume,
  onCancel,
}: PlanEditorProps) {
  const issueByField = new Map(issues.map((issue) => [issue.field, issue]));
  const axesIssue = issues.find((issue) => issue.field === 'axes');
  const errorText = (field: string): string | null => {
    const issue = issueByField.get(field);
    return issue ? t(issue.key, issue.params) : null;
  };

  const patch = (partial: Partial<PlanDraft>) => onChange({ ...draft, ...partial });
  const patchAxis = (index: number, partial: Partial<AxisDraft>) =>
    onChange({
      ...draft,
      axes: draft.axes.map((axis, i) => (i === index ? { ...axis, ...partial } : axis)),
    });

  const fieldError = (field: string, className = 'sweep-field-error') => {
    const text = errorText(field);
    return text ? (
      <p className={className} role="alert">
        {text}
      </p>
    ) : null;
  };

  const invalidProps = (field: string) => ({
    'aria-invalid': errorText(field) ? true : undefined,
  });

  return (
    <div className="sweep-editor">
      <div className="figures-field">
        <label className="figures-label">{t('sweep.name')}</label>
        <input
          className="input"
          value={draft.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ name: e.target.value })}
        />
        {fieldError('name')}
      </div>
      <div className="sweep-row">
        <label className="figures-label">{t('sweep.source')}
          <select
            className="input"
            value={draft.source}
            onChange={(e) => patch({ source: e.target.value as SweepSource })}
          >
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="figures-label">{t('sweep.source_ref')}
          <input
            className="input"
            value={draft.sourceRef}
            onChange={(e) => patch({ sourceRef: e.target.value })}
          />
        </label>
        <label className="figures-label">{t('sweep.repeats')}
          <input
            className="input research-num"
            type="number"
            min={1}
            value={draft.repeats}
            {...invalidProps('repeats')}
            onChange={(e) => patch({ repeats: e.target.value })}
          />
        </label>
      </div>
      {fieldError('repeats')}
      <div className="sweep-row">
        <label className="figures-label">{t('sweep.metric')}
          <input
            className="input"
            value={draft.metric}
            {...invalidProps('metric')}
            onChange={(e) => patch({ metric: e.target.value })}
          />
        </label>
        <label className="figures-label">{t('sweep.expression')}
          <input
            className="input"
            value={draft.expression}
            {...invalidProps('expression')}
            onChange={(e) => patch({ expression: e.target.value })}
          />
        </label>
      </div>
      {fieldError('metric')}
      {fieldError('expression')}
      <p className="figures-field-hint">{t('sweep.expression_hint')}</p>

      <div className="figures-field">
        <label className="figures-label">{t('sweep.base_params')}</label>
        <textarea
          className="input"
          rows={2}
          value={draft.baseParams}
          {...invalidProps('baseParams')}
          onChange={(e) => patch({ baseParams: e.target.value })}
        />
        {fieldError('baseParams')}
      </div>

      <div className="figures-side-header">
        <h2 className="figures-subtitle">{t('sweep.axes')}</h2>
        <button
          type="button"
          className="btn btn-sm"
          disabled={draft.axes.length >= MAX_AXES}
          onClick={() => patch({ axes: [...draft.axes, { ...EMPTY_AXIS }] })}
        >
          + {t('sweep.add_axis')}
        </button>
      </div>
      {axesIssue && (
        <p className="sweep-field-error" role="alert">
          {t(axesIssue.key, axesIssue.params)}
        </p>
      )}
      {draft.axes.map((axis, i) => (
        <div key={i} className="sweep-axis">
          <input
            className="input"
            placeholder={t('sweep.axis_param')}
            value={axis.param}
            {...invalidProps(`axes.${i}.param`)}
            onChange={(e) => patchAxis(i, { param: e.target.value })}
          />
          <select
            className="input"
            value={axis.mode}
            onChange={(e) => patchAxis(i, { mode: e.target.value as AxisDraft['mode'] })}
          >
            <option value="grid">{t('sweep.mode_grid')}</option>
            <option value="list">{t('sweep.mode_list')}</option>
            <option value="lhs">{t('sweep.mode_lhs')}</option>
          </select>
          {axis.mode === 'grid' && (
            <>
              <input
                className="input research-num"
                title={t('sweep.grid_from')}
                value={axis.from}
                {...invalidProps(`axes.${i}.from`)}
                onChange={(e) => patchAxis(i, { from: e.target.value })}
              />
              <input
                className="input research-num"
                title={t('sweep.grid_to')}
                value={axis.to}
                {...invalidProps(`axes.${i}.to`)}
                onChange={(e) => patchAxis(i, { to: e.target.value })}
              />
              <input
                className="input research-num"
                title={t('sweep.grid_steps')}
                value={axis.steps}
                {...invalidProps(`axes.${i}.steps`)}
                onChange={(e) => patchAxis(i, { steps: e.target.value })}
              />
            </>
          )}
          {axis.mode === 'list' && (
            <input
              className="input sweep-list-input"
              title={t('sweep.list_values')}
              value={axis.list}
              {...invalidProps(`axes.${i}.list`)}
              onChange={(e) => patchAxis(i, { list: e.target.value })}
            />
          )}
          {axis.mode === 'lhs' && (
            <>
              <input
                className="input research-num"
                title={t('sweep.lhs_n')}
                value={axis.n}
                {...invalidProps(`axes.${i}.n`)}
                onChange={(e) => patchAxis(i, { n: e.target.value })}
              />
              <input
                className="input research-num"
                title={t('sweep.lhs_seed')}
                value={axis.seed}
                {...invalidProps(`axes.${i}.seed`)}
                onChange={(e) => patchAxis(i, { seed: e.target.value })}
              />
            </>
          )}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            aria-label={t('sweep.remove_axis')}
            onClick={() => patch({ axes: draft.axes.filter((_, j) => j !== i) })}
          >
            ×
          </button>
          {fieldError(`axes.${i}.param`) ||
            fieldError(`axes.${i}.from`) ||
            fieldError(`axes.${i}.to`) ||
            fieldError(`axes.${i}.steps`) ||
            fieldError(`axes.${i}.list`) ||
            fieldError(`axes.${i}.n`) ||
            fieldError(`axes.${i}.seed`)}
        </div>
      ))}

      <div className="sweep-actions">
        <span className="figures-panel-meta">{t('sweep.cell_count', { count: previewCount })}</span>
        <button type="button" className="btn" onClick={onSave}>
          {t('sweep.save_plan')}
        </button>
        {running ? (
          <button type="button" className="btn btn-danger" onClick={onCancel}>
            {t('sweep.cancel_run')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={previewCount === 0} onClick={onRun}>
              {t('sweep.run')}
            </button>
            {canResume && (
              <button type="button" className="btn" onClick={onResume}>
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
  );
}
