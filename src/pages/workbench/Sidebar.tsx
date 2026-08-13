import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { PluginDialog } from '../plugin-dialog/PluginDialog';

export function Sidebar() {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const recent = useProjectStore((s) => s.recent);
  const createProject = useProjectStore((s) => s.createProject);
  const openProject = useProjectStore((s) => s.openProject);
  const remove = useProjectStore((s) => s.remove);
  const openFromFile = useProjectStore((s) => s.openFromFile);

  const registry = usePluginStore((s) => s.registry);
  const activeId = usePluginStore((s) => s.activeId);
  const activate = usePluginStore((s) => s.activate);

  const notify = useAppStore((s) => s.notify);

  const [newOpen, setNewOpen] = useState(false);
  const [pluginOpen, setPluginOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useProjectStore.getState().loadRecent();
  }, []);

  const handleNewProject = async () => {
    const name = newName.trim() || t('project.untitled');
    await createProject(name);
    setNewOpen(false);
    setNewName('');
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
                  {p.name}
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
        <ul className="plugin-list">
          {registry.length === 0 && <li className="empty-hint">{t('workbench.plugin.none')}</li>}
          {registry.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`plugin-item ${activeId === entry.id ? 'active' : ''}`}
                title={`${entry.name} ${entry.version}`}
                onClick={() => void activate(entry.id)}
              >
                <span className="plugin-icon">{entry.icon ?? '◈'}</span>
                <span className="plugin-item-name">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('workbench.sidebar.tools')}</h3>
        <button type="button" className="btn btn-sm btn-block" onClick={() => navigate('/settings')}>
          {t('workbench.tools.settings')}
        </button>
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