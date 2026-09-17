// ==========================================================================
// Sweep Studio — persisted plan list (left rail)
// ==========================================================================

import type { TFn } from '../useSweepExecution';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';

export interface PlanListProps {
  t: TFn;
  plans: SweepPlan[];
  results: Record<string, SweepResult>;
  selectedId: string | null;
  running: boolean;
  onSelect: (plan: SweepPlan) => void;
  onNew: () => void;
  onEdit: (plan: SweepPlan) => void;
  onDelete: (plan: SweepPlan) => void;
}

export function PlanList({
  t,
  plans,
  results,
  selectedId,
  running,
  onSelect,
  onNew,
  onEdit,
  onDelete,
}: PlanListProps) {
  return (
    <aside className="figures-side">
      <div className="figures-side-header">
        <h2 className="figures-subtitle">{t('sweep.plans')}</h2>
        <button type="button" className="btn btn-sm btn-primary" disabled={running} onClick={onNew}>
          + {t('sweep.new_plan')}
        </button>
      </div>
      {plans.length === 0 && <div className="empty-hint">{t('sweep.no_plans')}</div>}
      <ul className="figures-panel-list">
        {plans.map((plan) => {
          const result = results[plan.id];
          return (
            <li
              key={plan.id}
              className={`figures-panel-item${selectedId === plan.id ? ' figures-panel-active' : ''}`}
            >
              <button
                type="button"
                className="figures-panel-select"
                disabled={running}
                onClick={() => onSelect(plan)}
              >
                <div className="figures-panel-name">{plan.name}</div>
                <div className="figures-panel-meta">
                  {plan.axes.length} axes · {plan.source}
                  {result ? ` · ${result.cells.length}/${result.total}` : ''}
                </div>
              </button>
              <div className="figures-panel-actions">
                <button type="button" className="btn btn-sm" disabled={running} onClick={() => onEdit(plan)}>
                  {t('figure.edit')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={running}
                  onClick={() => onDelete(plan)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
