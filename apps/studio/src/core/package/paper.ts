// ==========================================================================
// Figure Studio — publication-ready paper package (FR-8)
//
// Stable file names, one provenance record, an optional standalone script,
// and an actionable checklist. A collaborator unzips it and has everything
// needed to re-run and verify the figure without opening the app.
// ==========================================================================

import { strToU8, zipSync } from 'fflate';
import { composeFigure, type FigureSpec } from '@/core/figure/compose';
import { buildPDF, rasterizePNG } from '@ergalics/plugin-sdk/plot';
import { buildVectorPDF } from '@/core/pdf/vector';
import { downloadBlob } from '@/core/download';
import { buildReproductionScript } from '@/core/result/reproduceScript';
import { hashBinaryArtifact, hashTextArtifact } from '@/core/result/sidecar';
import type { ResultRecord } from '@/core/result/types';
import {
  checklistToJson,
  checklistToMarkdown,
  type ChecklistTranslator,
} from '@/core/submit/export';
import type { SubmissionCheckResult } from '@/core/submit/checklist';

export interface PaperPackageOptions {
  figure: FigureSpec;
  record: ResultRecord;
  caption: string;
  dpi?: number;
  pdfMode?: 'raster' | 'vector';
  check?: SubmissionCheckResult;
  sourceResultIds?: string[];
  includeScript?: boolean;
  t?: ChecklistTranslator;
}

export interface PaperPackageFiles {
  [path: string]: Uint8Array;
}

function utf8(text: string): Uint8Array {
  return strToU8(text);
}

export async function buildPaperPackage(opts: PaperPackageOptions): Promise<PaperPackageFiles> {
  const dpi = opts.dpi ?? 600;
  const composed = composeFigure(opts.figure);
  const cols = Math.max(...opts.figure.panels.map((p) => p.col + 1), 1);
  const widthMm = Math.min(277, 180 * cols);
  const pdfBytes =
    opts.pdfMode === 'vector'
      ? await buildVectorPDF(composed.markup, widthMm, (composed.height / composed.width) * widthMm)
      : await buildPDF(composed.markup, widthMm, dpi);
  const pngBytes = await rasterizePNG(composed.markup, dpi / 96);

  const provenance = {
    schema: 'ergalics.provenance/1',
    resultId: opts.record.resultId,
    pluginId: opts.record.pluginId,
    pluginVersion: opts.record.pluginVersion,
    dataHash: opts.record.input.dataHash,
    params: opts.record.params,
    metrics: opts.record.metrics,
    environment: opts.record.environment,
    ...(opts.record.seed !== undefined ? { seed: opts.record.seed } : {}),
    sourceResultIds: opts.sourceResultIds ?? [],
    artifactHashes: {
      'figure.svg': hashTextArtifact(composed.markup),
      'figure.pdf': hashBinaryArtifact(pdfBytes),
      'figure.png': hashBinaryArtifact(pngBytes),
    },
  };

  const files: PaperPackageFiles = {
    'figure.svg': utf8(composed.markup),
    'figure.pdf': pdfBytes,
    'figure.png': pngBytes,
    'caption.txt': utf8(`${opts.caption}\n`),
    'provenance.json': utf8(`${JSON.stringify(provenance, null, 2)}\n`),
  };
  if (opts.includeScript !== false) {
    files['reproduce.py'] = utf8(buildReproductionScript(opts.record));
  }
  const check = opts.check;
  files['checklist.md'] = utf8(
    check
      ? checklistToMarkdown(check, opts.t)
      : '# Submission checklist\n\nNo submission target was selected.\n',
  );
  if (check) files['checklist.json'] = utf8(checklistToJson(check, opts.t));
  return files;
}

export function zipPaperPackage(files: PaperPackageFiles): Uint8Array {
  return zipSync(files, { level: 6 });
}

export async function downloadPaperPackage(
  name: string,
  opts: PaperPackageOptions,
): Promise<Uint8Array> {
  const bytes = zipPaperPackage(await buildPaperPackage(opts));
  await downloadBlob(`${name || 'figure'}-paper.zip`, bytes, 'application/zip');
  return bytes;
}
