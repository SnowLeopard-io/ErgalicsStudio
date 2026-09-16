import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { ShareDialog } from './dialogs/ShareDialog';
import { AnalysisDialog } from './dialogs/AnalysisDialog';
import { NamePromptDialog } from './dialogs/NamePromptDialog';
import { RunHistoryDialog } from './dialogs/RunHistoryDialog';
import { UncertaintyDialog } from './dialogs/UncertaintyDialog';
import { ModelLabDialog } from './dialogs/ModelLabDialog';
import { ProfilerDialog } from './dialogs/ProfilerDialog';
import { ReproLockDialog } from './dialogs/ReproLockDialog';
import { LineageDialog } from './dialogs/LineageDialog';
import { SupplementDialog } from './dialogs/SupplementDialog';
import { DataDialog } from './DataDialog';
import { ProjectFilesDialog } from './ProjectFilesDialog';
import { PerfDialog } from './PerfDialog';

/** Every dialog the TopBar can open. Only one is ever open at a time, so the
 *  previous eleven individual booleans collapse into this single key. */
export type TopBarDialogKey =
  | 'share'
  | 'analysis'
  | 'runs'
  | 'uncertainty'
  | 'model-lab'
  | 'profiler'
  | 'reprolock'
  | 'lineage'
  | 'supplement'
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
      <AnalysisDialog open={dialog === 'analysis'} onClose={onClose} />
      <RunHistoryDialog open={dialog === 'runs'} onClose={onClose} />
      <UncertaintyDialog open={dialog === 'uncertainty'} onClose={onClose} />
      <ModelLabDialog open={dialog === 'model-lab'} onClose={onClose} />
      <ProfilerDialog open={dialog === 'profiler'} onClose={onClose} />
      <ReproLockDialog open={dialog === 'reprolock'} onClose={onClose} />
      <LineageDialog open={dialog === 'lineage'} onClose={onClose} />
      <SupplementDialog open={dialog === 'supplement'} onClose={onClose} />
      <DataDialog open={dialog === 'data'} onClose={onClose} />
      <ProjectFilesDialog open={dialog === 'files'} onClose={onClose} />
      <PerfDialog open={dialog === 'perf'} onClose={onClose} />
    </>
  );
}
