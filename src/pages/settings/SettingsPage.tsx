import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { LOCALES, type Locale } from '@/i18n/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppStore } from '@/stores/appStore';
import {
  storageUsage,
  clearCache,
  formatBytes,
  chunkUsageBytes,
  listChunkFileRefs,
  clearChunkCache,
  clearMigrationRecords,
  type StorageStatus,
} from '@/core/storage';
import { OpfsChunkStore, isOpfsAvailable } from '@/core/opfs';
import { migrateIdbToOpfs, type MigrationResult } from '@/core/opfs-migration';
import type { SettingsState } from '@/core/settings';
import { getGpuBackend } from '@/core/gpu';
import {
  CITATION_META,
  currentAppVersion,
  softwareCitationBibtex,
  softwareCitationPlain,
} from '@/core/citation';
import { Modal } from '@/components/Modal';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import ThemeMarketPanel from './ThemeMarketPanel';
import { PwaPanel } from './PwaPanel';

const CATEGORIES = [
  { id: 'general', labelKey: 'settings.general' },
  { id: 'theme', labelKey: 'settings.theme' },
  { id: 'gpu', labelKey: 'settings.gpu' },
  { id: 'data', labelKey: 'settings.data' },
  { id: 'store', labelKey: 'settings.store' },
  { id: 'pwa', labelKey: 'settings.pwa' },
  { id: 'about', labelKey: 'settings.about' },
] as const;
type CategoryId = (typeof CATEGORIES)[number]['id'];

export default function SettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const {
    locale, setLocale, theme, setTheme, autoSaveInterval, setAutoSaveInterval,
    gpuBackend, setGpuBackend, memoryLimit, setMemoryLimit,
    workerPoolSize, setWorkerPoolSize, chunkRows, setChunkRows,
  } = useSettingsStore();
  const notify = useAppStore((s) => s.notify);
  const appVersion = currentAppVersion();
  const [usage, setUsage] = useState<StorageStatus>({ available: false, usageBytes: 0, usageHuman: '0 B' });
  const [clearOpen, setClearOpen] = useState(false);

  // Deep link (#/settings?cat=theme) lands on the requested section; default to
  // General otherwise. The `cat` param is also kept in sync as the user browses.
  const [searchParams, setSearchParams] = useSearchParams();
  const paramCat = searchParams.get('cat');
  const [active, setActive] = useState<CategoryId>(() =>
    CATEGORIES.some((c) => c.id === paramCat) ? (paramCat as CategoryId) : 'general',
  );
  const selectCat = (id: CategoryId) => {
    setActive(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === 'general') next.delete('cat');
      else next.set('cat', id);
      return next;
    }, { replace: true });
  };

  // FR-17: chunk-storage panel state (all reads degrade to zero on failure).
  const opfsAvailable = isOpfsAvailable();
  const [idbChunkBytes, setIdbChunkBytes] = useState(0);
  const [idbChunkCount, setIdbChunkCount] = useState(0);
  const [opfsBytes, setOpfsBytes] = useState(0);
  const [opfsFiles, setOpfsFiles] = useState(0);
  const [chunkClearOpen, setChunkClearOpen] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<{ done: number; total: number } | null>(null);
  const [migrateResult, setMigrateResult] = useState<MigrationResult | null>(null);
  const stopMigrationRef = useRef(false);

  const refreshChunkUsage = async () => {
    try {
      const [bytes, refs] = await Promise.all([chunkUsageBytes(), listChunkFileRefs()]);
      setIdbChunkBytes(bytes);
      setIdbChunkCount(refs.reduce((sum, r) => sum + r.count, 0));
    } catch {
      setIdbChunkBytes(0);
      setIdbChunkCount(0);
    }
    if (opfsAvailable) {
      try {
        const files = await new OpfsChunkStore().listFiles();
        setOpfsBytes(files.reduce((sum, f) => sum + f.totalBytes, 0));
        setOpfsFiles(files.length);
      } catch {
        setOpfsBytes(0);
        setOpfsFiles(0);
      }
    }
  };

  const doClearChunkCache = async () => {
    try {
      await clearChunkCache();
      await clearMigrationRecords();
      if (opfsAvailable) await new OpfsChunkStore().clearAll();
      notify('success', t('store2.clean_cache_done'));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
    setChunkClearOpen(false);
    void refreshChunkUsage();
  };

  const doMigrate = async () => {
    stopMigrationRef.current = false;
    setMigrateResult(null);
    setMigrateProgress({ done: 0, total: 0 });
    const result = await migrateIdbToOpfs({
      shouldStop: () => stopMigrationRef.current,
      onProgress: (p) => setMigrateProgress({ done: p.done, total: p.total }),
    });
    setMigrateResult(result);
    setMigrateProgress(null);
    void refreshChunkUsage();
  };

  const copyCitation = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', t('cite.copied'));
    } catch {
      notify('error', t('cite.copy_failed'));
    }
  };

  useEffect(() => {
    void storageUsage().then(setUsage);
    void refreshChunkUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doClearCache = async () => {
    await clearCache();
    setUsage(await storageUsage());
    setClearOpen(false);
    notify('success', t('settings.cache_cleared'));
  };

  const gpu = getGpuBackend();

  const activeCat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];

  return (
    <div className="settings">
      <header className="settings-topbar">
        <div className="settings-topbar-left">
          <button type="button" className="btn settings-back" onClick={() => navigate('/')}>
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            {t('settings.back_home')}
          </button>
          <span className="settings-topbar-title">{t('settings.title')}</span>
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-sidebar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`settings-nav-item${active === cat.id ? ' active' : ''}`}
              onClick={() => selectCat(cat.id)}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </nav>

        <main className="settings-content">
          <div className="settings-content-inner">
            <h1 className="settings-title">{t(activeCat.labelKey)}</h1>

            {active === 'general' && (
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
            )}

            {active === 'theme' && <ThemeMarketPanel />}

            {active === 'gpu' && (
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
                    onChange={(e) => {
                    const v = e.target.value;
                    setMemoryLimit(v === 'auto' ? 'auto' : (Number(v) as 512 | 1024 | 2048));
                  }}
                  >
                    <option value="auto">{t('settings.memory_auto')}</option>
                    <option value={512}>512 MB</option>
                    <option value={1024}>1 GB</option>
                    <option value={2048}>2 GB</option>
                  </select>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('store2.worker_pool')}</label>
                  <select
                    className="select settings-control"
                    value={workerPoolSize}
                    onChange={(e) => {
                      const v = e.target.value;
                      setWorkerPoolSize(v === 'auto' ? 'auto' : (Number(v) as SettingsState['workerPoolSize']));
                    }}
                  >
                    <option value="auto">{t('store2.auto')}</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                  </select>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('store2.chunk_rows')}</label>
                  <select
                    className="select settings-control"
                    value={chunkRows}
                    onChange={(e) => {
                      const v = e.target.value;
                      setChunkRows(v === 'auto' ? 'auto' : (Number(v) as SettingsState['chunkRows']));
                    }}
                  >
                    <option value="auto">{t('store2.auto')}</option>
                    <option value={1000}>1,000</option>
                    <option value={10000}>10,000</option>
                    <option value={50000}>50,000</option>
                  </select>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('welcome.hardware.gpu')}</label>
                  <div className="settings-value">
                    {gpu.name} · {gpu.available ? 'WebGPU' : 'CPU'}
                  </div>
                </div>
              </section>
            )}

            {active === 'data' && (
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
            )}

            {active === 'store' && (
              <section className="card settings-section">
                <h2 className="settings-section-title">{t('store2.section_title')}</h2>

                <div className="settings-row">
                  <label className="settings-label">OPFS</label>
                  <div className="settings-value">
                    {opfsAvailable ? t('store2.opfs_available') : t('store2.opfs_unavailable')}
                  </div>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('store2.usage_idb')}</label>
                  <div className="settings-value">{formatBytes(idbChunkBytes)}</div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">{t('store2.usage_opfs')}</label>
                  <div className="settings-value">{formatBytes(opfsBytes)}</div>
                </div>

                {idbChunkBytes + opfsBytes > 0 && (
                  <div
                    className="storage-usage-bar"
                    role="img"
                    aria-label={t('store2.usage_total')}
                    title={`${t('store2.usage_idb')} ${formatBytes(idbChunkBytes)} · ${t('store2.usage_opfs')} ${formatBytes(opfsBytes)}`}
                  >
                    <div
                      className="storage-usage-idb"
                      style={{ width: `${(idbChunkBytes / Math.max(1, idbChunkBytes + opfsBytes)) * 100}%` }}
                    />
                  </div>
                )}

                {migrateProgress && (
                  <div className="settings-row">
                    <label className="settings-label">{t('store2.migrate')}</label>
                    <div className="settings-value">
                      {t('store2.migrate_progress', {
                        done: migrateProgress.done,
                        total: migrateProgress.total,
                      })}
                      <button type="button" className="btn" onClick={() => { stopMigrationRef.current = true; }}>
                        {t('store2.migrate_cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {migrateResult && (
                  <div className="settings-row">
                    <label className="settings-label">{t('store2.migrate')}</label>
                    <div className="settings-value">
                      {migrateResult.stopped ? t('store2.migrate_cancelled') : ''}
                      {t('store2.migrate_done', {
                        migrated: migrateResult.migrated,
                        skipped: migrateResult.skipped,
                      })}
                      {migrateResult.failed > 0 && (
                        <span className="sql-preview-note">
                          {' '}
                          {t('store2.migrate_failed', { failed: migrateResult.failed })}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="settings-row">
                  <label className="settings-label">{t('store2.migrate')}</label>
                  <button
                    type="button"
                    className="btn"
                    disabled={!opfsAvailable || idbChunkBytes === 0 || migrateProgress !== null}
                    onClick={() => void doMigrate()}
                  >
                    {t('store2.migrate')}
                  </button>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('store2.clean_cache')}</label>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={idbChunkBytes + opfsBytes === 0}
                    onClick={() => setChunkClearOpen(true)}
                  >
                    {t('store2.clean_cache')}
                  </button>
                </div>
              </section>
            )}

            {active === 'pwa' && <PwaPanel />}

            {active === 'about' && (
              <section className="card settings-section">
                <h2 className="settings-section-title">{t('settings.about')}</h2>
                <div className="settings-row">
                  <label className="settings-label">{t('settings.version')}</label>
                  <div className="settings-value">{appVersion}</div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">{t('settings.license')}</label>
                  <div className="settings-value">{CITATION_META.license}</div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">{t('signing.author')}</label>
                  <div className="settings-value">{CITATION_META.author}</div>
                </div>
                <div className="settings-row">
                  <label className="settings-label">GitHub</label>
                  <a
                    className="settings-value"
                    href="https://github.com/SnowLeopard-io/ErgalicsStudio"
                    target="_blank"
                    rel="noreferrer"
                  >
                    github.com/SnowLeopard-io/ErgalicsStudio
                  </a>
                </div>

                <h3 className="settings-section-title" style={{ marginTop: 'var(--space-4)' }}>
                  {t('cite.section_title')}
                </h3>
                <p className="settings-label">{t('cite.intro', { version: appVersion })}</p>

                <div className="settings-row">
                  <label className="settings-label">{t('cite.bibtex_label')}</label>
                  <button type="button" className="btn" onClick={() => void copyCitation(softwareCitationBibtex())}>
                    {t('cite.copy_bibtex')}
                  </button>
                </div>
                <pre className="citation-preview">{softwareCitationBibtex()}</pre>

                <div className="settings-row">
                  <label className="settings-label">{t('cite.plain_label')}</label>
                  <button type="button" className="btn" onClick={() => void copyCitation(softwareCitationPlain(locale))}>
                    {t('cite.copy_plain')}
                  </button>
                </div>
                <pre className="citation-preview">{softwareCitationPlain(locale)}</pre>

                <p className="settings-label">{t('cite.doi_note')}</p>
              </section>
            )}
          </div>
        </main>
      </div>

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

      <Modal
        open={chunkClearOpen}
        onClose={() => setChunkClearOpen(false)}
        title={t('store2.clean_cache')}
        width={460}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setChunkClearOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void doClearChunkCache()}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <p>{t('store2.clean_cache_confirm')}</p>
        <p className="settings-label">
          {t('store2.clean_cache_items', {
            count: idbChunkCount,
            bytes: formatBytes(idbChunkBytes),
            files: opfsFiles,
            bytes2: formatBytes(opfsBytes),
          })}
        </p>
      </Modal>
    </div>
  );
}