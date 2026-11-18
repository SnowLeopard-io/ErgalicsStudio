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
import type { BuildCacheStats } from '@/core/build/cache';
import type { SettingsState } from '@/core/settings';
import { getGpuBackend } from '@/core/gpu';
import {
  CITATION_META,
  currentAppVersion,
  softwareCitationBibtex,
  softwareCitationPlain,
} from '@/core/citation';
import { downloadBlob } from '@/core/download';
import { Modal } from '@/components/Modal';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import ThemeMarketPanel from './ThemeMarketPanel';
import { PwaPanel } from './PwaPanel';
import PythonPackagesPanel from './PythonPackagesPanel';
import { UserProfilePanel } from './UserProfilePanel';
import { AmbienceSettingsPanel, AchievementsPanel } from '@/components/ambience/AmbiencePanels';

/**
 * Settings taxonomy (conventional order: general → personalisation →
 * account → performance → storage → runtime → offline → about).
 *
 * One category = one concern, and every control lives under the category it
 * actually belongs to:
 * - 通用: language + auto-save (app-wide behaviour)
 * - 外观: theme picker, theme marketplace and ambience (everything visual)
 * - 性能: GPU backend, memory cap, parse workers, chunk size (compute knobs)
 * - 存储: cache usage/clear + OPFS chunk store (anything that occupies disk)
 * - Python 环境: interpreter packages (runtime dependency, not storage)
 */
const CATEGORIES = [
  { id: 'general', labelKey: 'settings.general' },
  { id: 'appearance', labelKey: 'settings.appearance' },
  { id: 'profile', labelKey: 'settings.profile' },
  { id: 'achievements', labelKey: 'settings.achievements' },
  { id: 'performance', labelKey: 'settings.performance' },
  { id: 'store', labelKey: 'settings.store' },
  { id: 'python', labelKey: 'settings.python' },
  { id: 'pwa', labelKey: 'settings.pwa' },
  { id: 'about', labelKey: 'settings.about' },
] as const;
type CategoryId = (typeof CATEGORIES)[number]['id'];

/** Pre-reorganisation ids still reachable from bookmarks / welcome links. */
const CATEGORY_ALIASES: Record<string, CategoryId> = {
  theme: 'appearance',
  ambience: 'appearance',
  gpu: 'performance',
  data: 'store',
};

function resolveCategory(id: string | null): CategoryId | null {
  if (!id) return null;
  if (CATEGORIES.some((c) => c.id === id)) return id as CategoryId;
  return CATEGORY_ALIASES[id] ?? null;
}

const GITHUB_REPO = 'https://github.com/SnowLeopard-io/ErgalicsStudio';
const GITEE_REPO = 'https://gitee.com/cnt-code/ergalics-studio';

/** Development team roster shown in the About card. GitHub/Gitee mirror the
 *  same person; role & intro copy come from the i18n catalogs `about.*`.
 *  `github` is optional — some members only maintain a Gitee presence. */
interface TeamMember {
  name: string;
  giteeName: string;
  github?: string;
  gitee: string;
  roleKey: 'about.team_lead_role' | 'about.team_dev_role' | 'about.team_dev2_role' | 'about.team_dev3_role';
  introKey:
    | 'about.team_lead_intro'
    | 'about.team_dev_intro'
    | 'about.team_dev2_intro'
    | 'about.team_dev3_intro'
    | 'about.team_zspro_intro';
}

const TEAM: TeamMember[] = [
  {
    name: 'SnowLeopard-io',
    giteeName: 'cnt-code',
    github: 'https://github.com/SnowLeopard-io',
    gitee: 'https://gitee.com/cnt-code',
    roleKey: 'about.team_lead_role',
    introKey: 'about.team_lead_intro',
  },
  {
    name: 'Miwafi',
    giteeName: 'Miwafi',
    github: 'https://github.com/Miwafi',
    gitee: 'https://gitee.com/Miwafi',
    roleKey: 'about.team_dev_role',
    introKey: 'about.team_dev_intro',
  },
  {
    name: 'HM-Suiji',
    giteeName: 'HM_suiji',
    github: 'https://github.com/HM-Suiji',
    gitee: 'https://gitee.com/HM_suiji',
    roleKey: 'about.team_dev2_role',
    introKey: 'about.team_dev2_intro',
  },
  {
    name: 'zhangborui_2026',
    giteeName: 'zhangborui_2026',
    gitee: 'https://gitee.com/zhangborui_2026',
    roleKey: 'about.team_dev3_role',
    introKey: 'about.team_dev3_intro',
  },
  {
    name: 'zspro',
    giteeName: 'yspro',
    github: 'https://github.com/zspro',
    gitee: 'https://gitee.com/yspro',
    roleKey: 'about.team_dev3_role',
    introKey: 'about.team_zspro_intro',
  },
  {
    name: 'skyfireitdiy',
    giteeName: 'skyfireitdiy',
    github: 'https://github.com/skyfireitdiy',
    gitee: 'https://gitee.com/skyfireitdiy',
    roleKey: 'about.team_dev3_role',
    introKey: 'about.team_dev3_intro',
  },
];

export default function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const navigate = useNavigate();
  const {
    locale, setLocale, theme, setTheme, autoSaveInterval, setAutoSaveInterval,
    gpuBackend, setGpuBackend,
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
  const [active, setActive] = useState<CategoryId>(() => resolveCategory(paramCat) ?? 'general');
  const selectCat = (id: CategoryId) => {
    setActive(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === 'general') next.delete('cat');
      else next.set('cat', id);
      return next;
    }, { replace: true });
  };

  // External navigation (deep links clicked while the page is already open)
  // must move the panel too, not just the URL.
  useEffect(() => {
    const resolved = resolveCategory(paramCat);
    if (resolved && resolved !== active) setActive(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramCat]);

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

  // Incremental build cache (content-addressed Flow results): entries, bytes,
  // persistence mode and a "clear" action. Loaded lazily so Settings does not
  // pull the whole block system into its initial chunk.
  const [buildCache, setBuildCache] = useState<BuildCacheStats | null>(null);
  const [buildClearOpen, setBuildClearOpen] = useState(false);
  const [buildImportSummary, setBuildImportSummary] = useState<string | null>(null);
  const buildFileRef = useRef<HTMLInputElement>(null);

  const doExportBuildCache = async () => {
    try {
      const { useBlockStore } = await import('@/stores/blockStore');
      const json = await useBlockStore.getState().exportBuildCache();
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(
        `ergalics-build-cache-${date}.json`,
        new TextEncoder().encode(json),
        'application/json',
      );
      notify('success', t('settings.build_cache_exported'));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  const doImportBuildCache = async (file: File) => {
    try {
      const { useBlockStore } = await import('@/stores/blockStore');
      const result = await useBlockStore.getState().importBuildCache(await file.text());
      if (result.errors.length > 0) {
        setBuildImportSummary(result.errors.slice(0, 3).join('\n'));
      } else {
        setBuildImportSummary(
          t('settings.build_cache_imported', {
            imported: result.imported,
            skipped: result.skipped,
          }),
        );
      }
      notify(
        result.imported > 0 ? 'success' : 'error',
        t('settings.build_cache_imported', {
          imported: result.imported,
          skipped: result.skipped,
        }),
      );
      void refreshBuildCache();
    } catch (err) {
      setBuildImportSummary(null);
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  const refreshBuildCache = async () => {
    try {
      const { useBlockStore } = await import('@/stores/blockStore');
      setBuildCache(await useBlockStore.getState().buildCacheStats());
    } catch {
      setBuildCache(null);
    }
  };

  const doClearBuildCache = async () => {
    try {
      const { useBlockStore } = await import('@/stores/blockStore');
      await useBlockStore.getState().clearBuildCache();
      notify('success', t('settings.build_cache_cleared'));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBuildClearOpen(false);
      void refreshBuildCache();
    }
  };

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
    try {
      const result = await migrateIdbToOpfs({
        shouldStop: () => stopMigrationRef.current,
        onProgress: (p) => setMigrateProgress({ done: p.done, total: p.total }),
      });
      setMigrateResult(result);
    } catch (err) {
      // Never leave the progress UI stuck: surface the failure and reset.
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setMigrateProgress(null);
      void refreshChunkUsage();
    }
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
    void refreshBuildCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doClearCache = async () => {
    try {
      await clearCache();
      setUsage(await storageUsage());
      // The DB records are gone, but the stores still hold the now-dead project
      // in memory (and its recent list). Refresh both so the app reflects the
      // wipe instead of presenting a phantom project that will fail on the next
      // save.
      const { useProjectStore } = await import('@/stores/projectStore');
      useProjectStore.setState({ project: null, dirty: false, status: 'ready', statusText: null, recent: [] });
      void useProjectStore.getState().loadRecent().catch(() => undefined);
      // The incremental build cache lives in its own database and is keyed by
      // content, so a full wipe should drop it as well — otherwise the next
      // run would silently reuse results from a project that no longer exists.
      try {
        const { useBlockStore } = await import('@/stores/blockStore');
        await useBlockStore.getState().clearBuildCache();
        setBuildCache(await useBlockStore.getState().buildCacheStats());
      } catch {
        /* cache clearing is best-effort */
      }
      notify('success', t('settings.cache_cleared'));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setClearOpen(false);
    }
  };

  const gpu = getGpuBackend();

  const activeCat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];

  return (
    <div className={`settings${embedded ? ' settings-embedded' : ''}`}>
      {/* Embedded mode (canvas tab): no page chrome — the workbench tab strip
          already identifies the view and hosts its own close button. */}
      {!embedded && (
        <header className="settings-topbar">
          <div className="settings-topbar-left">
            <button type="button" className="btn settings-back" onClick={() => navigate('/workbench')}>
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
      )}

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

            {active === 'appearance' && (
              <section className="card settings-section">
                <h2 className="settings-section-title">{t('settings.theme')}</h2>
                <div className="settings-row">
                  <label className="settings-label">{t('settings.theme_mode')}</label>
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
              </section>
            )}

            {active === 'appearance' && <ThemeMarketPanel />}

            {active === 'appearance' && <AmbienceSettingsPanel />}

            {active === 'profile' && <UserProfilePanel />}

            {active === 'achievements' && <AchievementsPanel />}

            {active === 'performance' && (
              <section className="card settings-section">
                <h2 className="settings-section-title">{t('settings.performance')}</h2>

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

            {active === 'store' && (
              <section className="card settings-section">
                <h2 className="settings-section-title">{t('settings.cache')}</h2>

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
                <h2 className="settings-section-title">{t('settings.build_cache')}</h2>
                <p className="settings-label">{t('settings.build_cache_intro')}</p>

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_entries')}</label>
                  <div className="settings-value">
                    {buildCache
                      ? `${buildCache.entries} / ${buildCache.maxEntries}`
                      : t('common.unknown')}
                  </div>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_size')}</label>
                  <div className="settings-value">
                    {buildCache
                      ? `${formatBytes(buildCache.bytes)} / ${formatBytes(buildCache.maxBytes)}`
                      : t('common.unknown')}
                  </div>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_storage')}</label>
                  <div className="settings-value">
                    {!buildCache
                      ? t('common.unknown')
                      : buildCache.persistent
                        ? buildCache.degraded
                          ? t('settings.build_cache_degraded')
                          : t('settings.build_cache_persistent')
                        : t('settings.build_cache_memory')}
                  </div>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_export')}</label>
                  <button
                    type="button"
                    className="btn"
                    disabled={!buildCache || buildCache.entries === 0}
                    title={t('settings.build_cache_export_hint')}
                    onClick={() => void doExportBuildCache()}
                  >
                    {t('settings.build_cache_export')}
                  </button>
                </div>

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_import')}</label>
                  <button
                    type="button"
                    className="btn"
                    title={t('settings.build_cache_import_hint')}
                    onClick={() => buildFileRef.current?.click()}
                  >
                    {t('settings.build_cache_import')}
                  </button>
                  <input
                    ref={buildFileRef}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void doImportBuildCache(file);
                    }}
                  />
                </div>
                {buildImportSummary && (
                  <p className="settings-label" style={{ whiteSpace: 'pre-wrap' }}>
                    {buildImportSummary}
                  </p>
                )}

                <div className="settings-row">
                  <label className="settings-label">{t('settings.build_cache_clear')}</label>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!buildCache || buildCache.entries === 0}
                    onClick={() => setBuildClearOpen(true)}
                  >
                    {t('settings.build_cache_clear')}
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

            {active === 'python' && <PythonPackagesPanel />}

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
                  <label className="settings-label">{t('about.repo_heading')}</label>
                  <div className="settings-value about-links">
                    <a className="about-link" href={GITHUB_REPO} target="_blank" rel="noreferrer">
                      GitHub · github.com/SnowLeopard-io/ErgalicsStudio
                    </a>
                    <a className="about-link" href={GITEE_REPO} target="_blank" rel="noreferrer">
                      Gitee · gitee.com/cnt-code/ergalics-studio
                    </a>
                  </div>
                </div>

                <h3 className="settings-section-title" style={{ marginTop: 'var(--space-4)' }}>
                  {t('about.status_heading')}
                </h3>
                <p className="settings-label about-status">{t('about.status_text')}</p>

                <h3 className="settings-section-title" style={{ marginTop: 'var(--space-4)' }}>
                  {t('about.team_heading')}
                </h3>
                <div className="about-team">
                  {TEAM.map((member) => (
                    <div className="card about-member" key={member.name}>
                      <div className="about-member-header">
                        <span className="tag tag-muted">{t(member.roleKey)}</span>
                        <span className="about-member-handle">{member.name}</span>
                      </div>
                      <div className="about-member-links">
                        {member.github && (
                          <a href={member.github} target="_blank" rel="noreferrer">
                            GitHub · {member.name}
                          </a>
                        )}
                        <a href={member.gitee} target="_blank" rel="noreferrer">
                          Gitee · {member.giteeName}
                        </a>
                      </div>
                      <p className="settings-label about-member-intro">{t(member.introKey)}</p>
                    </div>
                  ))}
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
        open={buildClearOpen}
        onClose={() => setBuildClearOpen(false)}
        title={t('settings.build_cache_clear')}
        width={460}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setBuildClearOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void doClearBuildCache()}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <p>{t('settings.build_cache_clear_confirm')}</p>
        <p className="settings-label">
          {t('settings.build_cache_clear_detail', {
            count: buildCache?.entries ?? 0,
            bytes: formatBytes(buildCache?.bytes ?? 0),
          })}
        </p>
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