// ==========================================================================
// Ergalics Studio — journal submission checklist (FR-03, core)
//
// Pure-TS pre-submission gate for Figure Studio: `runSubmissionCheck` walks
// the composed figure document (template, panels, caption, export settings)
// against a target profile (IEEE / Elsevier) and returns grouped pass/fail
// items. Each failed item carries an i18n message + fix key and the DOM id of
// the control that owns the problem, so the UI can offer "locate the issue".
// No DOM, no React — fully unit-testable in the Node vitest environment.
// ==========================================================================

import type { FigurePanel, FigureExportFormat } from '@/core/figure/compose';
import { templateById } from '@/core/figure/compose';

// --------------------------------------------------------------------------
// Target profiles
// --------------------------------------------------------------------------

export type SubmissionTargetId = 'ieee' | 'elsevier';

export type CheckGroup = 'image' | 'annotation' | 'text' | 'metadata';

export interface SubmissionTarget {
  id: SubmissionTargetId;
  /** Display name (publisher style, not UI copy — kept in core for tests). */
  name: string;
  /** Minimum effective export resolution in dpi (vector formats pass by rule). */
  minDpi: number;
  /** Recommended colour mode for the export pipeline. */
  colorMode: 'rgb' | 'cmyk';
  /** Whether fonts must be embedded/outlined in the submitted artwork. */
  fontEmbedRequired: boolean;
  /** Panel tag format the venue expects (lowercase letters). */
  tagPattern: RegExp;
  /** Minimum axis/label font size at final print size, in pt. */
  minFontSizePt: number;
  /** Export formats the venue accepts for final artwork. */
  acceptedFormats: FigureExportFormat[];
  /** Journal template id prefixes considered aligned with this venue. */
  templatePrefixes: string[];
}

export const SUBMISSION_TARGETS: Record<SubmissionTargetId, SubmissionTarget> = {
  ieee: {
    id: 'ieee',
    name: 'IEEE',
    minDpi: 600,
    colorMode: 'rgb',
    fontEmbedRequired: true,
    tagPattern: /^[a-z]+$/,
    minFontSizePt: 7,
    acceptedFormats: ['svg', 'pdf', 'png600'],
    templatePrefixes: ['ieee'],
  },
  elsevier: {
    id: 'elsevier',
    name: 'Elsevier',
    minDpi: 300,
    colorMode: 'cmyk',
    fontEmbedRequired: true,
    tagPattern: /^[a-z]$/,
    minFontSizePt: 7,
    acceptedFormats: ['pdf', 'png600'],
    templatePrefixes: ['elsevier'],
  },
};

// --------------------------------------------------------------------------
// Document model under check
// --------------------------------------------------------------------------

/** Export settings the user picked for the submission artefact. */
export interface SubmissionExportSettings {
  format: FigureExportFormat;
  /** Raster resolution (dpi) used when the format rasterizes. */
  rasterDpi: number;
  colorMode: 'rgb' | 'cmyk';
  /** Fonts embedded/outlined in vector output. */
  fontEmbedded: boolean;
}

/** The composed figure document as the submission gate sees it. */
export interface SubmissionDoc {
  templateId: string;
  caption: string;
  panels: FigurePanel[];
  export: SubmissionExportSettings;
}

// --------------------------------------------------------------------------
// Result model
// --------------------------------------------------------------------------

export interface CheckItem {
  id: string;
  group: CheckGroup;
  passed: boolean;
  /** i18n key for the check label (always shown). */
  labelKey: string;
  /** i18n key for the outcome sentence; supports `{param}` interpolation. */
  messageKey: string;
  /** i18n key for the fix guidance (meaningful only when failed). */
  fixKey: string;
  /** Interpolation params for message/fix. */
  params: Record<string, string | number>;
  /** DOM id of the control that owns the problem ("locate the issue"). */
  focusTarget: string;
}

export interface CheckGroupResult {
  group: CheckGroup;
  items: CheckItem[];
}

export interface SubmissionCheckResult {
  targetId: SubmissionTargetId;
  groups: CheckGroupResult[];
  /** Flat list in group order. */
  items: CheckItem[];
  total: number;
  failedCount: number;
  passed: boolean;
}

// --------------------------------------------------------------------------
// Helpers (exported for tests)
// --------------------------------------------------------------------------

/** Base axis/label font size in px at 96 dpi used by the plot renderer. */
const BASE_LABEL_PX = 11;

/** px @96dpi → pt (1 px = 0.75 pt). */
export function pxToPt(px: number): number {
  return px * 0.75;
}

/** Effective export resolution: vector formats are resolution-independent. */
export function effectiveDpi(settings: SubmissionExportSettings): number {
  return settings.format === 'png600' ? settings.rasterDpi : Infinity;
}

/** Spreadsheet-style lowercase panel tag (a..z, aa, ab, …), mirrors compose. */
export function autoPanelTag(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Resolve every panel tag the way `composeFigure` will (row-major order). */
export function resolvePanelTags(panels: FigurePanel[]): string[] {
  const sorted = [...panels].sort((a, b) => a.row - b.row || a.col - b.col);
  return sorted.map((p, i) => p.tag ?? autoPanelTag(i));
}

function item(
  target: SubmissionTarget,
  id: string,
  group: CheckGroup,
  passed: boolean,
  focusTarget: string,
  params: Record<string, string | number> = {},
): CheckItem {
  return {
    id,
    group,
    passed,
    labelKey: `submit.check.${id}.label`,
    messageKey: `submit.check.${id}.message`,
    fixKey: `submit.check.${id}.fix`,
    params: { target_name: target.name, ...params },
    focusTarget,
  };
}

// --------------------------------------------------------------------------
// The check
// --------------------------------------------------------------------------

/**
 * Run the full submission gate for `doc` against one target profile.
 * The result never blocks an export by itself — the UI decides whether to
 * ask for a second confirmation when `failedCount > 0`.
 */
export function runSubmissionCheck(
  doc: SubmissionDoc,
  targetId: SubmissionTargetId,
): SubmissionCheckResult {
  const target = SUBMISSION_TARGETS[targetId];
  const groups: Record<CheckGroup, CheckItem[]> = {
    image: [],
    annotation: [],
    text: [],
    metadata: [],
  };

  // ---- image quality ------------------------------------------------------
  const dpi = effectiveDpi(doc.export);
  groups.image.push(
    item(
      target,
      'image_dpi',
      'image',
      dpi >= target.minDpi,
      'submit-export-dpi',
      {
        actual: Number.isFinite(dpi) ? dpi : '∞',
        required: target.minDpi,
      },
    ),
  );
  groups.image.push(
    item(
      target,
      'image_color_mode',
      'image',
      doc.export.colorMode === target.colorMode,
      'submit-color-mode',
      { actual: doc.export.colorMode.toUpperCase(), required: target.colorMode.toUpperCase() },
    ),
  );

  // ---- annotation ---------------------------------------------------------
  groups.annotation.push(
    item(target, 'panels_present', 'annotation', doc.panels.length > 0, 'figure-add-panel'),
  );
  const tags = resolvePanelTags(doc.panels);
  const badTag = tags.find((t) => !target.tagPattern.test(t));
  groups.annotation.push(
    item(
      target,
      'panel_tags',
      'annotation',
      badTag === undefined,
      'figure-panel-list',
      { tag: badTag ?? '', pattern: target.tagPattern.source },
    ),
  );
  const unlabeled = doc.panels.filter(
    (p) => !p.spec.xLabel?.trim() || !p.spec.yLabel?.trim(),
  );
  groups.annotation.push(
    item(
      target,
      'axis_labels',
      'annotation',
      doc.panels.length > 0 && unlabeled.length === 0,
      'figure-panel-list',
      { count: unlabeled.length },
    ),
  );

  // ---- text ---------------------------------------------------------------
  // Raster output bakes text into pixels, so embedding only gates vector formats.
  const needsEmbed = target.fontEmbedRequired && doc.export.format !== 'png600';
  groups.text.push(
    item(
      target,
      'font_embedding',
      'text',
      !needsEmbed || doc.export.fontEmbedded,
      'submit-font-embed',
      { format: doc.export.format.toUpperCase() },
    ),
  );
  groups.text.push(
    item(target, 'caption_present', 'text', doc.caption.trim().length > 0, 'figure-caption'),
  );

  // ---- metadata -----------------------------------------------------------
  const formatOk = target.acceptedFormats.includes(doc.export.format);
  groups.metadata.push(
    item(
      target,
      'export_format',
      'metadata',
      formatOk,
      'figure-export-row',
      {
        format: doc.export.format.toUpperCase(),
        accepted: target.acceptedFormats.map((f) => f.toUpperCase()).join(', '),
      },
    ),
  );
  const fontPt = pxToPt(BASE_LABEL_PX * templateById(doc.templateId).fontScale);
  groups.metadata.push(
    item(
      target,
      'font_size',
      'metadata',
      fontPt >= target.minFontSizePt,
      'figure-template',
      { actual: fontPt.toFixed(1), required: target.minFontSizePt },
    ),
  );
  const templateOk = target.templatePrefixes.some((p) => doc.templateId.startsWith(p));
  groups.metadata.push(
    item(target, 'template_match', 'metadata', templateOk, 'figure-template'),
  );

  const items: CheckItem[] = [
    ...groups.image,
    ...groups.annotation,
    ...groups.text,
    ...groups.metadata,
  ];
  const failedCount = items.filter((i) => !i.passed).length;
  return {
    targetId,
    groups: (Object.keys(groups) as CheckGroup[]).map((g) => ({
      group: g,
      items: groups[g],
    })),
    items,
    total: items.length,
    failedCount,
    passed: failedCount === 0,
  };
}
