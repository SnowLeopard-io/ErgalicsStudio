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
import { MenuIcon, PanelIcon, SettingsIcon, HelpIcon, GaugeIcon, MoreIcon, SparklesIcon } from '@/components/icons';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { TopBarDialogs, type TopBarDialogKey } from './TopBarDialogs';

const MODE_KEYS = ['standard', 'flow', 'block', 'code'] as const;

export function TopBar() {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const save = useProjectStore((s) => s.save);
  const saveAs = useProjectStore((s) => s.saveAs);
  const openFromFile = useProjectStore((s) => s.openFromFile);
  const notify = useAppStore((s) => s.notify);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleModePanel = useAppStore((s) => s.toggleModePanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const modePanelOpen = useAppStore((s) => s.modePanelOpen);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const perfFps = useAppStore((s) => s.perf.fps);
  const perfWarnFps = useAppStore((s) => s.perf.warnings.fps);
  const startTour = useTourStore((s) => s.start);
  const aiOpen = useAiPanelStore((s) => s.open);
  const toggleAi = useAiPanelStore((s) => s.toggle);

  // Single dialog key: only one TopBar dialog can be open at a time, so the
  // previous eleven booleans collapse into this one piece of state (rendered
  // by <TopBarDialogs /> at the bottom of this file).
  const [dialog, setDialog] = useState<TopBarDialogKey | null>(null);
  const openDialog = (key: TopBarDialogKey) => () => setDialog(key);
  const closeDialog = () => setDialog(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileCount = project?.data.files.length ?? 0;

  const location = useLocation();
  // Welcome-page entry states: legacy openResearchDialog routes to a tool
  // page; openDataDialog opens the bundled-samples dialog directly.
  useEffect(() => {
    const state = location.state as
      | { openResearchDialog?: string; openDataDialog?: boolean }
      | null;
    let consumed = false;
    if (state?.openResearchDialog) {
      navigate(`/studio/${state.openResearchDialog}`);
      consumed = true;
    }
    if (state?.openDataDialog) {
      setDialog('data');
      consumed = true;
    }
    if (consumed) window.history.replaceState({}, '');
  }, [location.state, navigate]);

  const handleOpenFile = (file: File) => {
    void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
  };

  const perfTitle = `${t('workbench.perf.title')}${perfFps > 0 ? ` · ${perfFps} FPS` : ''}`;
  const perfWarn = perfWarnFps && perfFps > 0;

  return (
    <header className="topbar">
      {/* Zone 1 — navigation: ☰ (project/plugin sidebar in Standard, mode
          panel elsewhere), brand, current project name. */}
      <button
        type="button"
        className={`icon-btn${((mode === 'standard' && sidebarOpen) || (mode !== 'standard' && modePanelOpen)) ? ' is-active' : ''}`}
        aria-label={mode === 'standard' ? t('workbench.menu.toggle_sidebar') : t('workbench.menu.toggle_panel')}
        aria-pressed={mode === 'standard' ? sidebarOpen : modePanelOpen}
        title={mode === 'standard' ? t('workbench.menu.toggle_sidebar') : t('workbench.menu.toggle_panel')}
        onClick={mode === 'standard' ? toggleSidebar : toggleModePanel}
      >
        <MenuIcon size={17} />
      </button>

      <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
        <span className="brand-name">Ergalics Studio</span>
      </a>

      <button type="button" className="project-name" title={t('project.rename')} onClick={openDialog('rename')}>
        {project?.name || DEFAULT_PROJECT_NAME}
        {dirty && <span className="project-dirty">•</span>}
      </button>

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

        {/* Zone 3b — project file operations: menu (rename merged in) + save/share. */}
        <div className="topbar-cluster">
          <Dropdown
            ariaLabel={t('workbench.menu.project')}
            triggerClassName="cluster-btn"
            align="left"
            trigger={
              <span>
                {t('workbench.menu.project')}
                <span className="more-caret">▾</span>
              </span>
            }
            items={[
              { key: 'new', label: t('project.new'), onClick: openDialog('new') },
              {
                key: 'open',
                label: t('project.open'),
                onClick: () => fileInputRef.current?.click(),
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
            ]}
          />
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
          <button type="button" className="cluster-btn" onClick={() => navigate('/studio/analysis')}>
            {t('workbench.analyze')}
          </button>
          <ResearchLauncher />
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Zone 4 — global tools. The icon trio collapses into the ⋯ overflow
            menu on narrow screens (see topbar-resp CSS). */}
        <div className="topbar-cluster cluster-icons">
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
          {mode === 'standard' && (
            <button
              type="button"
              className={`cluster-btn icon-only${rightPanelOpen ? ' is-active' : ''}`}
              title={t('workbench.menu.toggle_right')}
              aria-label={t('workbench.menu.toggle_right')}
              aria-pressed={rightPanelOpen}
              onClick={toggleRightPanel}
            >
              <PanelIcon size={15} />
            </button>
          )}
          <button
            type="button"
            className="cluster-btn icon-only topbar-hide-narrow"
            title={t('workbench.tools.settings')}
            aria-label={t('workbench.tools.settings')}
            onClick={() => navigate('/settings')}
          >
            <SettingsIcon size={15} />
          </button>
          <button
            type="button"
            className="cluster-btn icon-only topbar-hide-narrow"
            title={t('workbench.tour.title')}
            aria-label={t('workbench.tour.title')}
            onClick={startTour}
          >
            <HelpIcon size={15} />
          </button>
          <button
            type="button"
            className={`cluster-btn icon-only perf-entry topbar-hide-narrow${perfWarn ? ' perf-warn' : ''}`}
            title={perfTitle}
            aria-label={perfTitle}
            onClick={openDialog('perf')}
          >
            <GaugeIcon size={15} />
            <span className="perf-indicator-dot" aria-hidden="true" />
          </button>
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

        <Dropdown
          ariaLabel={t('workbench.menu.more')}
          triggerClassName="cluster-btn icon-only topbar-overflow"
          align="right"
          trigger={<MoreIcon size={16} />}
          items={[
            { key: 'ai', label: t('ai.toggle'), onClick: () => toggleAi() },
            ...(mode === 'standard'
              ? [{ key: 'right', label: t('workbench.menu.toggle_right'), onClick: toggleRightPanel }]
              : []),
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
      </div>

      <TopBarDialogs dialog={dialog} onClose={closeDialog} />
    </header>
  );
}
