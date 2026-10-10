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
import { FolderOpenIcon, LayersIcon, GitBranchIcon, SettingsIcon } from '@/components/icons';

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

  const items: ActivityItem[] = [
    { view: 'files', label: t('workbench.activity.files'), Icon: FolderOpenIcon },
    { view: 'plugins', label: t('workbench.activity.plugins'), Icon: LayersIcon },
    { view: 'git', label: t('workbench.activity.git'), Icon: GitBranchIcon },
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

      {/* 全局设置：固定在活动栏底部（VS Code 同款位置）。 */}
      <div className="activity-bar-footer">
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
