import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useExperimentStore } from '@/stores/experimentStore';
import { useAppStore } from '@/stores/appStore';
import {
  diffRuns,
  runDiffToJson,
  type RunDiff,
} from '@/core/repro/lock';
import type { RunRecord } from '@/core/experiment/record';
import { downloadBlob } from '@/core/download';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CloseIcon } from '@/components/icons';
import { ToolShell } from '@/components/ToolShell';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function fmtValue(v: unknown): string {
  if (typeof v === 'number') return String(Number(v.toPrecision(6)));
  if (v === undefined || v === null) return '—';
  return JSON.stringify(v) ?? '—';
}

/**
 * Run history + comparison (experiment tracking, FR-11 structured diff).
 * Pick any two runs, press Compare: parameter / metric (with tolerance) /
 * configuration sections, exportable as diff JSON.
 */
export default function RunsPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const runs = useExperimentStore((s) => s.runs);
  const loading = useExperimentStore((s) => s.loading);
  const loadRuns = useExperimentStore((s) => s.loadRuns);
  const removeRun = useExperimentStore((s) => s.removeRun);
  const clearRuns = useExperimentStore((s) => s.clearRuns);
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<RunDiff | null>(null);
  /** Pending destructive action — every delete/clear goes through a modal. */
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'one'; id: string } | { kind: 'all' } | null
  >(null);

  useEffect(() => {
    void loadRuns();
    setSelected([]);
    setDiff(null);
  }, [loadRuns]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  const a = selected.length >= 1 ? runs.find((r) => r.id === selected[0]) : undefined;
  const b = selected.length >= 2 ? runs.find((r) => r.id === selected[1]) : undefined;

  const handleCompare = () => {
    if (!a || !b) return;
    setDiff(diffRuns(a, b));
  };

  const handleExportDiff = () => {
    if (!diff) return;
    downloadBlob('run-diff.json', new TextEncoder().encode(runDiffToJson(diff)), 'application/json');
    notify('success', t('repro2.diff_exported'));
  };

  return (
    <ToolShell toolId="runs">
      <div className="runs-dialog">
        {runs.length === 0 && !loading && (
          <p className="runs-empty">{t('research.runs.empty')}</p>
        )}
        {runs.length > 0 && (
          <table className="runs-table">
            <thead>
              <tr>
                <th />
                <th>{t('research.runs.time')}</th>
                <th>{t('research.runs.source')}</th>
                <th>{t('research.runs.duration')}</th>
                <th>{t('research.runs.params')}</th>
                <th>{t('research.runs.metrics')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run: RunRecord) => (
                <tr key={run.id} className={selected.includes(run.id) ? 'row-selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t('research.runs.compare')}
                      checked={selected.includes(run.id)}
                      onChange={() => toggleSelect(run.id)}
                    />
                  </td>
                  <td>{fmtTime(run.createdAt)}</td>
                  <td>
                    {run.source}
                    {run.failed ? ` · ${t('research.runs.failed')}` : ''}
                  </td>
                  <td>{fmtDuration(run.durationMs)}</td>
                  <td>{Object.keys(run.params).length}</td>
                  <td>{Object.keys(run.metrics).length}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('research.runs.delete')}
                      onClick={() => setDeleteTarget({ kind: 'one', id: run.id })}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="runs-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!a || !b}
            onClick={handleCompare}
          >
            {t('repro2.compare')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!diff}
            onClick={handleExportDiff}
          >
            {t('repro2.export_diff')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={runs.length === 0}
            onClick={() => setDeleteTarget({ kind: 'all' })}
          >
            {t('research.runs.clear')}
          </button>
          <span className="runs-hint">{t('repro2.compare_hint')}</span>
        </div>

        {diff && (
          <div className="runs-diff">
            <h3>{t('research.runs.diff')}</h3>
            <p className="runs-diff-meta">
              {fmtTime(diff.runA.createdAt)} ↔ {fmtTime(diff.runB.createdAt)}
              {' · '}
              {diff.sameParams ? t('research.runs.same_params') : `${diff.params.length} ${t('research.runs.param_changes')}`}
              {' · '}
              {diff.sameInputs ? t('research.runs.same_inputs') : t('research.runs.diff_inputs')}
              {' · '}
              {t('repro2.tolerance')}: {diff.tolerance.toExponential(0)}
            </p>

            <h4 className="share-section-title">{t('repro2.diff_params')}</h4>
            {diff.params.length > 0 ? (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>{t('research.runs.params')}</th>
                    <th>{t('research.runs.a')}</th>
                    <th>{t('research.runs.b')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.params.map((c) => (
                    <tr key={c.key}>
                      <td>{c.key} <span className="runs-diff-kind">{c.kind}</span></td>
                      <td>{fmtValue(c.a)}</td>
                      <td>{fmtValue(c.b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="runs-empty">{t('repro2.diff_none')}</p>
            )}

            <h4 className="share-section-title">{t('repro2.diff_metrics')}</h4>
            {diff.metrics.length > 0 ? (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>{t('research.runs.metric')}</th>
                    <th>{t('research.runs.a')}</th>
                    <th>{t('research.runs.b')}</th>
                    <th>{t('repro2.delta')}</th>
                    <th>{t('repro2.tolerance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.metrics.map((c) => (
                    <tr key={c.key}>
                      <td>{c.key}</td>
                      <td>{fmtValue(c.a)}</td>
                      <td>{fmtValue(c.b)}</td>
                      <td className={c.delta > 0 ? 'delta-up' : 'delta-down'}>
                        {fmtValue(Number(c.delta.toPrecision(6)))}
                      </td>
                      <td>{c.withinTolerance ? t('repro2.within_tol') : c.relError.toExponential(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="runs-empty">{t('repro2.diff_none')}</p>
            )}

            <h4 className="share-section-title">{t('repro2.diff_config')}</h4>
            {diff.config.length > 0 ? (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>{t('repro2.diff_config')}</th>
                    <th>{t('research.runs.a')}</th>
                    <th>{t('research.runs.b')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.config.map((c) => (
                    <tr key={c.key}>
                      <td>{c.key}</td>
                      <td>{fmtValue(c.a)}</td>
                      <td>{fmtValue(c.b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="runs-empty">{t('repro2.diff_none')}</p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === 'all' ? t('research.runs.clear') : t('research.runs.delete')}
        message={
          deleteTarget?.kind === 'all'
            ? t('research.runs.clear_confirm', { count: runs.length })
            : t('research.runs.delete_confirm')
        }
        confirmLabel={t('common.delete')}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === 'all') void clearRuns();
          else void removeRun(deleteTarget.id);
        }}
      />
    </ToolShell>
  );
}
