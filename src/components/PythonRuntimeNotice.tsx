// Explicit Python-runtime notice. Shown while an interpreter the user is
// waiting on is booting (solver runs, code-mode boot) and, with a retry
// action, when that boot failed — the failure used to surface only as a
// generic "compute failed" long after the fact.
import { useT } from '@/i18n';
import {
  dismissPythonRuntimeNotice,
  retryPythonRuntime,
  usePythonRuntimeStatus,
} from '@/core/pyodide/runtime-status';

export function PythonRuntimeNotice() {
  const t = useT();
  const phase = usePythonRuntimeStatus((s) => s.phase);
  const silent = usePythonRuntimeStatus((s) => s.silent);
  const error = usePythonRuntimeStatus((s) => s.error);
  const dismissed = usePythonRuntimeStatus((s) => s.dismissed);

  if (dismissed) return null;
  if (phase === 'loading' && !silent) {
    return (
      <div className="python-runtime-notice" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div className="python-runtime-notice-text">
          <strong>{t('python.runtime.loading')}</strong>
          <span>{t('python.runtime.loading_hint')}</span>
        </div>
      </div>
    );
  }
  if (phase === 'failed') {
    return (
      <div className="python-runtime-notice is-error" role="alert">
        <div className="python-runtime-notice-text">
          <strong>{t('python.runtime.failed')}</strong>
          <span title={error ?? undefined}>{t('python.runtime.failed_hint')}</span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={retryPythonRuntime}>
          {t('python.runtime.retry')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={dismissPythonRuntimeNotice}
          aria-label={t('python.runtime.dismiss')}
        >
          {t('python.runtime.dismiss')}
        </button>
      </div>
    );
  }
  return null;
}
