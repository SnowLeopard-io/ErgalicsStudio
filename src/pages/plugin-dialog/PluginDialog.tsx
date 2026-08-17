import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { BUILTIN_PLUGINS, findBuiltin } from '@/plugins/builtin';
import { MARKETPLACE_CATALOG, MARKET_CATEGORIES, type MarketCategory } from '@/plugins/marketplace';
import { usePluginStore, buildPluginApi } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import type { PluginManifest } from '@/types/plugin';

type Tab = 'market' | 'local' | 'builtin';

interface PluginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PluginDialog({ open, onClose }: PluginDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const [tab, setTab] = useState<Tab>('market');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MarketCategory | 'all'>('all');
  const [selected, setSelected] = useState<PluginManifest | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const registry = usePluginStore((s) => s.registry);
  const loadingIds = usePluginStore((s) => s.loadingIds);
  const notify = useAppStore((s) => s.notify);
  const load = usePluginStore((s) => s.load);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

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

  const handleLocalFile = async (file: File) => {
    setInstalling(file.name);
    try {
      const pkg = await import('@/core/cspkg');
      const { plugin, mode } = await pkg.loadCspkg(file, (id) => buildPluginApi(id));
      await load(plugin);
      const pname = plugin.manifest.nameI18n?.[locale] ?? plugin.manifest.name;
      notify('success', `${pname} ${t('plugin.loaded')}`);
      if (mode === 'legacy-fallback') {
        notify(
          'warning',
          `${pname}: ${t('plugin.sandbox_fallback')}`,
        );
      } else if (mode === 'trusted') {
        notify('info', `${pname}: ${t('plugin.sandbox_trusted')}`);
      }
    } catch (err) {
      notify('error', `${t('plugin.load_failed')}: ${String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  return (
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
              const comingSoon = !item.builtin;
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
                      </div>
                      <div className="plugin-card-meta">
                        {t('plugin.version')} {item.manifest.version} · {item.manifest.author}
                        {item.popularity > 0 && ` · ★ ${item.popularity}`}
                      </div>
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
                    {comingSoon ? (
                      <span className="tag tag-muted">{t('plugin.coming_soon')}</span>
                    ) : installed ? (
                      <span className="tag tag-success">{t('plugin.loaded')}</span>
                    ) : isLoading(id) ? (
                      <span className="tag tag-muted"><span className="spinner" /> {t('plugin.loading')}</span>
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
              {installing ? <span className="spinner" /> : t('plugin.file_format')}
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
  );
}