// ==========================================================================
// Ergalics Studio — workbench activity bar (Standard mode)
//
// VS Code 风格的窄条活动栏，挂在左侧栏最左侧。三个入口对应侧栏的三种
// 视图：文件资源管理器 / 插件列表 / Git。点击入口时侧栏自动切换到对应
// 视图并展开；点击已激活的入口则收起侧栏（再次点击恢复）。
// ==========================================================================

import { useT } from '@/i18n';
import { useAppStore, type SidebarView } from '@/stores/appStore';
import { FolderOpenIcon, LayersIcon, GitBranchIcon } from '@/components/icons';

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

  const items: ActivityItem[] = [
    { view: 'files', label: t('workbench.activity.files'), Icon: FolderOpenIcon },
    { view: 'plugins', label: t('workbench.activity.plugins'), Icon: LayersIcon },
    { view: 'git', label: t('workbench.activity.git'), Icon: GitBranchIcon },
  ];

  return (
    <nav className="activity-bar" aria-label={t('workbench.activity.label')}>
      {items.map(({ view, label, Icon }) => {
        const active = sidebarOpen && sidebarView === view;
        return (
          <button
            key={view}
            type="button"
            className={`activity-item${active ? ' is-active' : ''}`}
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => setSidebarView(view)}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </nav>
  );
}
