import { useT } from '@/i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
  | 'rename'
  | 'clone'
  | 'project_delete';

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
  const removeProject = useProjectStore((s) => s.remove);
  const notify = useAppStore((s) => s.notify);

  /** One-click clone (US-04): the store creates a fresh project from the
   *  URL and opens it. Errors mirror the GitPanel's reporting — short code
   *  plus the CORS hint for network-level failures. */
  const cloneFromUrl = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      await useProjectStore.getState().gitClone(trimmed);
      notify('success', t('git.cloned'));
      onClose();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const raw = err instanceof Error ? err.message : String(err);
      let reason = code && !raw.startsWith(code) ? `${code}: ${raw}` : raw;
      if (/failed to fetch|networkerror|cors|err_failed|proxy/i.test(reason)) {
        reason += ` — ${t('git.cors_hint')}`;
      }
      notify('error', t('git.op_failed', { reason }));
    }
  };

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
        open={dialog === 'clone'}
        title={t('project.clone')}
        message={t('project.clone_prompt')}
        initial="https://"
        onClose={onClose}
        onConfirm={cloneFromUrl}
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
      <ConfirmDialog
        open={dialog === 'project_delete'}
        title={t('common.delete')}
        message={t('project.remove_confirm')}
        name={project?.name || undefined}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (project) void removeProject(project.id);
          onClose();
        }}
        onClose={onClose}
      />
      <DataDialog open={dialog === 'data'} onClose={onClose} />
      <ProjectFilesDialog open={dialog === 'files'} onClose={onClose} />
      <PerfDialog open={dialog === 'perf'} onClose={onClose} />
    </>
  );
}
