import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { PluginDialog } from '../plugin-dialog/PluginDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CloseIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { PLUGIN_DISCIPLINES, disciplineOf } from '@/plugins/categories';
import type { PluginRegistryEntry } from '@/types/plugin';

/** Plugins showcased in the sidebar "New Releases" section (topmost group). */
const FRESH_PLUGIN_IDS = ['example.em-eigensolver'];

export function Sidebar() {
  const t = useT();
  const location = useLocation();
  const project = useProjectStore((s) => s.project);
  const recent = useProjectStore((s) => s.recent);
  const openProject = useProjectStore((s) => s.openProject);
  const remove = useProjectStore((s) => s.remove);

  const registry = usePluginStore((s) => s.registry);
  const activeId = usePluginStore((s) => s.activeId);
  const loadingIds = usePluginStore((s) => s.loadingIds);
  const activate = usePluginStore((s) => s.activate);

  const [pluginOpen, setPluginOpen] = useState(false);
  const [pluginFocusId, setPluginFocusId] = useState<string | undefined>(undefined);
  /** Pending destructive action: project awaiting delete confirmation. */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  /** Collapsed discipline groups (in-memory; all expanded by default). */
  const [collapsed, setCollapsed] = useState<Partial<Record<string, boolean>>>({});

  useEffect(() => {
    void useProjectStore.getState().loadRecent();
  }, []);

  // The welcome page's "Market" link navigates here with
  // { state: { openPluginDialog: true } } — open the plugin dialog and
  // consume the flag so a refresh does not re-open it. A website plugin
  // deep link adds { pluginQuery: '<id>' } to focus that listing.
  useEffect(() => {
    const state = location.state as { openPluginDialog?: boolean; pluginQuery?: string } | null;
    if (state?.openPluginDialog) {
      setPluginFocusId(state.pluginQuery);
      setPluginOpen(true);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Group the loaded registry by discipline, keeping the registry's own
  // order inside each group; empty groups are omitted.
  const { locale } = useLocale();
  const groups = useMemo(() => {
    const byDiscipline = new Map<string, PluginRegistryEntry[]>();
    for (const entry of registry) {
      const d = disciplineOf(entry.id);
      const list = byDiscipline.get(d) ?? [];
      list.push(entry);
      byDiscipline.set(d, list);
    }
    return PLUGIN_DISCIPLINES.filter((d) => byDiscipline.has(d.id)).map((d) => ({
      ...d,
      label: d.nameI18n[locale] ?? d.nameI18n['en-US']!,
      entries: byDiscipline.get(d.id)!,
    }));
  }, [registry, locale]);

  // "New Releases" showcase group pinned above the discipline groups; only
  // shown while at least one featured plugin is actually loaded.
  const allGroups = useMemo(() => {
    const fresh = registry.filter((e) => FRESH_PLUGIN_IDS.includes(e.id));
    if (fresh.length === 0) return groups;
    return [
      { id: 'fresh', label: t('workbench.sidebar.fresh'), entries: fresh },
      ...groups,
    ];
  }, [groups, registry, t]);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="sidebar">
      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('workbench.sidebar.project')}</h3>
        {recent.length > 0 ? (
          <ul className="recent-list">
            {recent.map((p) => (
              <li key={p.id} className={`recent-item ${project?.id === p.id ? 'active' : ''}`}>
                <button type="button" className="recent-name" onClick={() => void openProject(p.id)}>
                  {p.name || DEFAULT_PROJECT_NAME}
                </button>
                <button
                  type="button"
                  className="icon-btn recent-delete"
                  title={t('common.delete')}
                  onClick={() => setDeleteTarget({ id: p.id, name: p.name || DEFAULT_PROJECT_NAME })}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="sidebar-plugin-empty" title={t('workbench.sidebar.no_recent')} />
        )}
      </nav>

      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('workbench.sidebar.plugins')}</h3>
        <button type="button" className="btn btn-sm btn-block" onClick={() => setPluginOpen(true)}>
          {t('plugin.load')}
        </button>
        {registry.length === 0 && (
          <EmptyState className="sidebar-plugin-empty" title={t('workbench.plugin.none')} />
        )}
        {allGroups.map((group) => {
          const isCollapsed = collapsed[group.id] === true;
          return (
            <div key={group.id} className="plugin-group">
              <button
                type="button"
                className="plugin-group-header"
                onClick={() => toggleGroup(group.id)}
              >
                <span className={`plugin-group-chevron ${isCollapsed ? 'is-collapsed' : ''}`}>▾</span>
                <span className="plugin-group-name">{group.label}</span>
                <span className="plugin-group-count">{group.entries.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="plugin-list">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`plugin-item ${activeId === entry.id ? 'active' : ''}`}
                        data-plugin-id={entry.id}
                        title={`${entry.name} ${entry.version}`}
                        onClick={() => void activate(entry.id)}
                      >
                        <span className="plugin-icon">{entry.icon ?? '◈'}</span>
                        <span className="plugin-item-name">{entry.name}</span>
                        {loadingIds.includes(entry.id) && (
                          <span className="plugin-item-loading"><span className="spinner" /></span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Deleting a project is irreversible — confirm before removing. */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('common.delete')}
        message={t('project.remove_confirm')}
        name={deleteTarget?.name}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget.id);
        }}
        onClose={() => setDeleteTarget(null)}
      />

      <PluginDialog open={pluginOpen} onClose={() => { setPluginOpen(false); setPluginFocusId(undefined); }} focusId={pluginFocusId} />
    </aside>
  );
}
