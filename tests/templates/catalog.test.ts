// FR-01 — Subject template catalog integrity tests.
//
// Every template must: build a valid Project with non-empty data files,
// carry complete bilingual text, reference only real RESEARCH_TOOLS ids,
// stay under the 200 KB data budget, and cover the website gallery's
// `template` ids (imported straight from website/src/data/gallery.ts — same
// repo/workspace, so the deep-link contract is checked at the source).
import { describe, it, expect } from 'vitest';
import {
  SUBJECT_TEMPLATES,
  getTemplate,
  pickLocale,
  GALLERY_ID_TO_TEMPLATE,
  type SubjectTemplate,
} from '@/core/templates/catalog';
import { RESEARCH_TOOLS } from '@/pages/research/toolRegistry';
import { normalizeProject, PROJECT_FORMAT_VERSION } from '@/types/project';
import { GALLERY } from '../../website/src/data/gallery';

const TOOL_IDS = new Set(RESEARCH_TOOLS.map((t) => t.id));
const SUBJECTS = new Set([
  'physics', 'biology', 'astronomy', 'engineering',
  'chemistry', 'geoscience', 'medicine', 'mathematics',
]);
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);

/** Parse tabular text into header + data rows (CSV or JSON grid). */
function dataShape(content: string, format: string): { cols: number; rows: number } {
  if (format === 'json') {
    const parsed = JSON.parse(content) as { rows?: number; cols?: number; T_K?: number[] };
    return {
      cols: parsed.cols ?? 0,
      rows: parsed.T_K && parsed.cols ? parsed.T_K.length / parsed.cols : parsed.rows ?? 0,
    };
  }
  const lines = content.trim().split('\n');
  return { cols: (lines[0] ?? '').split(',').length, rows: lines.length - 1 };
}

describe('subject template catalog', () => {
  it('ships at least 12 templates', () => {
    expect(SUBJECT_TEMPLATES.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids', () => {
    const ids = SUBJECT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getTemplate resolves known ids and rejects unknown ones', () => {
    expect(getTemplate('physics-error')?.subject).toBe('physics');
    expect(getTemplate('no-such-template')).toBeUndefined();
    expect(getTemplate(undefined)).toBeUndefined();
  });

  it('covers every template id referenced by the website gallery', () => {
    const referenced = GALLERY.filter((g) => g.template).map((g) => g.template as string);
    expect(referenced.length).toBeGreaterThanOrEqual(10);
    for (const id of referenced) {
      expect(SUBJECT_TEMPLATES.some((t) => t.id === id), `gallery template ${id}`).toBe(true);
    }
  });

  it('gallery-id → template map only points at real templates', () => {
    for (const [galleryId, templateId] of Object.entries(GALLERY_ID_TO_TEMPLATE)) {
      expect(getTemplate(templateId), `gallery ${galleryId} → ${templateId}`).toBeDefined();
    }
  });

  describe.each(SUBJECT_TEMPLATES)('template %s', (tpl: SubjectTemplate) => {
    it('has a valid subject and difficulty', () => {
      expect(SUBJECTS.has(tpl.subject)).toBe(true);
      expect(DIFFICULTIES.has(tpl.difficulty)).toBe(true);
    });

    it('estimates a sane completion time (3–30 minutes)', () => {
      expect(Number.isInteger(tpl.minutes)).toBe(true);
      expect(tpl.minutes).toBeGreaterThanOrEqual(3);
      expect(tpl.minutes).toBeLessThanOrEqual(30);
    });

    it('references only registered research tools', () => {
      expect(tpl.tools.length).toBeGreaterThan(0);
      for (const id of tpl.tools) {
        expect(TOOL_IDS.has(id), `tool ${id} of ${tpl.id}`).toBe(true);
      }
    });

    it('carries complete bilingual title / summary / question', () => {
      for (const text of [tpl.title, tpl.summary, tpl.question]) {
        expect(text.zh.trim().length).toBeGreaterThan(0);
        expect(text.en.trim().length).toBeGreaterThan(0);
      }
    });

    it('has 3–6 bilingual guided steps', () => {
      expect(tpl.steps.length).toBeGreaterThanOrEqual(3);
      expect(tpl.steps.length).toBeLessThanOrEqual(6);
      for (const s of tpl.steps) {
        expect(s.title.zh.trim().length).toBeGreaterThan(0);
        expect(s.title.en.trim().length).toBeGreaterThan(0);
        expect(s.body.zh.trim().length).toBeGreaterThan(0);
        expect(s.body.en.trim().length).toBeGreaterThan(0);
      }
    });

    it('points step tool routes at real tool paths or the workbench', () => {
      const validRoutes = new Set(RESEARCH_TOOLS.map((t) => t.path).concat('/workbench'));
      for (const s of tpl.steps) {
        if (s.toolRoute) expect(validRoutes.has(s.toolRoute), `${tpl.id}: ${s.toolRoute}`).toBe(true);
      }
    });

    it('builds a structurally valid Project', () => {
      const project = tpl.buildProject();
      expect(project.id).toBeTruthy();
      expect(project.name.trim().length).toBeGreaterThan(0);
      expect(typeof project.createdAt).toBe('number');
      expect(typeof project.updatedAt).toBe('number');
      expect(project.metadata.version).toBe(PROJECT_FORMAT_VERSION);
      expect(project.metadata.tags).toContain('template');
      expect(project.metadata.tags).toContain(tpl.subject);
      // Survives the deserialize round-trip (normalizeProject must not throw
      // and must keep every file).
      const roundTripped = normalizeProject(JSON.parse(JSON.stringify(project)));
      expect(roundTripped.data.files.length).toBe(project.data.files.length);
    });

    it('ships non-empty, parseable example data (no blank first screen)', () => {
      const project = tpl.buildProject();
      expect(project.data.files.length).toBeGreaterThan(0);
      for (const file of project.data.files) {
        expect(file.content.length).toBeGreaterThan(0);
        expect(file.name).toBeTruthy();
        expect(file.id).toBeTruthy();
        const shape = dataShape(file.content, file.format);
        expect(shape.cols, `${tpl.id}/${file.name} columns`).toBeGreaterThan(1);
        expect(shape.rows, `${tpl.id}/${file.name} rows`).toBeGreaterThan(0);
      }
    });

    it('stays within the 200 KB embedded-data budget', () => {
      const bytes = tpl
        .buildProject()
        .data.files.reduce((sum, f) => sum + f.content.length, 0);
      expect(bytes).toBeLessThan(200 * 1024);
    });

    it('generates deterministic data across builds', () => {
      const a = tpl.buildProject().data.files[0]!;
      const b = tpl.buildProject().data.files[0]!;
      expect(a.content).toBe(b.content);
    });
  });
});

describe('pickLocale', () => {
  it('returns en for en-US and zh otherwise', () => {
    expect(pickLocale({ zh: '中', en: 'EN' }, 'en-US')).toBe('EN');
    expect(pickLocale({ zh: '中', en: 'EN' }, 'zh-CN')).toBe('中');
  });
});
