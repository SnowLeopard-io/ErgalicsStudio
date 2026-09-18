// ==========================================================================
// Ergalics Studio — Repro Lock page (F6 / FR6.1–FR6.5, FR-11 lock v2)
//
// Builds a `repro.lock` v2 (data fingerprints, code snapshots, param hashes,
// seeds, versions incl. runtime, dependency fingerprints) from selected run
// records, verifies the current project across the six drift categories
// (pass / warn / fail / unknown drift table), imports foreign v1/v2 locks
// (v1 shows an upgrade hint), downloads the lock JSON, and can rerun locked
// runs through registered source runners with tolerance assertions.
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
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
  type LockDependency,
  type LockVersions,
} from '@/core/repro/lock';
import { downloadBlob } from '@/core/download';
import { fmt } from '../research/researchUi';
import { ToolShell } from '@/components/ToolShell';

/**
 * Best-effort runtime + dependency fingerprint from the live browser
 * environment (FR-11). Only numeric-critical engines we can observe without
 * importing them are listed; everything else stays unknown on verify.
 */
function collectEnvironment(): { runtime: LockVersions['runtime']; dependencies: LockDependency[] } {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const runtime: LockVersions['runtime'] = {
    browser: nav?.userAgent ? nav.userAgent.slice(0, 120) : undefined,
    wasm: typeof WebAssembly !== 'undefined' ? 'wasm-2.0' : 'none',
    pyodide: undefined, // not loaded until code mode runs; unknown on purpose
  };
  const dependencies: LockDependency[] = [];
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    dependencies.push({ name: 'webgpu', version: 'available' });
  }
  return { runtime, dependencies };
}

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

  // Default selection = all successful runs, applied per record id. The old
  // effect rebuilt the whole selection on every runs refresh, wiping manual
  // unchecks; now only genuinely new runs are added, vanished ones removed.
  const seenRunIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const r of runs) {
        if (seenRunIds.current.has(r.id)) continue;
        seenRunIds.current.add(r.id);
        if (!r.failed) {
          next.add(r.id);
          changed = true;
        }
      }
      for (const id of [...next]) {
        if (!runs.some((r) => r.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
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
    const env = collectEnvironment();
    const l = buildLock(project, {
      runs: chosen,
      runIds: chosen.map((r) => r.id),
      versions: { runtime: env.runtime },
      dependencies: env.dependencies,
    });
    setLock(l);
    setVerify(verifyLock(l, project, { runs, versions: { runtime: env.runtime }, dependencies: env.dependencies }));
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
        // A foreign lock must not be installed: verify/reproduce below would
        // otherwise report every item as drift against the wrong project.
        notify('error', t('reprolock.parse_failed', { reason: 'projectId mismatch' }));
        return;
      }
      setLock(l);
      const env = collectEnvironment();
      setVerify(verifyLock(l, project, { runs, versions: { runtime: env.runtime }, dependencies: env.dependencies }));
      setRepro(null);
      if (l.lockVersion < 2) {
        notify('info', t('repro2.upgrade_hint'));
      }
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
    <ToolShell toolId="reprolock">
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
            {lock && lock.lockVersion >= 2 ? t('repro2.export_v2') : t('reprolock.download')}
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
            <div className="repro-cats">
              {verify.categories.map((c) => (
                <span
                  key={c.category}
                  className={`profile-badge profile-badge-${c.status === 'fail' ? 'high' : c.status === 'pass' ? 'low' : 'medium'}`}
                  title={c.status === 'unknown' ? t('repro2.status_unknown') : undefined}
                >
                  {t(`reprolock.category_${c.category}`)}: {c.status === 'unknown' ? t('repro2.status_unknown') : t(`reprolock.status_${c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'warn'}`)}
                </span>
              ))}
            </div>
            {verify.upgradeHint && <p className="analysis-note repro-upgrade-hint">{t('repro2.upgrade_hint')}</p>}
            {lock?.versions.runtime && (
              <p className="analysis-note">
                {t('repro2.runtime', {
                  runtime: [
                    lock.versions.runtime.browser && `browser`,
                    lock.versions.runtime.wasm && `wasm ${lock.versions.runtime.wasm}`,
                    lock.versions.runtime.pyodide && `pyodide ${lock.versions.runtime.pyodide}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                })}
              </p>
            )}
            {lock?.dependencies && lock.dependencies.length > 0 && (
              <div className="repro-deps">
                <h4 className="share-section-title">{t('repro2.dependencies')}</h4>
                <div className="sweep-table-wrap">
                  <table className="sweep-table">
                    <thead>
                      <tr>
                        <th>{t('repro2.category_dependency')}</th>
                        <th>{t('reprolock.drift_target')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lock.dependencies.map((d) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td><code>{d.version}{d.hash ? `#${d.hash}` : ''}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
                      <td>
                        {d.message}
                        {d.suggestion && <div className="repro-drift-suggestion">{t('repro2.dep_suggestion')}</div>}
                      </td>
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
    </ToolShell>
  );
}
