import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { initGpu } from '@/core/gpu';
import { wasmStatus } from '@/core/wasm';
import { storageAvailable } from '@/core/storage';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';

const APP_VERSION = '0.1.0';

interface HardwareState {
  webgpu: 'pending' | 'ok' | 'fail';
  gpuName: string;
  wasm: 'pending' | 'loaded' | 'failed';
  storage: 'pending' | 'ok' | 'fail';
}

export default function WelcomePage() {
  const t = useT();
  const navigate = useNavigate();
  const gpuBackend = useSettingsStore((s) => s.gpuBackend);
  const addBanner = useAppStore((s) => s.addBanner);
  const [hardware, setHardware] = useState<HardwareState>({
    webgpu: 'pending',
    gpuName: '',
    wasm: 'pending',
    storage: 'pending',
  });
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // WASM
      const wasm = await wasmStatus();
      if (!cancelled) setHardware((h) => ({ ...h, wasm }));

      // IndexedDB
      const storageOk = await storageAvailable();
      if (!cancelled) {
        setHardware((h) => ({ ...h, storage: storageOk ? 'ok' : 'fail' }));
        if (!storageOk) addBanner('warning', 'error.storage_unavailable');
      }

      // WebGPU
      const backend = await initGpu(gpuBackend);
      if (!cancelled) {
        setHardware((h) => ({
          ...h,
          webgpu: backend.available ? 'ok' : 'fail',
          gpuName: backend.name,
        }));
        if (!backend.available) {
          addBanner('warning', 'error.webgpu_unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gpuBackend, addBanner]);

  const enterWorkbench = async () => {
    if (entering) return;
    setEntering(true);
    await initGpu(gpuBackend);
    navigate('/workbench');
  };

  return (
    <div className="welcome">
      <header className="welcome-topbar">
        <Link className="brand" to="/">
          <span className="brand-logo">◈</span>
          <span className="brand-name">Ergalics Studio</span>
        </Link>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>

      <main className="welcome-main">
        <div className="welcome-hero">
          <div className="welcome-eyebrow">ERGALICS · {t('welcome.subtitle')}</div>
          <h1 className="welcome-title">{t('welcome.title')}</h1>
          <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
          <p className="welcome-version">
            {t('welcome.version')} {APP_VERSION}
          </p>
          <div className="welcome-signal" aria-hidden="true" />
          <button type="button" className="btn btn-primary welcome-enter" onClick={enterWorkbench} disabled={entering}>
            {entering ? <span className="spinner" /> : t('welcome.enter')}
          </button>
        </div>

        <section className="welcome-hardware card" aria-label={t('welcome.hardware.title')}>
          <h2 className="welcome-section-title">{t('welcome.hardware.title')}</h2>
          <HardwareRow
            label={t('welcome.hardware.webgpu')}
            state={hardware.webgpu}
            detail={hardware.webgpu === 'ok' ? t('welcome.hardware.webgpu_available') : t('welcome.hardware.webgpu_unavailable')}
          />
          <HardwareRow
            label={t('welcome.hardware.gpu')}
            state="ok"
            detail={hardware.gpuName || t('common.unknown')}
          />
          <HardwareRow
            label={t('welcome.hardware.wasm')}
            state={hardware.wasm === 'loaded' ? 'ok' : hardware.wasm === 'failed' ? 'fail' : 'pending'}
            detail={hardware.wasm === 'loaded' ? t('welcome.hardware.wasm_loaded') : t('welcome.hardware.wasm_failed')}
          />
          <HardwareRow
            label={t('welcome.hardware.storage')}
            state={hardware.storage}
            detail={hardware.storage === 'ok' ? t('welcome.hardware.storage_available') : t('welcome.hardware.storage_unavailable')}
          />
        </section>
      </main>

      <footer className="welcome-footer">
        <a href="https://github.com" target="_blank" rel="noreferrer">
          {t('welcome.footer.github')}
        </a>
        <a href="docs/" target="_blank" rel="noreferrer">
          {t('welcome.footer.docs')}
        </a>
        <Link to="/workbench">{t('welcome.footer.market')}</Link>
      </footer>
    </div>
  );
}

function HardwareRow({ label, state, detail }: { label: string; state: 'pending' | 'ok' | 'fail'; detail: string }) {
  const dot =
    state === 'ok' ? 'status-dot-ok' : state === 'fail' ? 'status-dot-err' : 'status-dot-warn';
  return (
    <div className="hardware-row">
      <span className={`status-dot ${dot}`} />
      <span className="hardware-label">{label}</span>
      <span className="hardware-detail">{detail}</span>
    </div>
  );
}