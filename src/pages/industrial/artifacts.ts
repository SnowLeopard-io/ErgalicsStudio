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
import {
  buildPDF,
  downloadText,
  exportPDF,
  exportPNG,
  exportSVG,
  rasterizePNG,
} from '@/core/plot/export';
import { saveBinaryArtifact, saveTextArtifact } from '@/core/workspace-artifacts';
import { useAppStore } from '@/stores/appStore';
import { useIndustrialChrome } from '@/stores/industrialChromeStore';
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

/** MIME type derived from the export filename (text artifacts only). */
function mimeFor(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'csv': return 'text/csv';
    case 'json': return 'application/json';
    case 'md': return 'text/markdown';
    case 'html': return 'text/html';
    case 'svg': return 'image/svg+xml';
    default: return 'text/plain';
  }
}

/**
 * Export routing shared by the industrial pages. The right panel exposes an
 * "output to workspace directory" toggle: when it is on, exports are written
 * into the project workspace (results/ · figures/ · study/) and the file
 * explorer is notified; when it is off the exporter falls back to the browser
 * download. This is the single output-destination control — pages no longer
 * carry their own duplicate "save to workspace" buttons.
 */
export function useIndustrialOutput() {
  const t = useT();
  const { saveText, saveBinary, notify } = useIndustrialArtifacts();
  const toWorkspace = useIndustrialChrome((s) => s.outputToWorkspace);

  const outputText = useCallback(
    async (dir: 'results' | 'figures' | 'study', filename: string, content: string) => {
      if (!toWorkspace) {
        downloadText(content, filename, mimeFor(filename));
        return null;
      }
      return saveText(dir, filename, content);
    },
    [saveText, toWorkspace],
  );

  const outputFigure = useCallback(
    async (filename: string, svg: string) => {
      if (!toWorkspace) {
        exportSVG(svg, filename);
        return null;
      }
      return saveText('figures', filename, svg);
    },
    [saveText, toWorkspace],
  );

  const outputPng = useCallback(
    async (filename: string, svg: string) => {
      if (!toWorkspace) {
        exportPNG(svg, filename);
        return null;
      }
      try {
        return await saveBinary('figures', filename, await rasterizePNG(svg));
      } catch (err) {
        logger.warn('engineering', 'artifact write failed', err);
        notify('error', t('industrial.save_failed'));
        return null;
      }
    },
    [notify, saveBinary, t, toWorkspace],
  );

  const outputPdf = useCallback(
    async (filename: string, svg: string) => {
      if (!toWorkspace) {
        await exportPDF(svg, filename);
        return null;
      }
      try {
        return await saveBinary('figures', filename, await buildPDF(svg));
      } catch (err) {
        logger.warn('engineering', 'artifact write failed', err);
        notify('error', t('industrial.save_failed'));
        return null;
      }
    },
    [notify, saveBinary, t, toWorkspace],
  );

  return { outputText, outputFigure, outputPng, outputPdf };
}
