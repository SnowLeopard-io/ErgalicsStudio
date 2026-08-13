import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Dropdown } from '@/components/Dropdown';
import { ShareDialog } from './dialogs/ShareDialog';
import { NamePromptDialog } from './dialogs/NamePromptDialog';

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

  const [shareOpen, setShareOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        {project?.name ?? t('project.untitled')}
        {dirty && <span className="project-dirty">•</span>}
      </button>

      <div className="topbar-actions">
        <button type="button" className="btn btn-sm" onClick={() => void save()}>
          {t('common.save')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setShareOpen(true)}>
          {t('workbench.share')}
        </button>
        <LanguageSwitcher />
        <ThemeSwitcher />

        <Dropdown
          ariaLabel={t('project.save_as')}
          trigger={<span title={t('project.save_as')}>⋯</span>}
          items={[
            { key: 'new', label: t('project.new'), onClick: () => setNewOpen(true) },
            {
              key: 'open',
              label: t('project.open'),
              onClick: () => fileInputRef.current?.click(),
            },
            { key: 'save', label: t('project.save'), onClick: () => void save() },
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
          await createProject(name || t('project.untitled'));
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
    </header>
  );
}