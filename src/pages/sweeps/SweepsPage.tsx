// ==========================================================================
// Ergalics Studio — Sweep Studio (/sweeps, F2 / FR2.4–FR2.7)
//
// Composition root only. The page wires stores and the execution hook
// together and delegates rendering/state-free logic to focused modules:
//   draft.ts            editor draft ↔ plan mapping + field validation
//   surface.ts          response-surface derivation
//   useSweepExecution   run/resume/cancel lifecycle
//   components/*        PlanList, PlanEditor, SweepResults, HeatMap
// ==========================================================================

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useResearchStore } from '@/stores/researchStore';
import { expandPlan } from '@/core/sweep/design';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import { sendSpecToFigure } from '../research/researchUi';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ToolShell } from '@/components/ToolShell';
import {
  buildPlanDraft,
  draftFromPlan,
  emptyDraft,
  newPlan,
  resultMatchesPlan,
} from './draft';
import type { DraftIssue, PlanDraft } from './draft';
import { buildSurface } from './surface';
import { useSweepExecution } from './useSweepExecution';
import { PlanList } from './components/PlanList';
import { PlanEditor } from './components/PlanEditor';
import { SweepResults } from './components/SweepResults';

export default function SweepsPage() {
  const t = useT();
  const navigate = useNavigate();
  const notify = useAppStore((state) => state.notify);
  const project = useProjectStore((state) => state.project);
  const savePlan = useResearchStore((state) => state.savePlan);
  const deletePlanStore = useResearchStore((state) => state.deletePlan);
  const saveResult = useResearchStore((state) => state.saveSweepResult);

  const plans = project?.state.sweeps ?? [];
  const results = project?.state.sweepResults ?? {};

  const [selectedId, setSelectedId] = useState<string | null>(plans[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(() => emptyDraft());
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SweepPlan | null>(null);

  const plan = plans.find((p) => p.id === selectedId) ?? null;
  const persistedResult: SweepResult | null = plan ? results[plan.id] ?? null : null;

  const execution = useSweepExecution({ saveResult, notify, t });
  const { running, progress, liveResult } = execution;

  // Validate the draft on every change (cheap, pure) for the live cell count;
  // submit-time validation surfaces the same issues inline.
  const built = useMemo(
    () => buildPlanDraft(draft, { id: selectedId ?? undefined, createdAt: plan?.createdAt }),
    [draft, selectedId, plan?.createdAt],
  );
  const previewCount = built.plan ? expandPlan(built.plan).length : 0;

  // A stored result only belongs to the current plan if every cell key still
  // exists in the expanded design and the totals agree.
  const storedResult = resultMatchesPlan(plan, persistedResult) ? persistedResult : null;
  const shownResult: SweepResult | null = liveResult ?? storedResult;
  const canResume = !!storedResult && storedResult.cells.length < storedResult.total;

  // ---- selection / draft lifecycle ----

  const selectPlan = (next: SweepPlan) => {
    setSelectedId(next.id);
    setEditing(false);
    setIssues([]);
    execution.reset();
  };

  const beginNew = () => {
    const seed = newPlan();
    setSelectedId(seed.id);
    setDraft(draftFromPlan(seed));
    setIssues([]);
    execution.reset();
    setEditing(true);
  };

  const editPlan = (next: SweepPlan) => {
    setSelectedId(next.id);
    setDraft(draftFromPlan(next));
    setIssues([]);
    execution.reset();
    setEditing(true);
  };

  const handleDraftChange = (next: PlanDraft) => {
    setDraft(next);
    setIssues([]);
  };

  const firstIssueMessage = (list: DraftIssue[]): string => {
    const first = list[0];
    return first ? t(first.key, first.params) : t('sweep.plan_invalid', { reason: 'invalid' });
  };

  const handleSave = () => {
    if (!built.plan) {
      setIssues(built.issues);
      notify('error', t('sweep.plan_invalid', { reason: firstIssueMessage(built.issues) }));
      return;
    }
    savePlan(built.plan);
    setSelectedId(built.plan.id);
    setIssues([]);
    setEditing(false);
  };

  const runDraft = async (resume: boolean) => {
    if (!built.plan) {
      setIssues(built.issues);
      notify('error', t('sweep.plan_invalid', { reason: firstIssueMessage(built.issues) }));
      return;
    }
    savePlan(built.plan);
    setSelectedId(built.plan.id);
    setIssues([]);
    setEditing(false);
    await execution.run({
      plan: built.plan,
      resume,
      existing: resume ? results[built.plan.id] ?? null : null,
    });
  };

  const runStored = async (resume: boolean) => {
    if (!plan) return;
    await execution.run({ plan, resume, existing: results[plan.id] ?? null });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deletePlanStore(deleteTarget.id);
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
      setEditing(false);
      execution.reset();
    }
    setDeleteTarget(null);
  };

  const sendSurface = () => {
    if (!shownResult || !plan || !buildSurface(plan, shownResult)) {
      notify('error', t('sweep.figure_failed'));
      return;
    }
    const surface = buildSurface(plan, shownResult)!;
    const caption = `${plan.name}: ${plan.axes.map((a) => a.param).join(' × ')} → ${plan.metric}`;
    if (sendSpecToFigure(t('sweep.title'), surface.spec, caption)) {
      notify('success', t('sweep.figure_sent'));
      void navigate('/studio/figures');
    }
  };

  return (
    <ToolShell toolId="sweeps">
      {project ? (
        <div className="figures-main">
          <PlanList
            t={t}
            plans={plans}
            results={results}
            selectedId={selectedId}
            running={running}
            onSelect={selectPlan}
            onNew={beginNew}
            onEdit={editPlan}
            onDelete={setDeleteTarget}
          />

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
                  <button type="button" className="btn btn-sm" disabled={running} onClick={() => editPlan(plan)}>
                    {t('figure.edit')}
                  </button>
                </div>
                {persistedResult && !storedResult && (
                  <p className="analysis-note">{t('sweep.result_stale')}</p>
                )}
                <div className="sweep-actions">
                  {running ? (
                    <button type="button" className="btn btn-danger" onClick={execution.cancel}>
                      {t('sweep.cancel_run')}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => void runStored(false)}>
                        {t('sweep.run')}
                      </button>
                      {canResume && (
                        <button type="button" className="btn" onClick={() => void runStored(true)}>
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
              <PlanEditor
                t={t}
                draft={draft}
                issues={issues}
                previewCount={previewCount}
                running={running}
                progress={progress}
                canResume={canResume}
                onChange={handleDraftChange}
                onSave={handleSave}
                onRun={() => void runDraft(false)}
                onResume={() => void runDraft(true)}
                onCancel={execution.cancel}
              />
            )}

            {shownResult && plan && (
              <SweepResults t={t} plan={plan} result={shownResult} onSendSurface={sendSurface} />
            )}
          </section>
        </div>
      ) : (
        <div className="empty-hint">{t('sweep.need_project')}</div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('sweep.delete')}
        message={deleteTarget ? t('sweep.delete_confirm', { name: deleteTarget.name }) : ''}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </ToolShell>
  );
}
