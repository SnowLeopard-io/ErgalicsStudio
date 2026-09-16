// ==========================================================================
// Ergalics Studio — Repro Lock page (F6 / FR6.1–FR6.5)
//
// Builds a `repro.lock` (data fingerprints, code snapshots, param hashes,
// seeds, versions) from selected run records, verifies the current project
// item by item (pass / warn / fail drift table), imports a foreign lock for
// comparison, downloads the lock JSON, and can rerun locked runs through
// registered source runners with tolerance assertions.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import {
  buildLock,
  lockToJson,
  parseLock,
  verifyLock,
  reproduceWithLock,
  type ReproLock,
  type LockVerifyResult,
  type LockReproReport,
  type LockRunReproResult,
  type LockMetricResult,
} from '@/core/repro/lock';
import { downloadBlob } from '@/core/download';
import { fmt } from '../research/researchUi';
import { LabPageShell } from './LabPageShell';

export default function ReproLockPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const runs = useExperimentStore((s) => s.runs);
  const loadRuns = useExperimentStore((s) => s.loadRuns);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lock, setLock] = useState<ReproLock | null>(null);
  const [verify, setVerify] = useState<LockVerifyResult | null>(null);
  const [repro, setRepro] = useState<LockReproReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Default selection = all successful runs.
  useEffect(() => {
    setSelected(new Set(runs.filter((r) => !r.failed).map((r) => r.id)));
  }, [runs]);

  const successful = useMemo(() => runs.filter((r) => !r.failed), [runs]);

  const toggle = (id: string) => {
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBuild = () => {
    if (!project) return;
    const chosen = runs.filter((r) => selected.has(r.id));
    const l = buildLock(project, { runs: chosen, runIds: chosen.map((r) => r.id) });
    setLock(l);
    setVerify(verifyLock(l, project, { runs }));
    setRepro(null);
  };

  const handleDownload = () => {
    if (!lock) return;
    downloadBlob('repro.lock', new TextEncoder().encode(lockToJson(lock)), 'application/json');
    notify('success', t('reprolock.exported'));
  };

  const handleImport = async (file: File) => {
    if (!project) return;
    try {
      const text = await file.text();
      const l = parseLock(text);
      if (l.projectId !== project.id) {
        notify('error', t('reprolock.parse_failed', { reason: 'projectId mismatch' }));
      }
      setLock(l);
      setVerify(verifyLock(l, project, { runs }));
      setRepro(null);
    } catch (err) {
      notify('error', t('reprolock.parse_failed', { reason: String(err) }));
    }
  };

  const handleReproduce = async () => {
    if (!lock) return;
    setBusy(true);
    setRepro(null);
    setProgress({ done: 0, total: lock.runs.length });
    try {
      const report = await reproduceWithLock(lock, {
        runs,
        // Source runners register here once the workbench surfaces expose
        // rerun APIs; absent runners are reported as 'missing-runner'.
        runners: {},
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setRepro(report);
    } catch (err) {
      notify('error', String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <LabPageShell title={t('reprolock.title')}>
      <div className="analysis-body">
        <p className="analysis-note">{t('reprolock.intro')}</p>

        <div className="repro-runs">
          <div className="figures-side-header">
            <h4 className="share-section-title">
              {t('reprolock.runs')} ({selected.size}/{successful.length})
            </h4>
            <label className="research-check">
              <input
                type="checkbox"
                checked={selected.size === successful.length && successful.length > 0}
                onChange={(e) =>
                  setSelected(new Set(e.target.checked ? successful.map((r) => r.id) : []))
                }
              />
              {t('reprolock.select_all')}
            </label>
          </div>
          <div className="repro-run-list">
            {successful.length === 0 && <div className="empty-hint">{t('reprolock.no_runs')}</div>}
            {successful.map((r) => (
              <label key={r.id} className="research-check repro-run-row">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <code>{r.id.slice(0, 8)}</code>
                <span>{r.source}</span>
                {r.seed !== null && <span>seed {r.seed >>> 0}</span>}
                <span className="figures-panel-meta">{r.label ?? ''}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sweep-actions">
          <button type="button" className="btn btn-primary" disabled={selected.size === 0} onClick={handleBuild}>
            {t('reprolock.build')}
          </button>
          <button type="button" className="btn" disabled={!lock} onClick={handleDownload}>
            {t('reprolock.download')}
          </button>
          <label className="btn repro-import">
            {t('reprolock.import')}
            <input
              type="file"
              accept=".lock,.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!lock || busy}
            onClick={() => void handleReproduce()}
          >
            {busy && progress ? `${t('reprolock.reproducing')} ${progress.done}/${progress.total}` : t('reprolock.reproduce')}
          </button>
        </div>

        {verify && (
          <div className="repro-verify">
            <h4 className={`repro-status repro-status-${verify.status}`}>
              {t(`reprolock.status_${verify.status === 'pass' ? 'pass' : verify.status === 'fail' ? 'fail' : 'warn'}`)}
            </h4>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('reprolock.drift_kind')}</th>
                    <th>{t('reprolock.drift_target')}</th>
                    <th>{t('reprolock.drift_detail')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {verify.drifts.map((d, i) => (
                    <tr key={i} className={`repro-drift-${d.severity}`}>
                      <td>
                        <span className={`profile-badge profile-badge-${d.severity === 'fail' ? 'high' : 'low'}`}>
                          {t(`reprolock.category_${d.category}`)}
                        </span>{' '}
                        {d.kind}
                      </td>
                      <td><code>{d.target}</code></td>
                      <td>{d.message}</td>
                      <td className={`repro-sev-${d.severity}`}>{t(`reprolock.status_${d.severity === 'fail' ? 'fail' : 'warn'}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {repro && (
          <div className="repro-repro">
            <h4 className={`repro-status repro-status-${repro.status === 'pass' ? 'pass' : 'fail'}`}>
              {t('reprolock.repro_pass', {
                pass: repro.results.filter((r) => r.status === 'pass').length,
                total: repro.results.length,
              })}
            </h4>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>run</th>
                    <th>status</th>
                    <th>{t('reprolock.metric')}</th>
                    <th>{t('reprolock.expected')}</th>
                    <th>{t('reprolock.actual')}</th>
                    <th>{t('reprolock.tolerance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {repro.results
                    .flatMap(
                      (r): Array<{ run: LockRunReproResult; metric: LockMetricResult | null }> =>
                        r.metrics.length === 0
                          ? [{ run: r, metric: null }]
                          : r.metrics.map((m) => ({ run: r, metric: m })),
                    )
                    .map(({ run: r, metric: m }, i) => (
                      <tr key={i}>
                        <td><code>{r.runId.slice(0, 8)}</code> {m ? '' : r.status}</td>
                        <td>{m ? '' : r.error ?? r.status}</td>
                        <td>{m?.name ?? ''}</td>
                        <td>{m ? fmt(m.expected ?? Number.NaN) : ''}</td>
                        <td>{m ? fmt(m.actual) : ''}</td>
                        <td>{m ? fmt(m.tolerance) : ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {repro.results.some((r) => r.status === 'missing-runner') && (
              <p className="analysis-note">{t('reprolock.runner_missing')}</p>
            )}
          </div>
        )}
      </div>
    </LabPageShell>
  );
}
