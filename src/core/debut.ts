// ==========================================================================
// Ergalics Studio — the 30-second first-figure debut
//
// The strongest first-run promise of the product is not "163 plugins"; it is
// "turn data into a paper figure in half a minute". This module builds that
// promise as a real project: one deterministic spectrum dataset, one
// publication-style Figure Studio sheet composed from it (same plotting
// engine as the rest of the app), ready for the guided caption + export
// steps.
//
// Pure builder first (`buildDebutProject`) so it is testable without a store;
// `beginDebut` persists the project through the normal project pipeline.
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import { createEmptyProject, serializeProject, type FileEntry, type Project } from '@/types/project';
import { spectrumCsv } from '@/core/templates/data';
import { dataTableToLine } from '@/core/plot';
import { useProjectStore } from '@/stores/projectStore';

export const DEBUT_PROJECT_ID = 'debut:first-figure';
export const DEBUT_FIGURE_ID = 'debut-first-figure';
export const DEBUT_FILE_NAME = 'emission-spectrum.csv';

/** Stable FNV-1a hash — keeps the file id deterministic across loads. */
function stableHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h).toString(16);
}

/** Pull one numeric column out of the tiny CSV emitted by `spectrumCsv()`. */
function numericColumn(csv: string, name: string): Float64Array {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? '').split(',');
  const index = header.indexOf(name);
  const out: number[] = [];
  if (index < 0) return Float64Array.from(out);
  for (const line of lines.slice(1)) {
    const value = Number(line.split(',')[index]);
    if (Number.isFinite(value)) out.push(value);
  }
  return Float64Array.from(out);
}

/**
 * Build the debut project: the sample dataset plus a composed, single-column
 * publication figure. The caption is intentionally empty — the tour's second
 * beat is generating it, and a figure with a blank caption is exactly the
 * moment a researcher recognises from their own workflow.
 */
export function buildDebutProject(): Project {
  const csv = spectrumCsv();
  const project = createEmptyProject('First Figure · Emission Spectrum');
  project.id = DEBUT_PROJECT_ID;

  const file: FileEntry = {
    id: `debut-spectrum-${stableHash(csv)}`,
    name: DEBUT_FILE_NAME,
    size: csv.length,
    mimeType: 'text/csv',
    format: 'csv',
    content: csv,
  };
  project.data.files = [file];

  const table = createDataTable('debut-spectrum', [
    { name: 'wavelength_A', type: 'f64', data: numericColumn(csv, 'wavelength_A') },
    { name: 'flux', type: 'f64', data: numericColumn(csv, 'flux') },
  ]);
  const spec = dataTableToLine(table, 'wavelength_A', 'flux', {
    title: 'Emission-line spectrum',
    xLabel: 'Wavelength (Å)',
    yLabel: 'Flux (a.u.)',
    color: '#0072B2',
  });
  spec.series[0]!.name = 'Spectrum';

  const now = Date.now();
  project.state.figureSheets = [
    {
      id: DEBUT_FIGURE_ID,
      name: 'Figure 1 · Emission spectrum',
      templateId: 'ieee_single',
      caption: '',
      panels: [{ row: 0, col: 0, tag: 'a', spec }],
      createdAt: now,
      updatedAt: now,
    },
  ];

  return project;
}

export interface BeginDebutResult {
  ok: boolean;
  error?: string;
}

/** Load the debut project into the normal project/open pipeline. */
export async function beginDebut(): Promise<BeginDebutResult> {
  try {
    const project = buildDebutProject();
    await useProjectStore.getState().loadProjectFromText(serializeProject(project));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
