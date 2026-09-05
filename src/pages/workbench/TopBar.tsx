import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { DEFAULT_PROJECT_NAME } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Dropdown } from '@/components/Dropdown';
import { ShareDialog } from './dialogs/ShareDialog';
import { AnalysisDialog } from './dialogs/AnalysisDialog';
import { NamePromptDialog } from './dialogs/NamePromptDialog';
import { DataDialog } from './DataDialog';
import { ProjectFilesDialog } from './ProjectFilesDialog';
import { PerfDialog } from './PerfDialog';

export function TopBar() {
  const t = useT();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const save = useProjectStore((s) => s.save);
  const saveAs = useProjectStore((s) => s.saveAs);
  const rename = useProjectStore((s) => s.rename);
  const createProject = useProjectStore((s) => s.createProject);
  const openFromFile = useProjectStore((s) => s.openFromFile);
  const notify = useAppStore((s) => s.notify);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const perfFps = useAppStore((s) => s.perf.fps);
  const perfWarnFps = useAppStore((s) => s.perf.warnings.fps);

  const [shareOpen, setShareOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileCount = project?.data.files.length ?? 0;

  const handleOpenFile = (file: File) => {
    void openFromFile(file).catch(() => notify('error', t('project.open_failed')));
  };

  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Menu" onClick={toggleSidebar}>
        ☰
      </button>

      <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
        <span className="brand-logo">◈</span>
        <span className="brand-name">Ergalics Studio</span>
      </a>

      <button type="button" className="project-name" title={t('project.name')} onClick={() => setRenameOpen(true)}>
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

        <div className="topbar-cluster">
          <button type="button" className="cluster-btn" onClick={() => setExampleOpen(true)}>
            {t('workbench.example.title')}
          </button>
          <button
            type="button"
            className="cluster-btn"
            title={t('workbench.files.title')}
            onClick={() => setFilesOpen(true)}
          >
            {t('workbench.files.data')}
            {projectFileCount > 0 && <span className="cluster-badge">{projectFileCount}</span>}
          </button>
          <button type="button" className="cluster-btn" onClick={() => navigate('/settings')}>
            {t('workbench.tools.settings')}
          </button>
          <button type="button" className="cluster-btn" onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button type="button" className="cluster-btn" onClick={() => setShareOpen(true)}>
            {t('workbench.share')}
          </button>
          <button type="button" className="cluster-btn" onClick={() => setAnalysisOpen(true)}>
            {t('workbench.analyze')}
          </button>
        </div>

        <div className="topbar-cluster cluster-icons">
          <button
            type="button"
            className={`cluster-btn perf-entry${perfWarnFps && perfFps > 0 ? ' perf-warn' : ''}`}
            title={t('workbench.perf.title')}
            onClick={() => setPerfOpen(true)}
          >
            <span className="perf-dot" aria-hidden="true" />
            {perfFps > 0 ? `${perfFps} FPS` : '—'}
          </button>
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

        <Dropdown
          ariaLabel={t('common.more')}
          triggerClassName="btn cluster-btn"
          trigger={
            <span>
              {t('common.more')}
              <span className="more-caret">▾</span>
            </span>
          }
          items={[
            { key: 'new', label: t('project.new'), onClick: () => setNewOpen(true) },
            {
              key: 'open',
              label: t('project.open'),
              onClick: () => fileInputRef.current?.click(),
            },
            { key: 'save_as', label: t('project.save_as'), onClick: () => saveAs() },
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

      <NamePromptDialog
        open={newOpen}
        title={t('project.new')}
        message={t('project.prompt_name')}
        initial=""
        onClose={() => setNewOpen(false)}
        onConfirm={async (name) => {
          await createProject(name);
          setNewOpen(false);
        }}
      />
      <NamePromptDialog
        open={renameOpen}
        title={t('project.name')}
        message={t('project.name')}
        initial={project?.name ?? ''}
        onClose={() => setRenameOpen(false)}
        onConfirm={(name) => {
          if (name) rename(name);
          setRenameOpen(false);
        }}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <AnalysisDialog open={analysisOpen} onClose={() => setAnalysisOpen(false)} />
      <DataDialog open={exampleOpen} onClose={() => setExampleOpen(false)} />
      <ProjectFilesDialog open={filesOpen} onClose={() => setFilesOpen(false)} />
      <PerfDialog open={perfOpen} onClose={() => setPerfOpen(false)} />
    </header>
  );
}