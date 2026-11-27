// ==========================================================================
// Ergalics Studio — industrial artifact helpers
//
// Every industrial page exports through this hook so downloads and workspace
// writes behave the same way everywhere: results/ for data, figures/ for
// charts, and the file explorer is notified after each write.
// ==========================================================================

import { useCallback } from 'react';
import { useT } from '@/i18n';
import { logger } from '@ergalics/plugin-sdk';
import {
  buildPDF,
  downloadText,
  exportPDF,
  exportPNG,
  exportSVG,
  rasterizePNG,
} from '@ergalics/plugin-sdk/plot';
import { saveBinaryArtifact, saveTextArtifact } from '@/core/workspace-artifacts';
import type { PdfTextBlock } from '@/core/publish/pdf';
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

/** Strip inline Markdown emphasis so PDF text stays plain. */
function plain(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Markdown → PDF text blocks. Matches the manuscript PDF pipeline's table
 * convention (cells joined with "  |  ") so both exports read the same.
 */
export function markdownToPdfBlocks(markdown: string): PdfTextBlock[] {
  const blocks: PdfTextBlock[] = [];
  let tableRows: string[][] | null = null;
  const flushTable = () => {
    if (tableRows && tableRows.length > 0) blocks.push({ kind: 'table', text: '', rows: tableRows });
    tableRows = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushTable();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: plain(heading[2]!) });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) continue;
    // Table alignment row: | --- | :---: |
    if (/^\|?[\s:|-]+\|?$/.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => plain(cell));
      (tableRows ??= []).push(cells);
      continue;
    }
    flushTable();
    if (/^[-*]\s+/.test(line)) {
      blocks.push({ kind: 'bullet', text: plain(line.replace(/^[-*]\s+/, '')) });
      continue;
    }
    blocks.push({ kind: 'text', text: plain(line.replace(/^>\s?/, '')) });
  }
  flushTable();
  return blocks;
}

/** Render an industrial report (its Markdown source) into A4 PDF bytes. The
 *  document pipeline is imported on demand: it pulls jsPDF + KaTeX, which must
 *  stay out of the industrial bundle until the user actually exports a PDF. */
export async function buildReportPdf(title: string, markdown: string): Promise<Uint8Array> {
  const { buildTextPdf } = await import('@/core/publish/pdf');
  const blocks = markdownToPdfBlocks(markdown);
  // buildTextPdf prints the title itself; drop the Markdown H1 when it would
  // only repeat it (as in "Bracket plate (DXF) — 工程报告" twice).
  const first = blocks[0];
  if (first && first.kind === 'heading' && (first.level ?? 1) === 1 && first.text === plain(title)) {
    blocks.shift();
  }
  return buildTextPdf(title, blocks);
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
 * Export routing shared by the industrial pages. Pages call these with an
 * explicit target: 'download' writes through the browser, 'save' writes into
 * the project workspace (results/ · figures/ · study/) and notifies the file
 * explorer. When no target is passed the legacy panel toggle decides.
 */
export type ExportTarget = 'download' | 'save';

export function useIndustrialOutput() {
  const t = useT();
  const { saveText, saveBinary, notify } = useIndustrialArtifacts();
  const toWorkspace = useIndustrialChrome((s) => s.outputToWorkspace);

  const outputText = useCallback(
    async (dir: 'results' | 'figures' | 'study', filename: string, content: string, target: ExportTarget = toWorkspace ? 'save' : 'download') => {
      if (target === 'download') {
        downloadText(content, filename, mimeFor(filename));
        return null;
      }
      return saveText(dir, filename, content);
    },
    [saveText, toWorkspace],
  );

  const outputFigure = useCallback(
    async (filename: string, svg: string, target: ExportTarget = toWorkspace ? 'save' : 'download') => {
      if (target === 'download') {
        exportSVG(svg, filename);
        return null;
      }
      return saveText('figures', filename, svg);
    },
    [saveText, toWorkspace],
  );

  const outputPng = useCallback(
    async (filename: string, svg: string, target: ExportTarget = toWorkspace ? 'save' : 'download') => {
      if (target === 'download') {
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
    async (filename: string, svg: string, target: ExportTarget = toWorkspace ? 'save' : 'download') => {
      if (target === 'download') {
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
