import { useCallback, useEffect, useRef, useState } from 'react';
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
  abortPythonBoot,
  installPythonPackages,
  isPythonRuntimeWarm,
  listPythonPackages,
  warmPythonRuntime,
} from '@/core/pyodide/code-runtime';

interface LoadedPackage {
  name: string;
  version: string;
}

const BOOT_TIMEOUT_MS = 90_000;

/**
 * Settings → Python 环境。
 *
 * Two lists: the pinned set (persisted, restored at every interpreter boot)
 * and what the live interpreter currently holds in memory. Pyodide cannot
 * unload a wheel from a running interpreter, so uninstalling drops the pin
 * and takes effect at the next restart.
 */
export default function PythonPackagesPanel() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const [pinned, setPinned] = useState<string[]>(() => getPinnedPythonPackages());
  const [loaded, setLoaded] = useState<LoadedPackage[] | null>(null);
  const [pick, setPick] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  /** True once the user cancelled the boot — its `false` result must not be
   *  reported as a startup failure. */
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isPythonRuntimeWarm()) {
      setLoaded(null);
      return;
    }
    const result = await listPythonPackages();
    setLoaded(
      result.ok
        ? Object.entries(result.packages)
            .map(([name, version]) => ({ name, version }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : null,
    );
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default picker choice: first vendored package that is not pinned yet.
  useEffect(() => {
    setPick((cur) => {
      if (cur && !pinned.includes(cur)) return cur;
      return VENDORED_PYTHON_PACKAGES.find((p) => p !== 'numpy' && !pinned.includes(p)) ?? '';
    });
  }, [pinned]);

  const boot = async () => {
    cancelledRef.current = false;
    setBusy(true);
    try {
      const ok = await Promise.race([
        warmPythonRuntime(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), BOOT_TIMEOUT_MS)),
      ]);
      if (cancelledRef.current) return;
      if (ok) {
        notify('success', t('store2.py_boot_ok'));
        await refresh();
      } else {
        notify('error', t('store2.py_boot_failed'));
      }
    } catch (err) {
      if (!cancelledRef.current) notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  };

  /** Escape hatch while booting: never leave the panel locked behind a
   *  spinner — abort the worker and hand control straight back. */
  const cancelBoot = () => {
    cancelledRef.current = true;
    abortPythonBoot();
    setBusy(false);
    notify('info', t('store2.py_boot_cancelled'));
  };

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
    <section className="card settings-section python-packages">
      <h2 className="settings-section-title">{t('store2.py_title')}</h2>
      <p className="settings-hint">{t('store2.py_intro')}</p>

      {/* 已安装（持久） */}
      <div className="py-block">
        <div className="py-block-head">
          <span className="settings-label">{t('store2.py_installed_title')}</span>
          <span className="settings-hint">{t('store2.py_installed_hint')}</span>
        </div>
        {pinned.length === 0 ? (
          <p className="settings-hint">{t('store2.py_installed_empty')}</p>
        ) : (
          <table className="sweep-table">
            <tbody>
              {pinned.map((name) => (
                <tr key={name}>
                  <td className="py-name">{name}</td>
                  <td className="py-action">
                    <button type="button" className="btn btn-sm" onClick={() => doUnpin(name)}>
                      {t('store2.py_uninstall')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 安装 */}
      <div className="settings-row">
        <label className="settings-label">{t('store2.py_install')}</label>
        <div className="py-inline">
          <select
            className="select settings-control"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {pick === '' && <option value="">{t('store2.py_all_installed')}</option>}
            {installable.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={busy || pick === ''}
            onClick={() => void doInstall()}
          >
            {t('store2.py_install_btn')}
          </button>
        </div>
      </div>

      {/* 当前会话已加载 */}
      <div className="py-block">
        <div className="py-block-head">
          <span className="settings-label">{t('store2.py_session_title')}</span>
          {loaded === null ? (
            <div className="py-inline">
              <button type="button" className="btn" disabled={busy} onClick={() => void boot()}>
                {busy ? t('store2.py_booting') : t('store2.py_boot')}
              </button>
              {busy && (
                <button type="button" className="btn" onClick={cancelBoot}>
                  {t('common.cancel')}
                </button>
              )}
            </div>
          ) : unpinnedLoaded.length > 0 ? (
            <button type="button" className="btn" disabled={busy} onClick={() => setRestartOpen(true)}>
              {t('store2.py_restart')}
            </button>
          ) : null}
        </div>

        {loaded === null ? (
          <p className="settings-hint">{t('store2.py_session_hint')}</p>
        ) : loaded.length === 0 ? (
          <p className="settings-hint">{t('store2.py_none')}</p>
        ) : (
          <table className="sweep-table">
            <thead>
              <tr>
                <th>{t('store2.py_col_name')}</th>
                <th>{t('store2.py_col_version')}</th>
                <th>{t('store2.py_col_source')}</th>
              </tr>
            </thead>
            <tbody>
              {loaded.map((p) => (
                <tr key={p.name}>
                  <td className="py-name">{p.name}</td>
                  <td>{p.version}</td>
                  <td>
                    {p.name === 'numpy'
                      ? t('store2.py_src_core')
                      : pinned.includes(p.name)
                        ? t('store2.py_src_pinned')
                        : t('store2.py_src_auto')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="settings-hint">{t('store2.py_cache_note')}</p>

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
