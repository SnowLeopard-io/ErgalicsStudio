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
import { TopBarDialogs, type TopBarDialogKey } from './TopBarDialogs';

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
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const perfFps = useAppStore((s) => s.perf.fps);
  const perfWarnFps = useAppStore((s) => s.perf.warnings.fps);
  const startTour = useTourStore((s) => s.start);

  // Single dialog key: only one TopBar dialog can be open at a time, so the
  // previous eleven booleans collapse into this one piece of state (rendered
  // by <TopBarDialogs /> at the bottom of this file).
  const [dialog, setDialog] = useState<TopBarDialogKey | null>(null);
  const openDialog = (key: TopBarDialogKey) => () => setDialog(key);
  const closeDialog = () => setDialog(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileCount = project?.data.files.length ?? 0;

  const location = useLocation();
  // Welcome page mode cards land here with
  // { state: { openResearchDialog: 'runs' | … } } — kept for legacy links:
  // lab tools are standalone pages now, so dialog-backed modes route instead.
  useEffect(() => {
    const state = location.state as { openResearchDialog?: string } | null;
    if (state?.openResearchDialog) {
      navigate(`/${state.openResearchDialog}`);
      window.history.replaceState({}, '');
    }
  }, [location.state, navigate]);

  const handleOpenFile = (file: File) => {
    void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
  };

  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Menu" onClick={toggleSidebar}>
        ☰
      </button>

      <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
        <span className="brand-name">Ergalics Studio</span>
      </a>

      <button type="button" className="project-name" title={t('project.name')} onClick={openDialog('rename')}>
        {project?.name || DEFAULT_PROJECT_NAME}
        {dirty && <span className="project-dirty">•</span>}
      </button>

      <div className="topbar-actions">
        <div className="topbar-cluster mode-switch">
          {(
            [
              { key: 'standard', disabled: false },
              { key: 'flow', disabled: false },
              { key: 'block', disabled: false },
              { key: 'code', disabled: false },
            ] as const
          ).map(({ key, disabled }) => (
            <button
              key={key}
              type="button"
              className={`cluster-btn${mode === key ? ' btn-toggle-on' : ''}`}
              disabled={disabled}
              title={disabled ? t('editor.mode.disabled') : undefined}
              onClick={() => setMode(key)}
            >
              {t(`workbench.mode.${key}`)}
            </button>
          ))}
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        {/* Data: project files first (high-frequency), bundled samples second. */}
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

        {/* Project file operations: menu + quick save/share. */}
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

        {/* Research & analysis toolset — each tool is a standalone page. */}
        <div className="topbar-cluster">
          <button type="button" className="cluster-btn" onClick={() => navigate('/analysis')}>
            {t('workbench.analyze')}
          </button>
          <Dropdown
            trigger={
              <span>
                {t('research.menu')}
                <span className="more-caret">▾</span>
              </span>
            }
            triggerClassName="cluster-btn"
            ariaLabel={t('research.menu')}
            align="left"
            items={[
              { key: 'runs', label: t('research.runs.title'), onClick: () => navigate('/runs') },
              { key: 'uncertainty', label: t('uncertainty.title'), onClick: () => navigate('/uncertainty') },
              { key: 'model-lab', label: t('model.title'), onClick: () => navigate('/model-lab') },
              { key: 'profiler', label: t('profile.title'), onClick: () => navigate('/profiler') },
              { key: 'reprolock', label: t('reprolock.title'), onClick: () => navigate('/reprolock') },
              { key: 'signal', label: t('signal.title'), onClick: () => navigate('/signal') },
              { key: 'sweeps', label: t('sweep.title'), onClick: () => navigate('/sweeps') },
              { key: 'report', label: t('report.title'), onClick: () => navigate('/report') },
              { key: 'sql', label: t('sql.title'), onClick: () => navigate('/sql') },
              { key: 'lineage', label: t('lineage.title'), onClick: () => navigate('/lineage') },
              { key: 'figures', label: t('figure.title'), onClick: () => navigate('/figures') },
              { key: 'notebook', label: t('notebook.title'), onClick: () => navigate('/notebook') },
              { key: 'supplement', label: t('supplement.title'), onClick: () => navigate('/supplement') },
            ]}
          />
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        <div className="topbar-cluster cluster-icons">
          <button
            type="button"
            className="cluster-btn"
            title={t('workbench.tools.settings')}
            aria-label={t('workbench.tools.settings')}
            onClick={() => navigate('/settings')}
          >
            ⚙
          </button>
          <button
            type="button"
            className="cluster-btn"
            title={t('workbench.tour.title')}
            aria-label={t('workbench.tour.title')}
            onClick={startTour}
          >
            ?
          </button>
          <button
            type="button"
            className={`cluster-btn perf-entry${perfWarnFps && perfFps > 0 ? ' perf-warn' : ''}`}
            title={t('workbench.perf.title')}
            onClick={openDialog('perf')}
          >
            <span className="perf-dot" aria-hidden="true" />
            {perfFps > 0 ? `${perfFps} FPS` : '—'}
          </button>
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

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
