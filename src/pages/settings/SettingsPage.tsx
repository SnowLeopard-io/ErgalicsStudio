import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LOCALES, type Locale } from '@/i18n/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';
import { storageUsage, clearCache, formatBytes, type StorageStatus } from '@/core/storage';
import { getGpuBackend } from '@/core/gpu';
import { Modal } from '@/components/Modal';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

const APP_VERSION = '0.1.0';

export default function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { locale, setLocale, theme, setTheme, autoSaveInterval, setAutoSaveInterval, gpuBackend, setGpuBackend, memoryLimit, setMemoryLimit } =
    useSettingsStore();
  const notify = useAppStore((s) => s.notify);
  const [usage, setUsage] = useState<StorageStatus>({ available: false, usageBytes: 0, usageHuman: '0 B' });
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    void storageUsage().then(setUsage);
  }, []);

  const doClearCache = async () => {
    await clearCache();
    setUsage(await storageUsage());
    setClearOpen(false);
    notify('success', t('settings.cache_usage'));
  };

  const gpu = getGpuBackend();

  return (
    <div className="settings">
      <header className="settings-topbar">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          <span className="brand-logo">◈</span>
          <span className="brand-name">Ergalics Studio</span>
        </a>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>

      <main className="settings-body">
        <h1 className="settings-title">{t('settings.title')}</h1>

        <section className="card settings-section">
          <h2 className="settings-section-title">{t('settings.general')}</h2>

          <div className="settings-row">
            <label className="settings-label">{t('settings.language')}</label>
            <select
              className="select settings-control"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <label className="settings-label">{t('settings.theme')}</label>
            <select
              className="select settings-control"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="light">{t('settings.theme_light')}</option>
              <option value="dark">{t('settings.theme_dark')}</option>
              <option value="system">{t('settings.theme_system')}</option>
            </select>
          </div>

          <div className="settings-row">
            <label className="settings-label">{t('settings.auto_save')}</label>
            <select
              className="select settings-control"
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
            >
              <option value={30000}>30s</option>
              <option value={60000}>60s</option>
              <option value={120000}>120s</option>
              <option value={0}>{t('settings.auto_save_off')}</option>
            </select>
          </div>
        </section>

        <section className="card settings-section">
          <h2 className="settings-section-title">{t('settings.gpu')}</h2>

          <div className="settings-row">
            <label className="settings-label">{t('settings.gpu_backend')}</label>
            <select
              className="select settings-control"
              value={gpuBackend}
              onChange={(e) => setGpuBackend(e.target.value as 'auto' | 'cpu-fallback')}
            >
              <option value="auto">{t('settings.gpu_auto')}</option>
              <option value="cpu-fallback">{t('settings.gpu_cpu_fallback')}</option>
            </select>
          </div>

          <div className="settings-row">
            <label className="settings-label">{t('settings.memory_limit')}</label>
            <select
              className="select settings-control"
              value={memoryLimit}
              onChange={(e) => setMemoryLimit(Number(e.target.value) as 512 | 1024 | 2048 | 'auto')}
            >
              <option value="auto">{t('settings.memory_auto')}</option>
              <option value={512}>512 MB</option>
              <option value={1024}>1 GB</option>
              <option value={2048}>2 GB</option>
            </select>
          </div>

          <div className="settings-row">
            <label className="settings-label">{t('welcome.hardware.gpu')}</label>
            <div className="settings-value">
              {gpu.name} · {gpu.available ? 'WebGPU' : 'CPU'}
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <h2 className="settings-section-title">{t('settings.data')}</h2>

          <div className="settings-row">
            <label className="settings-label">{t('settings.cache_usage')}</label>
            <div className="settings-value">
              {usage.available ? formatBytes(usage.usageBytes) : t('common.unknown')}
            </div>
          </div>

          <div className="settings-row">
            <label className="settings-label">{t('settings.clear_cache')}</label>
            <button type="button" className="btn btn-danger" onClick={() => setClearOpen(true)}>
              {t('settings.clear_cache')}
            </button>
          </div>
        </section>

        <section className="card settings-section">
          <h2 className="settings-section-title">{t('settings.about')}</h2>
          <div className="settings-row">
            <label className="settings-label">{t('settings.version')}</label>
            <div className="settings-value">{APP_VERSION}</div>
          </div>
          <div className="settings-row">
            <label className="settings-label">{t('settings.license')}</label>
            <div className="settings-value">MIT</div>
          </div>
          <div className="settings-row">
            <label className="settings-label">GitHub</label>
            <a className="settings-value" href="https://github.com" target="_blank" rel="noreferrer">
              github.com/ergalics-studio
            </a>
          </div>
        </section>

        <button type="button" className="btn btn-primary settings-return" onClick={() => navigate('/workbench')}>
          {t('settings.return')}
        </button>
      </main>

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t('settings.clear_cache')}
        width={420}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setClearOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void doClearCache()}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <p>{t('settings.clear_cache_confirm')}</p>
      </Modal>
    </div>
  );
}