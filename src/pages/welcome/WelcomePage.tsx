import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { initGpu } from '@/core/gpu';
import { wasmStatus } from '@/core/wasm';
import { storageAvailable } from '@/core/storage';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { WorkbenchModeCards } from '@/components/WorkbenchModes';
import { ToolGrid } from './ToolGrid';
import {
  PlusIcon,
  FolderOpenIcon,
  ClockIcon,
  BookIcon,
} from '@/components/icons';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';

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
  const notify = useAppStore((s) => s.notify);
  const recent = useProjectStore((s) => s.recent);
  const createProject = useProjectStore((s) => s.createProject);
  const openProject = useProjectStore((s) => s.openProject);
  const openFromFile = useProjectStore((s) => s.openFromFile);
  const [hardware, setHardware] = useState<HardwareState>({
    webgpu: 'pending',
    gpuName: '',
    wasm: 'pending',
    storage: 'pending',
  });
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useProjectStore.getState().loadRecent();
  }, []);

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

  // GPU/WASM/storage probes already run on mount; entering must not block on
  // them (GPU adapter creation can stall in software-rendered environments).
  const enterWorkbench = () => navigate('/workbench');

  const startNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createProject('');
      navigate('/workbench');
    } finally {
      setBusy(false);
    }
  };

  const continueProject = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await openProject(id);
      navigate('/workbench');
    } catch {
      notify('error', t('project.open_failed'));
      setBusy(false);
    }
  };

  const handleOpenFile = (file: File) => {
    setBusy(true);
    void openFromFile(file)
      .then(() => navigate('/workbench'))
      .catch(() => {
        notify('error', t('project.open_failed'));
        setBusy(false);
      });
  };

  const envStates: Array<'pending' | 'ok' | 'fail'> = [
    hardware.webgpu,
    hardware.wasm === 'loaded' ? 'ok' : hardware.wasm === 'failed' ? 'fail' : 'pending',
    hardware.storage,
  ];
  const envHasFail = envStates.includes('fail');
  const envAllOk = envStates.every((s) => s === 'ok');

  return (
    <div className="welcome">
      <header className="welcome-topbar">
        <Link className="brand" to="/">
          <span className="brand-name">Ergalics Studio</span>
        </Link>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>

      <main className="welcome-main">
        <div className="welcome-hero">
          <div className="welcome-eyebrow">ERGALICS · {t('welcome.eyebrow')}</div>
          <h1 className="welcome-title">{t('welcome.title')}</h1>
          <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
          <p className="welcome-version">
            {t('welcome.version')} {APP_VERSION}
          </p>
          <div className="welcome-signal" aria-hidden="true" />
          <div className="welcome-cta-row">
            <button type="button" className="btn btn-primary welcome-enter" onClick={enterWorkbench}>
              {t('welcome.enter')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <FolderOpenIcon size={14} /> {t('project.open')}
            </button>
          </div>
        </div>

        {/* Start actions: blank project / continue recent / sample datasets. */}
        <div className="welcome-start">
          <button type="button" className="start-card card" onClick={() => void startNew()} disabled={busy}>
            <span className="start-card-icon"><PlusIcon size={18} /></span>
            <span className="start-card-body">
              <span className="start-card-title">{t('welcome.start.blank')}</span>
              <span className="start-card-desc">{t('welcome.start.blank_desc')}</span>
            </span>
          </button>

          <div className="start-card card" aria-disabled={recent.length === 0}>
            <span className="start-card-icon"><ClockIcon size={18} /></span>
            <span className="start-card-body">
              <span className="start-card-title">{t('welcome.start.recent')}</span>
              {recent.length > 0 ? (
                <span className="start-recent-list">
                  {recent.slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="start-recent-item"
                      onClick={() => void continueProject(p.id)}
                      disabled={busy}
                    >
                      {p.name || DEFAULT_PROJECT_NAME}
                    </button>
                  ))}
                </span>
              ) : (
                <span className="start-card-desc">{t('welcome.start.recent_empty')}</span>
              )}
            </span>
          </div>

          <button
            type="button"
            className="start-card card"
            onClick={() => navigate('/workbench', { state: { openDataDialog: true } })}
          >
            <span className="start-card-icon"><BookIcon size={18} /></span>
            <span className="start-card-body">
              <span className="start-card-title">{t('welcome.start.samples')}</span>
              <span className="start-card-desc">{t('welcome.start.samples_desc')}</span>
            </span>
          </button>
        </div>

        <div className="welcome-panels">
          <section className="welcome-modes card" aria-label={t('modes.title')}>
            <h2 className="welcome-section-title">{t('modes.title')}</h2>
            <WorkbenchModeCards />
          </section>

          <section className={`welcome-hardware card${envHasFail ? ' has-fail' : ''}`} aria-label={t('welcome.hardware.title')}>
            <div className="env-strip">
              <span className="env-dots" aria-hidden="true">
                {envStates.map((s, i) => (
                  <span key={i} className={`status-dot ${s === 'ok' ? 'status-dot-ok' : s === 'fail' ? 'status-dot-err' : 'status-dot-warn'}`} />
                ))}
              </span>
              <span className="env-summary">
                {envAllOk ? t('welcome.env.ok') : envHasFail ? t('welcome.env.issues') : t('welcome.env.checking')}
              </span>
            </div>
            <div className="env-rows">
              <HardwareRow
                label={t('welcome.hardware.webgpu')}
                state={hardware.webgpu}
                detail={
                  hardware.webgpu === 'ok'
                    ? t('welcome.hardware.webgpu_available')
                    : t('welcome.hardware.webgpu_unavailable')
                }
              />
              <HardwareRow
                label={t('welcome.hardware.gpu')}
                state="ok"
                detail={hardware.gpuName || t('common.unknown')}
              />
              <HardwareRow
                label={t('welcome.hardware.wasm')}
                state={hardware.wasm === 'loaded' ? 'ok' : hardware.wasm === 'failed' ? 'fail' : 'pending'}
                detail={
                  hardware.wasm === 'loaded'
                    ? t('welcome.hardware.wasm_loaded')
                    : t('welcome.hardware.wasm_failed')
                }
              />
              <HardwareRow
                label={t('welcome.hardware.storage')}
                state={hardware.storage}
                detail={
                  hardware.storage === 'ok'
                    ? t('welcome.hardware.storage_available')
                    : t('welcome.hardware.storage_unavailable')
                }
              />
            </div>
          </section>
        </div>

        <ToolGrid />
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept=".clproj,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleOpenFile(file);
          e.target.value = '';
        }}
      />

      <footer className="welcome-footer">
        <a
          href="https://github.com/SnowLeopard-io/ErgalicsStudio"
          target="_blank"
          rel="noreferrer"
        >
          {t('welcome.footer.github')}
        </a>
        <a href="./docs/" target="_blank" rel="noreferrer">
          {t('welcome.footer.docs')}
        </a>
        <button
          type="button"
          className="welcome-footer-link"
          onClick={() => navigate('/workbench', { state: { openPluginDialog: true } })}
        >
          {t('welcome.footer.market')}
        </button>
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
