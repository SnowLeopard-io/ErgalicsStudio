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

const BOOT_TIMEOUT_MS = 90_000;

/**
 * Settings → 存储 → Python 包。
 *
 * Two separate lists:
 * - 已安装（pinned, localStorage-backed）: packages the user installed that
 *   are re-installed automatically at every interpreter boot. Visible even
 *   before the interpreter exists — the list IS the persistent fact.
 * - 当前会话已加载: what the live interpreter actually has in memory right
 *   now (pyodide.loadedPackages), including transitive auto-loads.
 *
 * Pyodide cannot truly unload a wheel from a running interpreter, so
 * uninstalling removes the pin and takes effect at the next restart.
 */
export default function PythonPackagesPanel() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const [pinned, setPinned] = useState<string[]>(() => getPinnedPythonPackages());
  const [loaded, setLoaded] = useState<LoadedPackage[] | null>(null);
  const [pick, setPick] = useState<string>('');
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

  // Default picker choice: first vendored package that is not pinned yet.
  useEffect(() => {
    setPick((cur) => {
      if (cur && !pinned.includes(cur)) return cur;
      return VENDORED_PYTHON_PACKAGES.find((p) => p !== 'numpy' && !pinned.includes(p)) ?? '';
    });
  }, [pinned]);

  const boot = async () => {
    setBusy(true);
    try {
      const ok = await Promise.race([
        warmPythonRuntime(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), BOOT_TIMEOUT_MS)),
      ]);
      if (ok) {
        notify('success', t('store2.py_boot_ok'));
        await refresh();
      } else {
        notify('error', t('store2.py_boot_failed'));
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
    <section className="card settings-section">
      <h2 className="settings-section-title">{t('store2.py_title')}</h2>
      <p className="settings-label">{t('store2.py_intro')}</p>

      {/* --- 已安装（持久，跨会话） --- */}
      <div className="settings-row">
        <label className="settings-label">{t('store2.py_installed_title')}</label>
        {pinned.length === 0 ? (
          <span className="settings-label">{t('store2.py_installed_empty')}</span>
        ) : (
          <table className="sweep-table">
            <thead>
              <tr>
                <th>{t('store2.py_col_name')}</th>
                <th>{t('store2.py_col_note')}</th>
                <th>{''}</th>
              </tr>
            </thead>
            <tbody>
              {pinned.map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{t('store2.py_installed_note')}</td>
                  <td>
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

      {/* --- 安装 --- */}
      <div className="settings-row">
        <label className="settings-label">{t('store2.py_install')}</label>
        <div className="settings-value about-links">
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

      {/* --- 当前会话已加载 --- */}
      <div className="settings-row">
        <label className="settings-label">{t('store2.py_session_title')}</label>
        {loaded === null ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void boot()}>
            {busy ? t('store2.py_booting') : t('store2.py_boot')}
          </button>
        ) : loaded.length === 0 ? (
          <span className="settings-label">{t('store2.py_none')}</span>
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
                  <td>{p.name}</td>
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

      {loaded !== null && unpinnedLoaded.length > 0 && (
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
