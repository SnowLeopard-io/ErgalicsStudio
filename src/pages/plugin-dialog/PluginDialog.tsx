import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { BUILTIN_PLUGINS, findBuiltin } from '@/plugins/builtin';
import { MARKETPLACE_CATALOG, MARKET_CATEGORIES, type MarketCategory, type MarketItem } from '@/plugins/marketplace';
import { buildDemoPackage } from '@/plugins/marketplace-demo-packages';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { inspectCspkg, loadCspkg } from '@/core/cspkg';
import { listPluginPackages, deletePluginPackage, type StoredPluginPackage } from '@/core/storage';
import type { SignatureCheckResult } from '@/core/plugin-signing';
import type { PluginManifest } from '@/types/plugin';

type Tab = 'market' | 'local' | 'builtin';

/** Pending install awaiting the FR-05 confirmation dialog. */
interface InstallTarget {
  fileName: string;
  buffer: ArrayBuffer;
  manifest: PluginManifest;
  signature: SignatureCheckResult;
  source: 'local' | 'marketplace';
}

interface PluginDialogProps {
  open: boolean;
  onClose: () => void;
  /** Plugin id to focus on open (website market deep link #/?plugin=<id>):
   *  switches to the market tab and filters to that listing. */
  focusId?: string;
}

export function PluginDialog({ open, onClose, focusId }: PluginDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const [tab, setTab] = useState<Tab>('market');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MarketCategory | 'all'>('all');
  const [selected, setSelected] = useState<PluginManifest | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<StoredPluginPackage | null>(null);
  const [installedRecords, setInstalledRecords] = useState<StoredPluginPackage[]>([]);
  const registry = usePluginStore((s) => s.registry);
  const loadingIds = usePluginStore((s) => s.loadingIds);
  const notify = useAppStore((s) => s.notify);
  const load = usePluginStore((s) => s.load);
  const unload = usePluginStore((s) => s.unload);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  // Website deep link (#/?plugin=<id>): focus the market tab on that listing.
  useEffect(() => {
    if (!open || !focusId) return;
    const item = MARKETPLACE_CATALOG.find((m) => m.manifest.id === focusId);
    setTab('market');
    setCategory('all');
    setQuery(item ? (item.manifest.nameI18n?.[locale] ?? item.manifest.name) : focusId);
  }, [open, focusId, locale]);

  useEffect(() => {
    if (!open) return;
    void listPluginPackages()
      .then(setInstalledRecords)
      .catch(() => setInstalledRecords([]));
  }, [open]);

  const refreshRecords = () => {
    void listPluginPackages()
      .then(setInstalledRecords)
      .catch(() => setInstalledRecords([]));
  };

  const builtins = useMemo(() => {
    const q = query.toLowerCase();
    const localName = (m: PluginManifest) => (m.nameI18n?.[locale] ?? m.name).toLowerCase();
    const localDesc = (m: PluginManifest) => (m.descriptionI18n?.[locale] ?? m.description).toLowerCase();
    return BUILTIN_PLUGINS.filter(
      (p) =>
        !q ||
        p.manifest.name.toLowerCase().includes(q) ||
        localName(p.manifest).includes(q) ||
        p.manifest.description.toLowerCase().includes(q) ||
        localDesc(p.manifest).includes(q),
    );
  }, [query, locale]);

  const marketItems = useMemo(() => {
    const q = query.toLowerCase();
    return MARKETPLACE_CATALOG.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (q) {
        const localName = (item.manifest.nameI18n?.[locale] ?? item.manifest.name).toLowerCase();
        const localDesc = (item.manifest.descriptionI18n?.[locale] ?? item.manifest.description).toLowerCase();
        if (
          !item.manifest.name.toLowerCase().includes(q) &&
          !localName.includes(q) &&
          !item.manifest.description.toLowerCase().includes(q) &&
          !localDesc.includes(q)
        ) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => b.popularity - a.popularity);
  }, [query, category, locale]);

  const isLoaded = (id: string) => registry.some((e) => e.id === id);
  const isLoading = (id: string) => loadingIds.includes(id) || installing === id;

  const loadBuiltin = async (manifest: PluginManifest) => {
    const info = findBuiltin(manifest.id);
    if (!info) return;
    setInstalling(manifest.id);
    try {
      const plugin = await info.load();
      await load(plugin);
      notify('success', `${manifest.nameI18n?.[locale] ?? manifest.name} ${t('plugin.loaded')}`);
    } catch (err) {
      notify('error', `${t('plugin.load_failed')}: ${String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const reasonMessage = (result: SignatureCheckResult): string => {
    switch (result.reason) {
      case 'missing': return t('signing.error_missing');
      case 'malformed': return t('signing.error_malformed');
      case 'fingerprint-mismatch': return t('signing.error_fingerprint_mismatch');
      case 'signature-invalid': return t('signing.error_signature_invalid');
      case 'untrusted-key': return t('signing.error_untrusted_key');
      default: return result.message;
    }
  };

  /** Parse + signature-gate a package buffer, then open the confirm dialog. */
  const openInstallTarget = async (fileName: string, buffer: ArrayBuffer, source: 'local' | 'marketplace') => {
    setInstalling(fileName);
    try {
      const inspected = await inspectCspkg(buffer);
      setTrustConfirmed(false);
      setInstallTarget({ fileName, buffer, manifest: inspected.manifest, signature: inspected.signature, source });
    } catch (err) {
      notify('error', `${t('signing.install_failed')}: ${String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleLocalFile = async (file: File) => {
    void openInstallTarget(file.name, await file.arrayBuffer(), 'local');
  };

  const handleDemoInstall = (item: MarketItem) => {
    if (!item.demoPackage) return;
    void openInstallTarget(`${item.demoPackage}.cspkg`, buildDemoPackage(item.demoPackage), 'marketplace');
  };

  const confirmInstall = async (trustOverride: boolean) => {
    const target = installTarget;
    if (!target) return;
    // A package whose id already lives in the registry (e.g. a hand-signed
    // build reusing a built-in id) would silently no-op in load()'s
    // isLoaded guard — the old "installed but nothing happens" bug. Refuse
    // it with an explicit warning instead.
    if (registry.some((e) => e.id === target.manifest.id)) {
      notify('warning', `${t('signing.id_conflict')}: ${target.manifest.id}`);
      setInstallTarget(null);
      return;
    }
    setInstalling(target.fileName);
    try {
      const file = new File([target.buffer], target.fileName);
      const { plugin, mode } = await loadCspkg(file, (id) => buildPluginApi(id), {
        trustUnsigned: trustOverride,
        source: target.source,
      });
      await load(plugin);
      // Install → activate: the plugin becomes immediately usable (canvas +
      // right-panel params) instead of sitting inertly in the sidebar list.
      await usePluginStore.getState().activate(plugin.manifest.id);
      setInstallTarget(null);
      refreshRecords();
      const pname = plugin.manifest.nameI18n?.[locale] ?? plugin.manifest.name;
      notify('success', `${pname} ${t('plugin.loaded')}`);
      if (mode === 'legacy-fallback') {
        notify('warning', `${pname}: ${t('plugin.sandbox_fallback')}`);
      } else if (mode === 'trusted') {
        notify('info', `${pname}: ${t('plugin.sandbox_trusted')}`);
      }
    } catch (err) {
      notify('error', `${t('signing.install_failed')}: ${String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const displayDesc = (m: PluginManifest) => m.descriptionI18n?.[locale] ?? m.description;
  const sourceLabel = (source?: StoredPluginPackage['source']) =>
    source === 'marketplace'
      ? t('signing.source.marketplace')
      : source === 'builtin'
        ? t('signing.source.builtin')
        : t('signing.source.local');
  const formatTime = (epochMs: number) =>
    new Date(epochMs).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');

  const confirmUninstall = async () => {
    const record = uninstallTarget;
    if (!record) return;
    try {
      await unload(record.id);
      await deletePluginPackage(record.id);
      refreshRecords();
      notify('success', t('signing.uninstall_done', { name: record.name }));
    } catch (err) {
      notify('error', `${t('signing.uninstall_failed')}: ${String(err)}`);
    } finally {
      setUninstallTarget(null);
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={t('plugin.title')}
      width={720}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="plugin-dialog">
        <div className="plugin-tabs" role="tablist">
          {(['market', 'local', 'builtin'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={`plugin-tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t(`plugin.${key}`)}
            </button>
          ))}
        </div>

        <div className="plugin-toolbar">
          <input
            className="input"
            placeholder={t('plugin.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {tab === 'builtin' && (
          <div className="plugin-list-pane">
            {builtins.length === 0 && <div className="empty-hint">{t('plugin.no_plugins')}</div>}
            {builtins.map((p) => (
              <div
                key={p.manifest.id}
                className={`plugin-card ${selected?.id === p.manifest.id ? 'active' : ''}`}
                onClick={() => setSelected(p.manifest)}
              >
                <div className="plugin-card-main">
                  <span className="plugin-icon">{p.manifest.icon ?? '◈'}</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{p.manifest.nameI18n?.[locale] ?? p.manifest.name}</div>
                    <div className="plugin-card-meta">
                      {t('plugin.version')} {p.manifest.version} · {p.manifest.author}
                    </div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  {isLoaded(p.manifest.id) ? (
                    <span className="tag tag-success">{t('plugin.loaded')}</span>
                  ) : isLoading(p.manifest.id) ? (
                    <span className="tag tag-muted"><span className="spinner" /> {t('plugin.loading')}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadBuiltin(p.manifest);
                      }}
                    >
                      {t('plugin.load')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'market' && (
          <div className="plugin-market-pane">
            <div className="plugin-cat-filter">
              <button
                type="button"
                className={`plugin-cat ${category === 'all' ? 'active' : ''}`}
                onClick={() => setCategory('all')}
              >
                {t('plugin.category.all')}
              </button>
              {MARKET_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`plugin-cat ${category === cat ? 'active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {t(`plugin.category.${cat}`)}
                </button>
              ))}
            </div>
            {marketItems.length === 0 && <div className="empty-hint">{t('plugin.no_plugins')}</div>}
            {marketItems.map((item) => {
              const id = item.manifest.id;
              const installed = isLoaded(id);
              const isDemo = Boolean(item.demoPackage);
              return (
                <div
                  key={id}
                  className={`plugin-card ${selected?.id === id ? 'active' : ''}`}
                  onClick={() => setSelected(item.manifest)}
                >
                  <div className="plugin-card-main">
                    <span className="plugin-icon">{item.manifest.icon ?? '◈'}</span>
                    <div className="plugin-card-info">
                      <div className="plugin-card-title">
                        {item.manifest.nameI18n?.[locale] ?? item.manifest.name}
                        <span className={`plugin-badge cat-${item.category}`}>
                          {t(`plugin.category.${item.category}`)}
                        </span>
                        {isDemo && <span className="tag tag-muted">{t('signing.signed_badge')}</span>}
                      </div>
                      <div className="plugin-card-meta">
                        {t('plugin.version')} {item.manifest.version} · {item.manifest.author}
                        {item.popularity > 0 && ` · ★ ${item.popularity}`}
                      </div>
                      {isDemo && (
                        <div className="plugin-card-meta">{t('signing.demo_note')}</div>
                      )}
                      {item.tags.length > 0 && (
                        <div className="plugin-card-tags">
                          {item.tags.map((tag) => (
                            <span key={tag} className="tag tag-muted">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="plugin-card-actions">
                    {installed ? (
                      <span className="tag tag-success">{t('plugin.loaded')}</span>
                    ) : isLoading(id) ? (
                      <span className="tag tag-muted"><span className="spinner" /> {t('plugin.loading')}</span>
                    ) : isDemo ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDemoInstall(item);
                        }}
                      >
                        {t('plugin.install')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          void loadBuiltin(item.manifest);
                        }}
                      >
                        {t('plugin.install')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'local' && (
          <div className="plugin-local-pane">
            <button type="button" className="btn btn-primary btn-block" onClick={() => fileInputRef.current?.click()}>
              {installing ? <span className="spinner" /> : t('plugin.choose_file')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".cspkg,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLocalFile(file);
                e.target.value = '';
              }}
            />
            <h4 className="sidebar-heading">{t('signing.installed_title')}</h4>
            {installedRecords.length === 0 && <div className="empty-hint">{t('signing.installed_empty')}</div>}
            {installedRecords.map((rec) => (
              <div key={rec.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">{rec.icon ?? '◈'}</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">
                      {rec.name}
                      <span className={`tag ${rec.signed ? 'tag-success' : 'tag-muted'}`}>
                        {rec.signed ? t('signing.signed_badge') : t('signing.unsigned_badge')}
                      </span>
                    </div>
                    <div className="plugin-card-meta">
                      {t('plugin.version')} {rec.version} · {rec.author} · {t('signing.source')}: {sourceLabel(rec.source)}
                    </div>
                    <div className="plugin-card-meta">
                      {t('signing.fingerprint')}: <code>{rec.fingerprint ?? '—'}</code>
                    </div>
                    <div className="plugin-card-meta">
                      {t('signing.installed_at', { time: formatTime(rec.installedAt) })}
                    </div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => setUninstallTarget(rec)}
                  >
                    {t('signing.uninstall')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selected && (
          <div className="plugin-detail">
            <div className="plugin-detail-title">{selected.nameI18n?.[locale] ?? selected.name}</div>
            <p className="plugin-detail-desc">{selected.descriptionI18n?.[locale] ?? selected.description}</p>
            <div className="plugin-detail-meta">
              <div>{t('plugin.version')}: {selected.version}</div>
              <div>{t('plugin.author')}: {selected.author}</div>
              {selected.license && <div>{t('plugin.license')}: {selected.license}</div>}
            </div>
            {selected.formats && selected.formats.length > 0 && (
              <div className="plugin-detail-formats">
                {selected.formats.map((f) => (
                  <span key={f.extension} className="tag tag-muted">{f.extension}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {registry.length > 0 && (
          <div className="plugin-loaded">
            <h4 className="sidebar-heading">{t('plugin.loaded_list')}</h4>
            <ul className="plugin-loaded-list">
              {registry.map((e) => (
                <li key={e.id}>
                  {e.name} <span className="tag tag-success">{e.version}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>

      {/* FR-05 install confirmation: publisher, fingerprint and permissions
          must be reviewed before anything executes. */}
      <Modal
        open={installTarget !== null}
        title={t('signing.install_title')}
        width={520}
        onClose={() => setInstallTarget(null)}
        footer={
          installTarget && (
            <>
              <button type="button" className="btn" onClick={() => setInstallTarget(null)}>
                {t('signing.reject')}
              </button>
              {installTarget.signature.ok ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={installing !== null}
                  onClick={() => void confirmInstall(false)}
                >
                  {t('signing.confirm_install')}
                </button>
              ) : installTarget.signature.reason === 'missing' ||
                installTarget.signature.reason === 'untrusted-key' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!trustConfirmed || installing !== null}
                  onClick={() => void confirmInstall(true)}
                >
                  {t('signing.trust_and_install')}
                </button>
              ) : null}
            </>
          )
        }
      >
        {installTarget && (
          <div className="plugin-dialog">
            <div className="plugin-detail-meta">
              <div>{t('signing.author')}: {installTarget.manifest.author}</div>
              <div>{t('signing.version')}: {installTarget.manifest.version}</div>
              <div>{t('signing.source')}: {sourceLabel(installTarget.source)}</div>
            </div>
            <p className="plugin-detail-desc">{displayDesc(installTarget.manifest)}</p>
            {installTarget.signature.ok ? (
              <div className="plugin-detail">
                <div className="plugin-detail-title">{t('signing.signature_ok')}</div>
                <p className="plugin-detail-desc">{t('signing.signature_ok_desc')}</p>
              </div>
            ) : installTarget.signature.reason === 'missing' ||
              installTarget.signature.reason === 'untrusted-key' ? (
              <div className="plugin-detail">
                <div className="plugin-detail-title">
                  {installTarget.signature.reason === 'missing'
                    ? t('signing.unsigned_title')
                    : t('signing.unknown_key_title')}
                </div>
                <p className="plugin-detail-desc">
                  {installTarget.signature.reason === 'missing'
                    ? t('signing.unsigned_desc')
                    : t('signing.unknown_key_desc')}
                </p>
              </div>
            ) : (
              <div className="plugin-detail">
                <div className="plugin-detail-title">{t('signing.install_failed')}</div>
                <p className="plugin-detail-desc">{reasonMessage(installTarget.signature)}</p>
              </div>
            )}
            <div className="plugin-detail-meta">
              <div>
                {t('signing.publisher')}: {installTarget.signature.signer ?? installTarget.manifest.author}
              </div>
              <div>
                {t('signing.fingerprint')}:{' '}
                <code>{installTarget.signature.fingerprint ?? installTarget.manifest.signature?.fingerprint ?? '—'}</code>
              </div>
            </div>
            <div className="plugin-detail-meta">
              <div>{t('signing.permissions')}</div>
              {(installTarget.manifest.signature?.permissions ?? []).length === 0 ? (
                <div className="empty-hint">{t('signing.permissions.none')}</div>
              ) : (
                <div className="plugin-card-tags">
                  {installTarget.manifest.signature?.permissions?.map((perm) => (
                    <span key={perm} className="tag tag-muted">{perm}</span>
                  ))}
                </div>
              )}
            </div>
            {(installTarget.signature.reason === 'missing' ||
              installTarget.signature.reason === 'untrusted-key') && (
              <label className="plugin-detail-meta">
                <input
                  type="checkbox"
                  checked={trustConfirmed}
                  onChange={(e) => setTrustConfirmed(e.target.checked)}
                />{' '}
                {t('signing.trust_source', {
                  fingerprint: installTarget.signature.fingerprint ?? '—',
                })}
              </label>
            )}
            <p className="plugin-detail-desc">{t('signing.sandbox_note')}</p>
          </div>
        )}
      </Modal>

      {/* Destructive actions go through a modal confirmation (project rule). */}
      <Modal
        open={uninstallTarget !== null}
        title={t('signing.uninstall_confirm_title')}
        width={440}
        onClose={() => setUninstallTarget(null)}
        footer={
          uninstallTarget && (
            <>
              <button type="button" className="btn" onClick={() => setUninstallTarget(null)}>
                {t('signing.reject')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmUninstall()}
              >
                {t('signing.uninstall')}
              </button>
            </>
          )
        }
      >
        {uninstallTarget && (
          <p className="plugin-detail-desc">
            {t('signing.uninstall_confirm_body', {
              name: uninstallTarget.name,
              version: uninstallTarget.version,
            })}
          </p>
        )}
      </Modal>
    </>
  );
}