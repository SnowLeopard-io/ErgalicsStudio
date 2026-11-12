import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { Modal } from '@/components/Modal';
import {
  VENDORED_PYTHON_PACKAGES,
  getPinnedPythonPackages,
  addPinnedPythonPackages,
  removePinnedPythonPackage,
} from '@/core/pyodide/python-packages';
import {
  installPythonPackages,
  isPythonRuntimeWarm,
  listPythonPackages,
  warmPythonRuntime,
} from '@/core/pyodide/code-runtime';

interface LoadedPackage {
  name: string;
  version: string;
}

/**
 * Settings → 存储 → Python 包。
 *
 * Shows what the live interpreter has loaded (name → version), lets the user
 * install any vendored package offline (the wheels live in /pyodide) and
 * unpin previously installed ones. Pyodide cannot truly unload a wheel from a
 * running interpreter, so "uninstall" removes the package from the boot
 * auto-install list and takes effect at the next interpreter restart.
 */
export default function PythonPackagesPanel() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const [loaded, setLoaded] = useState<LoadedPackage[] | null>(null);
  const [pinned, setPinned] = useState<string[]>(() => getPinnedPythonPackages());
  const [pick, setPick] = useState<string>(VENDORED_PYTHON_PACKAGES[1]);
  const [busy, setBusy] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!isPythonRuntimeWarm()) {
      setLoaded(null);
      return;
    }
    const result = await listPythonPackages();
    if (result.ok) {
      setLoaded(
        Object.entries(result.packages)
          .map(([name, version]) => ({ name, version }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } else {
      setLoaded(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doInstall = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const result = await installPythonPackages([pick]);
      if (result.ok) {
        setPinned(addPinnedPythonPackages([pick]));
        notify('success', t('store2.py_installed', { name: pick }));
        await refresh();
      } else {
        notify('error', result.error || t('store2.py_install_failed'));
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doUnpin = (name: string) => {
    setPinned(removePinnedPythonPackage(name));
    notify('info', t('store2.py_unpinned', { name }));
  };

  const doRestart = async () => {
    setRestartOpen(false);
    setBusy(true);
    try {
      await warmPythonRuntime({ restart: true });
      notify('success', t('store2.py_restarted'));
      await refresh();
    } catch {
      notify('error', t('store2.py_restart_failed'));
    } finally {
      setBusy(false);
    }
  };

  const loadedNames = new Set((loaded ?? []).map((p) => p.name));
  const installable = VENDORED_PYTHON_PACKAGES.filter((p) => p !== 'numpy');
  const unpinnedLoaded = pinned.filter((p) => loadedNames.has(p));

  return (
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('store2.py_title')}</h2>
      <p className="settings-label">{t('store2.py_intro')}</p>

      {loaded === null ? (
        <div className="settings-row">
          <label className="settings-label">{t('store2.py_state')}</label>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void warmPythonRuntime().finally(() => {
                setBusy(false);
                void refresh();
              });
            }}
          >
            {t('store2.py_boot')}
          </button>
        </div>
      ) : (
        <>
          {loaded.length === 0 ? (
            <p className="settings-label">{t('store2.py_none')}</p>
          ) : (
            <table className="sweep-table">
              <thead>
                <tr>
                  <th>{t('store2.py_col_name')}</th>
                  <th>{t('store2.py_col_version')}</th>
                  <th>{t('store2.py_col_source')}</th>
                  <th>{''}</th>
                </tr>
              </thead>
              <tbody>
                {loaded.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.version}</td>
                    <td>
                      {p.name === 'numpy'
                        ? t('store2.py_src_core')
                        : pinned.includes(p.name)
                          ? t('store2.py_src_pinned')
                          : t('store2.py_src_auto')}
                    </td>
                    <td>
                      {pinned.includes(p.name) && p.name !== 'numpy' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => doUnpin(p.name)}
                        >
                          {t('store2.py_uninstall')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {unpinnedLoaded.length === 0 ? null : (
            <div className="settings-row">
              <label className="settings-label">{t('store2.py_restart_hint')}</label>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setRestartOpen(true)}
              >
                {t('store2.py_restart')}
              </button>
            </div>
          )}
        </>
      )}

      <div className="settings-row">
        <label className="settings-label">{t('store2.py_install')}</label>
        <div className="settings-value about-links">
          <select
            className="select settings-control"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {installable.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={busy || loaded === null}
            onClick={() => void doInstall()}
          >
            {t('store2.py_install_btn')}
          </button>
        </div>
      </div>
      <p className="settings-label">{t('store2.py_cache_note')}</p>

      <Modal
        open={restartOpen}
        onClose={() => setRestartOpen(false)}
        title={t('store2.py_restart')}
        width={420}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRestartOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void doRestart()}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <p>{t('store2.py_restart_confirm')}</p>
      </Modal>
    </section>
  );
}
