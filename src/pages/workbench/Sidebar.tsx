import { useEffect, useMemo, useState, type CSSProperties, type AnimationEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { PluginDialog } from '../plugin-dialog/PluginDialog';
import { GitPanel } from '@/components/GitPanel';
import { ChevronRightIcon, ChevronLeftIcon, ToolIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { FileExplorer } from '@/pages/workbench/FileExplorer';
import { PLUGIN_DISCIPLINES, disciplineOf } from '@/plugins/categories';
import type { PluginRegistryEntry } from '@/types/plugin';
import { usePanelWidth } from '@/hooks/usePanelWidth';
import { useAppStore } from '@/stores/appStore';
import { RESEARCH_TOOLS, openToolEmbedded } from '@/pages/research/toolRegistry';

/** Utility-toolkit entries shown in the sidebar tools view (activity bar). */
const UTIL_TOOLS = RESEARCH_TOOLS.filter((tool) => tool.group === 'utils');

/** Research-suite groups (in launcher order) for the sidebar research view. */
const RESEARCH_GROUP_IDS = ['measure', 'model', 'data', 'signal', 'deliver'] as const;

/** Plugins showcased in the sidebar "New Releases" section (topmost group). */
const FRESH_PLUGIN_IDS = ['example.em-eigensolver', 'example.fluid-cfd-coupler'];

/** Collapsed discipline groups persist per-machine so the sidebar layout
 *  survives reloads (mirrors the panel-prefs persistence in appStore). */
const GROUPS_PREFS_KEY = 'ergalics:sidebar-groups';

function loadCollapsedGroups(): Partial<Record<string, boolean>> {
  try {
    const raw = localStorage.getItem(GROUPS_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<string, boolean>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persistCollapsedGroups(collapsed: Partial<Record<string, boolean>>): void {
  try {
    localStorage.setItem(GROUPS_PREFS_KEY, JSON.stringify(collapsed));
  } catch {
    /* private mode — no persistence */
  }
}

export function Sidebar() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();

  const registry = usePluginStore((s) => s.registry);
  const activeId = usePluginStore((s) => s.activeId);
  const loadingIds = usePluginStore((s) => s.loadingIds);
  const activate = usePluginStore((s) => s.activate);

  const [pluginOpen, setPluginOpen] = useState(false);
  const [pluginFocusId, setPluginFocusId] = useState<string | undefined>(undefined);
  /** Collapsed discipline groups (all expanded by default; persists). */
  const [collapsed, setCollapsed] = useState<Partial<Record<string, boolean>>>(() => loadCollapsedGroups());

  const resize = usePanelWidth('ergalics:sidebar-width', 248, 180, 480);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const sidebarView = useAppStore((s) => s.sidebarView);
  const activeTab = useAppStore((s) => s.activeTab);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  /** 收起退场进行中：wrap 播放宽度收拢动画，动画结束后才真正翻转 store，
   *  这样收起和展开两个方向都有过渡。 */
  const [closing, setClosing] = useState(false);
  /** 展开入场已结束：panel-wrap-opening 的 overflow:hidden 会裁剪挂在外缘
   *  的收起按钮，动画结束后必须摘掉该类。计时兜底覆盖 animationend 未触发
   *  的情况（如 reduced-motion 下动画被禁用）。 */
  const [entered, setEntered] = useState(false);

  // 重新展开时清掉退场标记，否则下次挂载的 wrap 会带上收拢动画类。
  useEffect(() => {
    if (sidebarOpen) {
      setClosing(false);
      const t = window.setTimeout(() => setEntered(true), 280);
      return () => window.clearTimeout(t);
    }
    setEntered(false);
  }, [sidebarOpen]);

  const handleCollapse = () => {
    if (closing) return;
    setClosing(true);
    // 兜底：onAnimationEnd 因任何原因未触发时也保证最终收起。
    window.setTimeout(() => {
      if (useAppStore.getState().sidebarOpen) toggleSidebar();
    }, 300);
  };

  const onCollapseAnimEnd = (e: AnimationEvent<HTMLDivElement>) => {
    // 子元素的入场动画也会冒泡 animationend，必须限定目标和动画名。
    if (closing && e.target === e.currentTarget && e.animationName === 'panel-collapse') {
      if (useAppStore.getState().sidebarOpen) toggleSidebar();
    }
  };

  // 活动栏点击已激活入口的收起请求以窗口事件到达（appStore.setSidebarView
  // 派发），复用与边缘收起按钮相同的退场动画路径。
  useEffect(() => {
    const onCollapseRequest = () => handleCollapse();
    window.addEventListener('ergalics:collapse-sidebar', onCollapseRequest);
    return () => window.removeEventListener('ergalics:collapse-sidebar', onCollapseRequest);
  });

  /** Activating a plugin hands the canvas back to it: switch to the plugin
   *  tab. Open file/suite tabs stay in the strip and can be switched back. */
  const showPluginCanvas = () => useAppStore.getState().showPluginCanvas();

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
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    persistCollapsedGroups(next);
  };

  // 收起态：侧栏本体不渲染，只在其原位置（中央区左侧）露一个窄的
  // 展开按钮，点击恢复展开。
  if (!sidebarOpen) {
    return (
      <button
        type="button"
        className="panel-edge-btn panel-edge-left"
        aria-label={t('ux.panel.expand_sidebar')}
        title={t('ux.panel.expand_sidebar')}
        onClick={toggleSidebar}
      >
        <ChevronRightIcon size={12} />
      </button>
    );
  }

  return (
    // 手柄挂在包裹层而非侧栏内部：侧栏 overflow 会裁剪超出边界的部分，
    // 感应区必须整体落在侧栏右缘外才完整可命中。
    <div
      className={`panel-wrap${closing ? ' panel-wrap-closing' : entered ? '' : ' panel-wrap-opening'}`}
      style={
        {
          width: resize.width,
          // 收拢动画期间冻结内容宽度（内容被裁剪而非挤压回绕）。
          '--panel-closing-width': `${resize.width}px`,
        } as CSSProperties
      }
      onAnimationEnd={onCollapseAnimEnd}
    >
      <div
        className="panel-resize-handle panel-resize-right"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('ux.resize.sidebar')}
        title={t('ux.resize.sidebar')}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
      />
      <button
        type="button"
        className="panel-collapse-btn panel-collapse-right"
        aria-label={t('ux.panel.collapse_sidebar')}
        title={t('ux.panel.collapse_sidebar')}
        onClick={handleCollapse}
      >
        <ChevronLeftIcon size={12} />
      </button>
      <aside className="sidebar">
      {/* 视图内容：活动栏（ActivityBar）决定显示哪一个。项目切换下拉
          位于顶部栏的项目名处。 */}
      {sidebarView === 'files' && <FileExplorer />}

      {sidebarView === 'git' && <GitPanel alwaysOpen />}

      {sidebarView === 'research' && (
      <nav className="sidebar-group">
        {RESEARCH_GROUP_IDS.map((group) => {
          const tools = RESEARCH_TOOLS.filter((tool) => tool.group === group);
          if (tools.length === 0) return null;
          return (
            <section key={group} className="plugin-group">
              <h3 className="sidebar-heading">{t(`tool.group.${group}`)}</h3>
              <ul className="plugin-list">
                {tools.map((tool) => {
                  const active = activeTab === `tool:${tool.id}`;
                  return (
                    <li key={tool.id}>
                      <button
                        type="button"
                        className={`plugin-item util-item${active ? ' active' : ''}`}
                        title={t(tool.descKey)}
                        onClick={() => openToolEmbedded(navigate, tool.id, location.pathname)}
                      >
                        <span className="plugin-icon"><ToolIcon kind={tool.icon} size={15} /></span>
                        <span className="util-item-text">
                          <span className="plugin-item-name">{t(tool.titleKey)}</span>
                          <span className="util-item-desc">{t(tool.descKey)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>
      )}

      {sidebarView === 'tools' && (
      <nav className="sidebar-group">
        <h3 className="sidebar-heading">{t('tool.group.utils')}</h3>
        <ul className="plugin-list">
          {UTIL_TOOLS.map((tool) => {
            const active = activeTab === `tool:${tool.id}`;
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  className={`plugin-item util-item${active ? ' active' : ''}`}
                  title={t(tool.descKey)}
                  onClick={() => openToolEmbedded(navigate, tool.id, location.pathname)}
                >
                  <span className="plugin-icon"><ToolIcon kind={tool.icon} size={15} /></span>
                  <span className="util-item-text">
                    <span className="plugin-item-name">{t(tool.titleKey)}</span>
                    <span className="util-item-desc">{t(tool.descKey)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      )}

      {sidebarView === 'plugins' && (
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
                        onClick={() => {
                          void activate(entry.id);
                          showPluginCanvas();
                        }}
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
      )}

      <PluginDialog open={pluginOpen} onClose={() => { setPluginOpen(false); setPluginFocusId(undefined); }} focusId={pluginFocusId} />
      </aside>
    </div>
  );
}
