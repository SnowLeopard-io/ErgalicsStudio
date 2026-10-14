import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useTourStore } from '@/stores/tourStore';
import { useAppStore } from '@/stores/appStore';
import { downloadBlob } from '@/core/download';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Dropdown } from '@/components/Dropdown';
import { ResearchLauncher } from '@/components/ResearchLauncher';
import { openToolEmbedded } from '@/pages/research/toolRegistry';
import { MenuIcon, GaugeIcon, MoreIcon, SparklesIcon } from '@/components/icons';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useShortcutsStore } from '@/stores/shortcutsStore';
import { useModeSync } from '@/hooks/useModeSync';
import { TopBarDialogs, type TopBarDialogKey } from './TopBarDialogs';

const MODE_KEYS = ['standard', 'flow', 'block', 'code'] as const;

export function TopBar() {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const recent = useProjectStore((s) => s.recent);
  const openProject = useProjectStore((s) => s.openProject);
  const save = useProjectStore((s) => s.save);
  const saveAs = useProjectStore((s) => s.saveAs);
  const openFromFile = useProjectStore((s) => s.openFromFile);
  const importFolder = useProjectStore((s) => s.importFolder);
  const notify = useAppStore((s) => s.notify);
  const resetToWelcome = useAppStore((s) => s.resetToWelcome);
  const toggleModePanel = useAppStore((s) => s.toggleModePanel);
  const modePanelOpen = useAppStore((s) => s.modePanelOpen);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const perfFps = useAppStore((s) => s.perf.fps);
  const perfWarnFps = useAppStore((s) => s.perf.warnings.fps);
  const startTour = useTourStore((s) => s.start);
  const aiOpen = useAiPanelStore((s) => s.open);
  const toggleAi = useAiPanelStore((s) => s.toggle);
  const syncState = useModeSync();

  // Single dialog key: only one TopBar dialog can be open at a time, so the
  // previous eleven booleans collapse into this one piece of state (rendered
  // by <TopBarDialogs /> at the bottom of this file).
  const [dialog, setDialog] = useState<TopBarDialogKey | null>(null);
  const openDialog = (key: TopBarDialogKey) => () => setDialog(key);
  const closeDialog = () => setDialog(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileCount = project?.data.files.length ?? 0;

  const location = useLocation();
  // Welcome-page entry states: openResearchDialog / openTool embed the tool
  // in the central canvas; openDataDialog opens the bundled-samples dialog.
  useEffect(() => {
    const state = location.state as
      | { openResearchDialog?: string; openDataDialog?: boolean; openTool?: string }
      | null;
    let consumed = false;
    if (state?.openResearchDialog) {
      openToolEmbedded(navigate, state.openResearchDialog, location.pathname);
      consumed = true;
    }
    if (state?.openTool) {
      openToolEmbedded(navigate, state.openTool, location.pathname);
      consumed = true;
    }
    if (state?.openDataDialog) {
      setDialog('data');
      consumed = true;
    }
    if (consumed) window.history.replaceState({}, '');
  }, [location.state, location.pathname, navigate]);

  const handleOpenFile = (file: File) => {
    void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
  };

  const perfTitle = `${t('workbench.perf.title')}${perfFps > 0 ? ` · ${perfFps} FPS` : ''}`;
  const perfWarn = perfWarnFps && perfFps > 0;

  return (
    <header className="topbar">
      {/* Zone 1 — navigation: ☰ (mode panel toggle in non-standard modes;
          in Standard the sidebar owns its edge collapse button instead),
          brand, current project name. */}
      {mode !== 'standard' && (
        <button
          type="button"
          className={`icon-btn${modePanelOpen ? ' is-active' : ''}`}
          aria-label={t('workbench.menu.toggle_panel')}
          aria-pressed={modePanelOpen}
          title={t('workbench.menu.toggle_panel')}
          onClick={toggleModePanel}
        >
          <MenuIcon size={17} />
        </button>
      )}

      {/* Brand = home: back to the boot state — empty canvas with the
          welcome screen (plugin deactivated, all canvas tabs closed). */}
      <a
        className="brand"
        href="#/workbench"
        onClick={(e) => {
          e.preventDefault();
          resetToWelcome();
          navigate('/workbench');
        }}
      >
        <span className="brand-name">Ergalics Studio</span>
      </a>

      {/* 项目下拉：触发器即项目名。上半区切换最近项目，下半区是全部
          项目管理操作（新建/打开/重命名/另存为/删除/导出日志）——原来
          单独的"项目"菜单与之功能重叠，已并入此处。 */}
      <Dropdown
        ariaLabel={t('workbench.menu.project')}
        triggerClassName="project-name"
        align="left"
        trigger={
          <span title={project ? project.name : t('project.new')}>
            {project ? project.name : t('project.new')}
            {dirty && <span className="project-dirty">•</span>}
            <span className="more-caret">▾</span>
          </span>
        }
        items={[
          { key: 'recent-header', label: t('workbench.project.recent'), header: true },
          ...(recent.length > 0
            ? recent.map((p) => ({
                key: p.id,
                label: p.name || DEFAULT_PROJECT_NAME,
                active: p.id === project?.id,
                onClick: () => void openProject(p.id),
              }))
            : [{ key: 'no-recent', label: t('workbench.sidebar.no_recent'), disabled: true }]),
          { key: 'sep-projects', label: '' },
          { key: 'actions-header', label: t('workbench.menu.project'), header: true },
          { key: 'new', label: t('project.new'), onClick: openDialog('new') },
          { key: 'open', label: t('project.open'), onClick: () => fileInputRef.current?.click() },
          {
            key: 'open_folder',
            label: t('project.open_folder'),
            onClick: () => folderInputRef.current?.click(),
          },
          { key: 'rename', label: t('project.rename'), onClick: openDialog('rename') },
          { key: 'save_as', label: t('project.save_as'), onClick: () => saveAs() },
          {
            key: 'export_log',
            label: t('workbench.export_log'),
            onClick: () => {
              void usePluginStore
                .getState()
                .exportDiagnostics()
                .then((json) => {
                  downloadBlob(
                    `ergalics-run-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
                    json,
                    'application/json',
                  );
                  notify('success', t('workbench.export_log_done'));
                })
                .catch(() => notify('error', t('workbench.export_log')));
            },
          },
          { key: 'sep-danger', label: '' },
          { key: 'danger-header', label: t('workbench.menu.danger'), header: true },
          {
            key: 'delete',
            label: t('project.delete'),
            disabled: !project,
            danger: true,
            onClick: openDialog('project_delete'),
          },
        ]}
      />

      <div className="topbar-actions">
        {/* Zone 2 — work modes (filled + underline double indication). */}
        <div className="topbar-cluster mode-switch">
          {MODE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`mode-btn${mode === key ? ' is-on' : ''}`}
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {t(`workbench.mode.${key}`)}
            </button>
          ))}
          {syncState !== 'idle' && (
            <span
              className={`mode-sync-dot is-${syncState}`}
              data-sync={syncState}
              title={t(syncState === 'synced' ? 'ux.mode.synced' : 'ux.mode.diverged')}
              aria-label={t(syncState === 'synced' ? 'ux.mode.synced' : 'ux.mode.diverged')}
            />
          )}
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Zone 3a — data. */}
        <div className="topbar-cluster">
          <button
            type="button"
            className="cluster-btn"
            title={t('workbench.files.title')}
            onClick={openDialog('files')}
          >
            {t('workbench.files.data')}
            {projectFileCount > 0 && <span className="cluster-badge">{projectFileCount}</span>}
          </button>
          <button type="button" className="cluster-btn" data-tour="examples" onClick={openDialog('data')}>
            {t('workbench.example.title')}
          </button>
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Zone 3b — project file operations: 保存/分享直达（管理操作已并入
            左侧项目名下拉，避免功能重叠）。 */}
        <div className="topbar-cluster">
          <button type="button" className="cluster-btn" onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button type="button" className="cluster-btn" onClick={openDialog('share')}>
            {t('workbench.share')}
          </button>
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Zone 3c — research tools: general analysis stays a direct button,
            all other tools live behind the searchable/recency launcher. */}
        <div className="topbar-cluster">
          <button
            type="button"
            className="cluster-btn"
            onClick={() => openToolEmbedded(navigate, 'analysis', location.pathname)}
          >
            {t('workbench.analyze')}
          </button>
          <ResearchLauncher />
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Zone 4 — global tools. Low-frequency entries (shortcuts, tour) and
            the perf gauge live in the ⋯ overflow menu; the gauge surfaces here
            only while a perf warning is active. Palette + AI stay direct. */}
        <div className="topbar-cluster cluster-icons">
          <button
            type="button"
            className="cluster-btn icon-only topbar-hide-narrow"
            title={t('ux.palette.open')}
            aria-label={t('ux.palette.open')}
            onClick={() => useCommandPaletteStore.getState().toggle()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 9l3 3-3 3" />
              <path d="M13 15h4" />
            </svg>
          </button>
          <button
            type="button"
            className={`cluster-btn icon-only${aiOpen ? ' is-active' : ''}`}
            title={t('ai.toggle')}
            aria-label={t('ai.toggle')}
            aria-pressed={aiOpen}
            data-tour="ai-assistant"
            onClick={toggleAi}
          >
            <SparklesIcon size={15} />
          </button>
          {perfWarn && (
            <button
              type="button"
              className="cluster-btn icon-only perf-entry topbar-hide-narrow perf-warn"
              title={perfTitle}
              aria-label={perfTitle}
              onClick={openDialog('perf')}
            >
              <GaugeIcon size={15} />
              <span className="perf-indicator-dot" aria-hidden="true" />
            </button>
          )}
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

        <Dropdown
          ariaLabel={t('workbench.menu.more')}
          triggerClassName="cluster-btn icon-only topbar-overflow"
          align="right"
          trigger={<MoreIcon size={16} />}
          items={[
            { key: 'palette', label: t('ux.palette.open'), onClick: () => useCommandPaletteStore.getState().toggle() },
            { key: 'shortcuts', label: t('ux.shortcuts.title'), onClick: () => useShortcutsStore.getState().toggle() },
            { key: 'ai', label: t('ai.toggle'), onClick: () => toggleAi() },
            { key: 'settings', label: t('workbench.tools.settings'), onClick: () => navigate('/settings') },
            { key: 'tour', label: t('workbench.tour.title'), onClick: startTour },
            { key: 'perf', label: perfTitle, onClick: openDialog('perf') },
          ]}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".clproj,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleOpenFile(file);
            e.target.value = '';
          }}
        />

        {/* 文件夹项目导入：webkitdirectory 选择整个文件夹，交给
            projectStore.importFolder（含 project.clproj 时按原生项目导入）。
            React JSX 不会把 webkitdirectory 可靠地写到 DOM 上，必须在 ref
            回调里用 setAttribute 显式设置。 */}
        <input
          ref={(el) => {
            folderInputRef.current = el;
            if (el) {
              el.setAttribute('webkitdirectory', '');
              el.setAttribute('directory', '');
            }
          }}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            if (files.length > 0) {
              void importFolder(files).catch(() => notify('error', t('project.open_failed')));
            }
            e.target.value = '';
          }}
        />
      </div>

      <TopBarDialogs dialog={dialog} onClose={closeDialog} />
    </header>
  );
}
