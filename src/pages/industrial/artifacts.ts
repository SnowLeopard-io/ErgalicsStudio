// ==========================================================================
// Ergalics Studio — industrial artifact helpers
//
// Every industrial page exports through this hook so downloads and workspace
// writes behave the same way everywhere: results/ for data, figures/ for
// charts, and the file explorer is notified after each write.
// ==========================================================================

import { useCallback } from 'react';
import { useT } from '@/i18n';
import { logger } from '@/core/logger';
import { downloadText } from '@/core/plot/export';
import { saveBinaryArtifact, saveTextArtifact } from '@/core/workspace-artifacts';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import type { EngineeringStudy } from '@/core/engineering/types';

/** Filesystem-safe stem for exported artifacts. */
export function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'engineering';
}

/** `<project>-<study>` slug used for filenames. */
export function artifactBaseName(study: EngineeringStudy | null | undefined): string {
  const project = useProjectStore.getState().project?.name;
  const base = project && study ? `${project}-${study.name}` : (project ?? study?.name ?? 'engineering');
  return safeName(base);
}

export function useIndustrialArtifacts() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);

  const ensureProject = useCallback(() => {
    const project = useProjectStore.getState().project;
    if (!project) notify('error', t('industrial.no_project'));
    return project;
  }, [notify, t]);

  const saveText = useCallback(
    async (dir: 'results' | 'figures' | 'study', filename: string, content: string) => {
      const project = ensureProject();
      if (!project) return null;
      try {
        const path = await saveTextArtifact(project, dir, filename, content);
        notify('success', t('industrial.saved_artifact', { path }));
        return path;
      } catch (err) {
        logger.warn('engineering', 'artifact write failed', err);
        notify('error', t('industrial.save_failed'));
        return null;
      }
    },
    [ensureProject, notify, t],
  );

  const saveBinary = useCallback(
    async (dir: 'results' | 'figures' | 'study', filename: string, bytes: Uint8Array) => {
      const project = ensureProject();
      if (!project) return null;
      try {
        const path = await saveBinaryArtifact(project, dir, filename, bytes);
        notify('success', t('industrial.saved_artifact', { path }));
        return path;
      } catch (err) {
        logger.warn('engineering', 'artifact write failed', err);
        notify('error', t('industrial.save_failed'));
        return null;
      }
    },
    [ensureProject, notify, t],
  );

  return { saveText, saveBinary, notify };
}

/** Download a text artifact with the standard industrial filename. */
export function downloadIndustrialText(
  content: string,
  filename: string,
  mime: string,
): void {
  downloadText(content, filename, mime);
}
