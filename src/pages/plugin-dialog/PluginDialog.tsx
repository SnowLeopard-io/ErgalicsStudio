import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { BUILTIN_PLUGINS, findBuiltin } from '@/plugins/builtin';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import type { PluginManifest } from '@/types/plugin';

type Tab = 'market' | 'local' | 'builtin';

interface PluginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PluginDialog({ open, onClose }: PluginDialogProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('builtin');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PluginManifest | null>(null);
  const registry = usePluginStore((s) => s.registry);
  const notify = useAppStore((s) => s.notify);
  const load = usePluginStore((s) => s.load);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const builtins = useMemo(() => {
    const q = query.toLowerCase();
    return BUILTIN_PLUGINS.filter(
      (p) =>
        !q ||
        p.manifest.name.toLowerCase().includes(q) ||
        p.manifest.description.toLowerCase().includes(q),
    );
  }, [query]);

  const isLoaded = (id: string) => registry.some((e) => e.id === id);

  const loadBuiltin = async (manifest: PluginManifest) => {
    const info = findBuiltin(manifest.id);
    if (!info) return;
    try {
      const plugin = await info.load();
      await load(plugin);
      notify('success', `${manifest.name} ${t('plugin.loaded')}`);
    } catch (err) {
      notify('error', `${t('plugin.load_failed')}: ${String(err)}`);
    }
  };

  const handleLocalFile = async (file: File) => {
    try {
      const pkg = await import('@/core/cspkg');
      const plugin = await pkg.loadCspkg(file);
      await load(plugin);
      notify('success', `${plugin.manifest.name} ${t('plugin.loaded')}`);
    } catch (err) {
      notify('error', `${t('plugin.load_failed')}: ${String(err)}`);
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
                    <div className="plugin-card-title">{p.manifest.name}</div>
                    <div className="plugin-card-meta">
                      {t('plugin.version')} {p.manifest.version} · {p.manifest.author}
                    </div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  {isLoaded(p.manifest.id) ? (
                    <span className="tag tag-success">{t('plugin.loaded')}</span>
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
          <div className="plugin-list-pane">
            <div className="empty-hint">{t('plugin.no_plugins')}</div>
            <p className="empty-hint">Plugin market source not configured yet.</p>
          </div>
        )}

        {tab === 'local' && (
          <div className="plugin-local-pane">
            <button type="button" className="btn btn-primary btn-block" onClick={() => fileInputRef.current?.click()}>
              {t('plugin.file_format')}
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
            <div className="plugin-detail-title">{selected.name}</div>
            <p className="plugin-detail-desc">{selected.description}</p>
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