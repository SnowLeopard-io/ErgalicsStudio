// ==========================================================================
// FR-03 journal submission assistant — core tests
//
// Threshold decisions for the IEEE / Elsevier profiles, per-item pass/fail,
// caption drafting (zh/en), graceful degradation on edge inputs, and key
// parity of the submit dictionary (merged centrally by the main agent).
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  runSubmissionCheck,
  effectiveDpi,
  resolvePanelTags,
  pxToPt,
  SUBMISSION_TARGETS,
} from '@/core/submit/checklist';
import type { SubmissionDoc } from '@/core/submit/checklist';
import { draftCaption, deriveStatsFromPanels } from '@/core/submit/caption';
import { submitZh, submitEn } from '@/i18n/dicts/submit';
import type { FigurePanel } from '@/core/figure/compose';
import type { PlotSpec } from '@/core/plot';

function linePanel(overrides: Partial<PlotSpec> = {}): FigurePanel {
  return {
    row: 0,
    col: 0,
    spec: {
      width: 336,
      height: 252,
      xLabel: 'time',
      yLabel: 'value',
      series: [
        {
          name: 'y',
          kind: 'line',
          color: '#0072B2',
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 2 },
            { x: 2, y: 4 },
          ],
        },
      ],
      ...overrides,
    },
  };
}

function docOf(overrides: Partial<SubmissionDoc> = {}): SubmissionDoc {
  return {
    templateId: 'ieee_single',
    caption: 'Figure 1. A caption.',
    panels: [linePanel()],
    export: { format: 'pdf', rasterDpi: 600, colorMode: 'rgb', fontEmbedded: true },
    ...overrides,
  };
}

function itemById(result: ReturnType<typeof runSubmissionCheck>, id: string) {
  const found = result.items.find((i) => i.id === id);
  expect(found, `check item ${id}`).toBeDefined();
  return found!;
}

describe('submission targets', () => {
  it('IEEE requires 600 dpi RGB, Elsevier 300 dpi CMYK', () => {
    expect(SUBMISSION_TARGETS.ieee.minDpi).toBe(600);
    expect(SUBMISSION_TARGETS.ieee.colorMode).toBe('rgb');
    expect(SUBMISSION_TARGETS.elsevier.minDpi).toBe(300);
    expect(SUBMISSION_TARGETS.elsevier.colorMode).toBe('cmyk');
    expect(SUBMISSION_TARGETS.elsevier.acceptedFormats).not.toContain('svg');
    expect(SUBMISSION_TARGETS.ieee.acceptedFormats).toContain('svg');
  });

  it('vector exports always satisfy the resolution rule', () => {
    expect(effectiveDpi({ format: 'svg', rasterDpi: 72, colorMode: 'rgb', fontEmbedded: true })).toBe(Infinity);
    expect(effectiveDpi({ format: 'png600', rasterDpi: 300, colorMode: 'rgb', fontEmbedded: true })).toBe(300);
  });
});

describe('runSubmissionCheck — IEEE', () => {
  it('a compliant figure passes every group', () => {
    const result = runSubmissionCheck(docOf(), 'ieee');
    expect(result.passed).toBe(true);
    expect(result.failedCount).toBe(0);
    expect(result.total).toBe(result.items.length);
    expect(result.groups.map((g) => g.group)).toEqual(['image', 'annotation', 'text', 'metadata']);
  });

  it('low raster dpi fails the resolution check', () => {
    const doc = docOf({ export: { format: 'png600', rasterDpi: 150, colorMode: 'rgb', fontEmbedded: true } });
    const result = runSubmissionCheck(doc, 'ieee');
    const dpi = itemById(result, 'image_dpi');
    expect(dpi.passed).toBe(false);
    expect(dpi.group).toBe('image');
    expect(dpi.focusTarget).toBe('submit-export-dpi');
    expect(dpi.params.required).toBe(600);
  });

  it('CMYK fails IEEE (RGB recommended)', () => {
    const doc = docOf({ export: { format: 'pdf', rasterDpi: 600, colorMode: 'cmyk', fontEmbedded: true } });
    expect(itemById(runSubmissionCheck(doc, 'ieee'), 'image_color_mode').passed).toBe(false);
  });

  it('uppercase panel tag fails IEEE lowercase format', () => {
    const doc = docOf({ panels: [{ ...linePanel(), tag: 'A' }] });
    const tags = itemById(runSubmissionCheck(doc, 'ieee'), 'panel_tags');
    expect(tags.passed).toBe(false);
    expect(tags.params.tag).toBe('A');
  });

  it('missing axis labels fails the annotation check', () => {
    const doc = docOf({ panels: [linePanel({ xLabel: undefined, yLabel: undefined })] });
    const labels = itemById(runSubmissionCheck(doc, 'ieee'), 'axis_labels');
    expect(labels.passed).toBe(false);
    expect(labels.params.count).toBe(1);
  });

  it('empty caption fails the caption check and points at the caption box', () => {
    const doc = docOf({ caption: '   ' });
    const cap = itemById(runSubmissionCheck(doc, 'ieee'), 'caption_present');
    expect(cap.passed).toBe(false);
    expect(cap.focusTarget).toBe('figure-caption');
  });

  it('unembedded fonts fail vector exports but not raster ones', () => {
    const doc = docOf({ export: { format: 'pdf', rasterDpi: 600, colorMode: 'rgb', fontEmbedded: false } });
    expect(itemById(runSubmissionCheck(doc, 'ieee'), 'font_embedding').passed).toBe(false);
    const raster = docOf({ export: { format: 'png600', rasterDpi: 600, colorMode: 'rgb', fontEmbedded: false } });
    expect(itemById(runSubmissionCheck(raster, 'ieee'), 'font_embedding').passed).toBe(true);
  });
});

describe('runSubmissionCheck — Elsevier', () => {
  it('300 dpi passes Elsevier but fails IEEE', () => {
    const doc = docOf({ export: { format: 'png600', rasterDpi: 300, colorMode: 'cmyk', fontEmbedded: true } });
    expect(itemById(runSubmissionCheck(doc, 'elsevier'), 'image_dpi').passed).toBe(true);
    expect(itemById(runSubmissionCheck(doc, 'ieee'), 'image_dpi').passed).toBe(false);
  });

  it('SVG export is not accepted by Elsevier', () => {
    const doc = docOf({ templateId: 'elsevier_single', export: { format: 'svg', rasterDpi: 600, colorMode: 'cmyk', fontEmbedded: true } });
    const fmt = itemById(runSubmissionCheck(doc, 'elsevier'), 'export_format');
    expect(fmt.passed).toBe(false);
    expect(fmt.params.accepted).toContain('PDF');
  });

  it('an IEEE template fails the Elsevier template-match check', () => {
    const doc = docOf({ templateId: 'ieee_single' });
    expect(itemById(runSubmissionCheck(doc, 'elsevier'), 'template_match').passed).toBe(false);
    const aligned = docOf({ templateId: 'elsevier_double' });
    expect(itemById(runSubmissionCheck(aligned, 'elsevier'), 'template_match').passed).toBe(true);
  });

  it('multi-letter tags fail Elsevier single-letter format', () => {
    const doc = docOf({ templateId: 'elsevier_single', panels: [{ ...linePanel(), tag: 'aa' }] });
    expect(itemById(runSubmissionCheck(doc, 'elsevier'), 'panel_tags').passed).toBe(false);
  });
});

describe('runSubmissionCheck — edge cases', () => {
  it('an empty sheet fails presence/annotation checks without crashing', () => {
    const doc = docOf({ panels: [], caption: '' });
    const result = runSubmissionCheck(doc, 'ieee');
    expect(result.failedCount).toBeGreaterThan(0);
    expect(itemById(result, 'panels_present').passed).toBe(false);
    expect(itemById(result, 'axis_labels').passed).toBe(false);
    // Tag format is vacuously fine for zero panels.
    expect(itemById(result, 'panel_tags').passed).toBe(true);
  });

  it('auto tags resolve row-major (a, b, c)', () => {
    const tags = resolvePanelTags([
      { ...linePanel(), row: 1, col: 0 },
      { ...linePanel(), row: 0, col: 1 },
      { ...linePanel(), row: 0, col: 0 },
    ]);
    expect(tags).toEqual(['a', 'b', 'c']);
  });

  it('font size threshold maps template scale to points', () => {
    // 11 px @96dpi → 8.25 pt; IEEE scale 0.85 → ~7.0 pt (passes), console 1.0 → 8.25 pt.
    expect(pxToPt(11)).toBeCloseTo(8.25, 2);
    const consoleDoc = docOf({ templateId: 'console' });
    expect(itemById(runSubmissionCheck(consoleDoc, 'ieee'), 'font_size').passed).toBe(true);
  });
});

describe('draftCaption', () => {
  const stats = {
    kind: 'correlation' as const,
    r: 0.62,
    pValue: 0.004,
    n: 20,
    xName: 'dosage',
    yName: 'response',
  };

  it('drafts an English caption with chart description and statistic', () => {
    const text = draftCaption({ chartType: 'scatter', columns: ['dosage', 'response'], stats, lang: 'en-US' });
    expect(text.startsWith('Figure 1.')).toBe(true);
    expect(text).toContain('Scatter plot of response against dosage');
    expect(text).toContain('r(18) = 0.62');
    expect(text).toContain('p = .004');
  });

  it('drafts a Chinese caption', () => {
    const text = draftCaption({ chartType: 'line', columns: ['time', 'value'], stats: null, lang: 'zh-CN' });
    expect(text.startsWith('图 1.')).toBe(true);
    expect(text).toContain('折线图：value 随 time 的变化趋势');
    expect(text.endsWith('。')).toBe(true);
  });

  it('bar captions list compared columns', () => {
    const text = draftCaption({ chartType: 'bar', columns: ['group', 'mean', 'sd'], stats: null, lang: 'en-US' });
    expect(text).toContain('Bar chart comparing mean, sd by group');
  });

  it('histogram captions name the distribution column', () => {
    const text = draftCaption({ chartType: 'histogram', columns: ['height'], stats: null, lang: 'zh-CN' });
    expect(text).toContain('直方图：height 的分布');
  });

  it('no columns degrades to a bare chart noun without crashing', () => {
    const zh = draftCaption({ chartType: 'line', columns: [], stats: null, lang: 'zh-CN' });
    expect(zh).toBe('图 1.折线图。');
    const en = draftCaption({ chartType: 'scatter', columns: [], stats: null, lang: 'en-US' });
    expect(en).toBe('Figure 1. A scatter plot.');
  });

  it('deriveStatsFromPanels folds the first eligible line/scatter panel', () => {
    const perfect = linePanel();
    perfect.spec.series[0]!.points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const derived = deriveStatsFromPanels([perfect]);
    expect(derived).not.toBeNull();
    expect(derived!.kind).toBe('correlation');
    if (derived!.kind === 'correlation') {
      expect(derived!.r).toBeCloseTo(1, 5);
      expect(derived!.n).toBe(3);
    }
  });

  it('deriveStatsFromPanels returns null for bars/histograms or tiny samples', () => {
    const bar = linePanel();
    bar.spec.series[0]!.kind = 'bar';
    bar.spec.series[0]!.bars = [{ x0: 0, x1: 1, y: 2 }];
    delete bar.spec.series[0]!.points;
    expect(deriveStatsFromPanels([bar])).toBeNull();
    expect(deriveStatsFromPanels([])).toBeNull();
    const tiny = linePanel();
    tiny.spec.series[0]!.points = [{ x: 0, y: 1 }];
    expect(deriveStatsFromPanels([tiny])).toBeNull();
  });
});

describe('submit dictionary', () => {
  it('keeps zh/en key parity', () => {
    const zh = Object.keys(submitZh).sort();
    const en = Object.keys(submitEn).sort();
    expect(zh).toEqual(en);
  });

  it('every check item id has label/message/fix keys in both locales', () => {
    const result = runSubmissionCheck(docOf(), 'ieee');
    for (const item of result.items) {
      for (const key of [item.labelKey, item.messageKey, item.fixKey]) {
        expect(key in submitZh, key).toBe(true);
        expect(key in submitEn, key).toBe(true);
      }
    }
  });

  it('all keys use the submit. prefix', () => {
    for (const key of Object.keys(submitZh)) expect(key.startsWith('submit.')).toBe(true);
  });
});
