import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { ShareDialog } from './dialogs/ShareDialog';
import { NamePromptDialog } from './dialogs/NamePromptDialog';
import { DataDialog } from './DataDialog';
import { ProjectFilesDialog } from './ProjectFilesDialog';
import { PerfDialog } from './PerfDialog';

/** Every dialog the TopBar can open. Only one is ever open at a time, so the
 *  individual booleans collapse into this single key. Research/lab tools are
 *  standalone pages now (see pages/labs) — these are the project & data
 *  operations that stay modal. */
export type TopBarDialogKey =
  | 'share'
  | 'data'
  | 'files'
  | 'perf'
  | 'new'
  | 'rename';

interface TopBarDialogsProps {
  dialog: TopBarDialogKey | null;
  onClose: () => void;
}

/** All modal dialogs owned by the TopBar, rendered from one discriminated key. */
export function TopBarDialogs({ dialog, onClose }: TopBarDialogsProps) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const rename = useProjectStore((s) => s.rename);
  const createProject = useProjectStore((s) => s.createProject);

  return (
    <>
      <NamePromptDialog
        open={dialog === 'new'}
        title={t('project.new')}
        message={t('project.prompt_name')}
        initial=""
        onClose={onClose}
        onConfirm={async (name) => {
          await createProject(name);
          onClose();
        }}
      />
      <NamePromptDialog
        open={dialog === 'rename'}
        title={t('project.name')}
        message={t('project.name')}
        initial={project?.name ?? ''}
        onClose={onClose}
        onConfirm={(name) => {
          if (name) rename(name);
          onClose();
        }}
      />
      <ShareDialog open={dialog === 'share'} onClose={onClose} />
      <DataDialog open={dialog === 'data'} onClose={onClose} />
      <ProjectFilesDialog open={dialog === 'files'} onClose={onClose} />
      <PerfDialog open={dialog === 'perf'} onClose={onClose} />
    </>
  );
}
