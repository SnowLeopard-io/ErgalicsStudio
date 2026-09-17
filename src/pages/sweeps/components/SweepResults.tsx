// ==========================================================================
// Sweep Studio — results panel: response-surface chart + flat cell table
// ==========================================================================

import { useMemo } from 'react';
import { renderSVG } from '@/core/plot';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import { fmt as fmtNum } from '@/pages/research/researchUi';
import type { TFn } from '../useSweepExecution';
import { buildSurface, heatColor } from '../surface';
import { HeatMap } from './HeatMap';

export interface SweepResultsProps {
  t: TFn;
  plan: SweepPlan;
  result: SweepResult;
  onSendSurface: () => void;
}

export function SweepResults({ t, plan, result, onSendSurface }: SweepResultsProps) {
  const surface = useMemo(() => buildSurface(plan, result), [plan, result]);
  const statusKey = `sweep.status_${result.status}`;

  return (
    <div className="sweep-results">
      <div className="sweep-result-head">
        <h2 className="figures-subtitle">
          {t('sweep.cells')} — {t(statusKey)} ({result.cells.length}/{result.total})
        </h2>
        <button type="button" className="btn btn-sm" onClick={onSendSurface}>
          {t('sweep.to_figure')}
        </button>
      </div>
      {result.lastError && (
        <p className="analysis-error">
          {t('sweep.last_error')}: {result.lastError}
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
            {result.cells.map((cell, i) => (
              <tr key={cell.key}>
                <td>{i + 1}</td>
                <td>
                  {Object.entries(cell.params)
                    .map(([k, v]) => `${k}=${fmtNum(Number(v), 5)}`)
                    .join(', ')}
                </td>
                <td>{cell.rep}</td>
                <td>{fmtNum(cell.value, 7)}</td>
                <td>{cell.seed >>> 0}</td>
                <td>{cell.durationMs ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
