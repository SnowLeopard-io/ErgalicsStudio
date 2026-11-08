// The 30-second debut: the project it builds is the promise of the product.
// Keep it deterministic and publication-shaped — the tour depends on both.
import { describe, it, expect } from 'vitest';
import {
  DEBUT_FILE_NAME,
  DEBUT_FIGURE_ID,
  DEBUT_PROJECT_ID,
  buildDebutProject,
} from '@/core/debut';

describe('debut project', () => {
  it('ships the sample dataset and a composed publication figure', () => {
    const project = buildDebutProject();

    expect(project.id).toBe(DEBUT_PROJECT_ID);
    expect(project.data.files).toHaveLength(1);
    expect(project.data.files[0]!.name).toBe(DEBUT_FILE_NAME);
    expect(project.data.files[0]!.content).toContain('wavelength_A,flux');

    const sheets = project.state.figureSheets ?? [];
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.id).toBe(DEBUT_FIGURE_ID);
    expect(sheets[0]!.templateId).toBe('ieee_single');
    // The caption is deliberately blank: generating it is tour step 3.
    expect(sheets[0]!.caption).toBe('');

    const panel = sheets[0]!.panels[0]!;
    expect(panel.row).toBe(0);
    expect(panel.col).toBe(0);
    expect(panel.spec.series[0]!.kind).toBe('line');
    expect(panel.spec.series[0]!.points!.length).toBe(300);
    expect(panel.spec.xLabel).toBe('Wavelength (Å)');
    expect(panel.spec.yLabel).toBe('Flux (a.u.)');
  });

  it('is deterministic across reloads (stable ids and data)', () => {
    const a = buildDebutProject();
    const b = buildDebutProject();

    expect(a.data.files[0]!.id).toBe(b.data.files[0]!.id);
    expect(a.state.figureSheets?.[0]?.panels[0]?.spec.series[0]?.points).toEqual(
      b.state.figureSheets?.[0]?.panels[0]?.spec.series[0]?.points,
    );
  });
});
