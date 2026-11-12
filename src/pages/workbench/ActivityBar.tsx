// ==========================================================================
// Ergalics Studio — workbench activity bar (Standard mode)
//
// VS Code 风格的窄条活动栏，挂在左侧栏最左侧。三个入口对应侧栏的三种
// 视图：文件资源管理器 / 插件列表 / Git。点击入口时侧栏自动切换到对应
// 视图并展开；点击已激活的入口则收起侧栏（再次点击恢复）。
// 底部固定全局设置入口（原顶部栏的设置图标移到这里）。
// ==========================================================================

import { useT } from '@/i18n';
import { useAppStore, type SidebarView } from '@/stores/appStore';
import { FlaskIcon, FolderOpenIcon, LayersIcon, GitBranchIcon, SearchIcon, SettingsIcon, TerminalIcon, ToolboxIcon } from '@/components/icons';

interface ActivityItem {
  view: SidebarView;
  label: string;
  Icon: typeof FolderOpenIcon;
}

export function ActivityBar() {
  const t = useT();
  const sidebarView = useAppStore((s) => s.sidebarView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const openSettingsTab = useAppStore((s) => s.openSettingsTab);
  const terminalOpen = useAppStore((s) => s.terminalOpen);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);

  const items: ActivityItem[] = [
    { view: 'files', label: t('workbench.activity.files'), Icon: FolderOpenIcon },
    { view: 'search', label: t('workbench.activity.search'), Icon: SearchIcon },
    { view: 'plugins', label: t('workbench.activity.plugins'), Icon: LayersIcon },
    { view: 'git', label: t('workbench.activity.git'), Icon: GitBranchIcon },
    { view: 'research', label: t('workbench.activity.research'), Icon: FlaskIcon },
    { view: 'tools', label: t('workbench.activity.tools'), Icon: ToolboxIcon },
  ];

  return (
    <nav className="activity-bar" aria-label={t('workbench.activity.label')}>
      <div className="activity-bar-views">
        {items.map(({ view, label, Icon }) => {
          const active = sidebarOpen && sidebarView === view;
          return (
            <button
              key={view}
              type="button"
              className={`activity-item${active ? ' is-active' : ''}`}
              data-activity={view}
              aria-label={label}
              aria-pressed={active}
              title={label}
              onClick={() => setSidebarView(view)}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>

      {/* 终端呼出：固定在设置入口上方；开合状态点亮图标。 */}
      <div className="activity-bar-footer">
        <button
          type="button"
          className={`activity-item${terminalOpen ? ' is-active' : ''}`}
          aria-label={t('terminal.title')}
          title={`${t('terminal.title')} (Ctrl+\`)`}
          aria-pressed={terminalOpen}
          onClick={toggleTerminal}
        >
          <TerminalIcon size={20} />
        </button>
        <button
          type="button"
          className="activity-item"
          aria-label={t('workbench.tools.settings')}
          title={t('workbench.tools.settings')}
          onClick={() => openSettingsTab()}
        >
          <SettingsIcon size={20} />
        </button>
      </div>
    </nav>
  );
}
