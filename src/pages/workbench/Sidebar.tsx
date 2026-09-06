import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { PluginDialog } from '../plugin-dialog/PluginDialog';
import { PLUGIN_DISCIPLINES, disciplineOf } from '@/plugins/categories';
import type { PluginRegistryEntry } from '@/types/plugin';

export function Sidebar() {
  const t = useT();
  const location = useLocation();
  const project = useProjectStore((s) => s.project);
  const recent = useProjectStore((s) => s.recent);
  const createProject = useProjectStore((s) => s.createProject);
  const openProject = useProjectStore((s) => s.openProject);
  const remove = useProjectStore((s) => s.remove);
  const openFromFile = useProjectStore((s) => s.openFromFile);

  const registry = usePluginStore((s) => s.registry);
  const activeId = usePluginStore((s) => s.activeId);
  const loadingIds = usePluginStore((s) => s.loadingIds);
  const activate = usePluginStore((s) => s.activate);

  const notify = useAppStore((s) => s.notify);

  const [newOpen, setNewOpen] = useState(false);
  const [pluginOpen, setPluginOpen] = useState(false);
  const [newName, setNewName] = useState('');
  /** Collapsed discipline groups (in-memory; all expanded by default). */
  const [collapsed, setCollapsed] = useState<Partial<Record<string, boolean>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useProjectStore.getState().loadRecent();
  }, []);

  // The welcome page's "Market" link navigates here with
  // { state: { openPluginDialog: true } } — open the plugin dialog and
  // consume the flag so a refresh does not re-open it.
  useEffect(() => {
    const state = location.state as { openPluginDialog?: boolean } | null;
    if (state?.openPluginDialog) {
      setPluginOpen(true);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const handleNewProject = async () => {
    const name = newName.trim();
    await createProject(name);
    setNewOpen(false);
    setNewName('');
  };

  // Group the loaded registry by discipline, keeping the registry's own
  // order inside each group; empty groups are omitted.
  const locale = useLocale();
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

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="sidebar">
      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('workbench.sidebar.project')}</h3>
        <div className="sidebar-actions">
          <button type="button" className="btn btn-sm btn-block" onClick={() => setNewOpen(true)}>
            {t('project.new')}
          </button>
          <button type="button" className="btn btn-sm btn-block" onClick={() => fileInputRef.current?.click()}>
            {t('project.open')}
          </button>
        </div>
        {recent.length > 0 && (
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
                  onClick={() => void remove(p.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('workbench.sidebar.plugins')}</h3>
        <button type="button" className="btn btn-sm btn-block" onClick={() => setPluginOpen(true)}>
          {t('plugin.load')}
        </button>
        {registry.length === 0 && (
          <ul className="plugin-list">
            <li className="empty-hint">{t('workbench.plugin.none')}</li>
          </ul>
        )}
        {groups.map((group) => {
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".clproj,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
          e.target.value = '';
        }}
      />

      {newOpen && (
        <div className="modal-overlay" onMouseDown={() => setNewOpen(false)}>
          <div className="modal modal-sm" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <label className="field-label" htmlFor="new-project-name">
                {t('project.prompt_name')}
              </label>
              <input
                id="new-project-name"
                className="input"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleNewProject()}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setNewOpen(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleNewProject()}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <PluginDialog open={pluginOpen} onClose={() => setPluginOpen(false)} />
    </aside>
  );
}