import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useExperimentStore } from '@/stores/experimentStore';
import { diffRuns, formatChange } from '@/core/experiment/diff';
import type { RunRecord } from '@/core/experiment/record';

interface RunHistoryDialogProps {
  open: boolean;
  onClose: () => void;
}

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
  return JSON.stringify(v) ?? '—';
}

/**
 * Run history + comparison (experiment tracking). Pick any two runs to see a
 * parameter / metric diff — the everyday "what changed between these two
 * results?" question.
 */
export function RunHistoryDialog({ open, onClose }: RunHistoryDialogProps) {
  const t = useT();
  const runs = useExperimentStore((s) => s.runs);
  const loading = useExperimentStore((s) => s.loading);
  const loadRuns = useExperimentStore((s) => s.loadRuns);
  const removeRun = useExperimentStore((s) => s.removeRun);
  const clearRuns = useExperimentStore((s) => s.clearRuns);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      void loadRuns();
      setSelected([]);
    }
  }, [open, loadRuns]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  const a = selected.length >= 1 ? runs.find((r) => r.id === selected[0]) : undefined;
  const b = selected.length >= 2 ? runs.find((r) => r.id === selected[1]) : undefined;
  const diff = a && b ? diffRuns(a, b) : null;

  return (
    <Modal open={open} onClose={onClose} title={t('research.runs.title')} width={860}>
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
                      onClick={() => void removeRun(run.id)}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="runs-actions">
          <button type="button" className="btn" onClick={() => void clearRuns()}>
            {t('research.runs.clear')}
          </button>
          <span className="runs-hint">{t('research.runs.hint')}</span>
        </div>

        {diff && (
          <div className="runs-diff">
            <h3>{t('research.runs.diff')}</h3>
            <p className="runs-diff-meta">
              {fmtTime(a!.createdAt)} ↔ {fmtTime(b!.createdAt)}
              {' · '}
              {diff.sameParams ? t('research.runs.same_params') : `${diff.paramChanges.length} ${t('research.runs.param_changes')}`}
              {' · '}
              {diff.sameInputs ? t('research.runs.same_inputs') : t('research.runs.diff_inputs')}
            </p>
            {diff.paramChanges.length > 0 && (
              <ul className="runs-diff-list">
                {diff.paramChanges.map((c) => (
                  <li key={c.key}>{formatChange(c)}</li>
                ))}
              </ul>
            )}
            {diff.metricChanges.length > 0 && (
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>{t('research.runs.metric')}</th>
                    <th>{t('research.runs.a')}</th>
                    <th>{t('research.runs.b')}</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.metricChanges.map((c) => (
                    <tr key={c.key}>
                      <td>{c.key}</td>
                      <td>{fmtValue(c.a)}</td>
                      <td>{fmtValue(c.b)}</td>
                      <td className={c.delta > 0 ? 'delta-up' : 'delta-down'}>
                        {fmtValue(Number(c.delta.toPrecision(6)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {diff.paramChanges.length === 0 && diff.metricChanges.length === 0 && (
              <p className="runs-empty">{t('research.runs.no_diff')}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
