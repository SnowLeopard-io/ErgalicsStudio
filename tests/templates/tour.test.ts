// FR-01 — Guided-tour structure tests: every template must ship a complete,
// bilingual step sequence so the overlay never renders an empty card.
import { describe, it, expect } from 'vitest';
import { SUBJECT_TEMPLATES, type SubjectTemplate } from '@/core/templates/catalog';

describe('template guided tours', () => {
  it('every template exposes steps', () => {
    for (const tpl of SUBJECT_TEMPLATES) {
      expect(Array.isArray(tpl.steps), `${tpl.id}.steps`).toBe(true);
    }
  });

  describe.each(SUBJECT_TEMPLATES)('tour %s', (tpl: SubjectTemplate) => {
    it('has at least 3 and at most 6 steps', () => {
      expect(tpl.steps.length).toBeGreaterThanOrEqual(3);
      expect(tpl.steps.length).toBeLessThanOrEqual(6);
    });

    it('gives every step a non-empty bilingual title', () => {
      for (const [i, s] of tpl.steps.entries()) {
        expect(s.title.zh.trim().length, `${tpl.id} step ${i} zh title`).toBeGreaterThan(0);
        expect(s.title.en.trim().length, `${tpl.id} step ${i} en title`).toBeGreaterThan(0);
      }
    });

    it('gives every step a non-empty bilingual body', () => {
      for (const [i, s] of tpl.steps.entries()) {
        expect(s.body.zh.trim().length, `${tpl.id} step ${i} zh body`).toBeGreaterThan(0);
        expect(s.body.en.trim().length, `${tpl.id} step ${i} en body`).toBeGreaterThan(0);
      }
    });

    it('explains the research question in the opening step', () => {
      const first = tpl.steps[0]!;
      // The step-0 body must reference the concrete data file(s) the tour
      // walks through, tying the guide to the loaded project.
      const files = tpl.buildProject().data.files;
      expect(files.length).toBeGreaterThan(0);
      const mentionsFile = files.some((f) => first.body.zh.includes(f.name) || first.body.en.includes(f.name));
      expect(mentionsFile, `${tpl.id}: step 0 names a data file`).toBe(true);
    });

    it('routes at least one step to a concrete tool surface', () => {
      const routes = tpl.steps.map((s) => s.toolRoute).filter((r): r is string => Boolean(r));
      expect(routes.length).toBeGreaterThan(0);
      expect(routes.some((r) => r.startsWith('/studio/'))).toBe(true);
    });
  });

  it('all tour titles are unique within a template', () => {
    for (const tpl of SUBJECT_TEMPLATES) {
      const titles = tpl.steps.map((s) => s.title.en);
      expect(new Set(titles).size, tpl.id).toBe(titles.length);
    }
  });
});
