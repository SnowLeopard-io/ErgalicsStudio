// ==========================================================================
// Industrial workbench — display labels
//
// The engineering core is language-neutral: it stores metric keys, field
// names and step/boundary kinds as stable identifiers. This module turns
// those identifiers into localised text at render time, falling back to the
// raw identifier for data the dictionary does not know (e.g. a user-defined
// material). Keeping the mapping here means every industrial page renders a
// term the same way.
// ==========================================================================

import type { EngineeringMesh, EngineeringSolveResult, EngineeringStudy } from '@/core/engineering/types';
import type { ScienceMetric } from '@ergalics/plugin-sdk/bridges';
import { engineeringFingerprint } from '@/core/engineering/study';
import { ensureCase } from '@/core/engineering/cases';

export type TFn = (key: string, params?: Record<string, string | number>) => string;

/** Look up `industrial.<section>.<key>`; return `fallback` when missing. */
function lookup(t: TFn, section: string, key: string, fallback: string): string {
  const full = `industrial.${section}.${key}`;
  const text = t(full);
  return text === full ? fallback : text;
}

export function metricLabel(t: TFn, key: string): string {
  return lookup(t, 'metric', key, key);
}

export function fieldLabel(t: TFn, name: string): string {
  return lookup(t, 'field', name, name);
}

export function stepKindLabel(t: TFn, kind: string): string {
  return lookup(t, 'stepkind', kind, kind);
}

export function boundaryKindLabel(t: TFn, kind: string): string {
  return lookup(t, 'boundarykind', kind, kind);
}

export function locationLabel(t: TFn, location: string): string {
  return lookup(t, 'location', location, location);
}

export function algorithmLabel(t: TFn, algorithm: string): string {
  return lookup(t, 'algo', algorithm, algorithm);
}

/** Known analytic benchmark titles are localised; anything else is shown
 *  verbatim (the benchmark name is partly data). */
export function benchmarkLabel(t: TFn, name: string): string {
  if (/uniaxial/i.test(name)) return t('industrial.benchmark.uniaxial');
  return name;
}

/** Same shape as `meshSummary`, but routed through the dictionary so the
 *  node/element/group counts read naturally in either language. */
export function localizedMeshSummary(t: TFn, mesh: EngineeringMesh): string {
  const counts = new Map<string, number>();
  for (const element of mesh.elements) {
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  }
  const types = [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(' ');
  return t('industrial.summary_mesh', {
    n: mesh.nodes.length,
    e: mesh.elements.length,
    types,
    g: mesh.groups.length,
  });
}

/**
 * Bottom data-strip facts, switched per industrial tool: each suite shows the
 * parameters that matter to it (geometry sees entities/layers, the solver
 * sees step/iteration state, the fingerprint page sees the hash …). Returns
 * an empty set for unknown tools so research-plugin metrics are not polluted.
 */
export function industrialStripMetrics(
  t: TFn,
  toolId: string | null,
  study: EngineeringStudy | null,
  result: EngineeringSolveResult | null,
  solving: boolean,
): ScienceMetric[] {
  if (!toolId || !study) return [];
  const mesh = study.mesh;
  const fmt = (n: number) => n.toLocaleString();
  const steps = ensureCase(study.cases)[0]!.steps;
  const solveValue = solving
    ? '…'
    : result
      ? `${result.stepName} · ${t('industrial.iterations', { n: result.iterations })}`
      : '—';

  switch (toolId) {
    case 'geometry-import': {
      const geometry = study.geometry;
      return [
        {
          key: 'strip-geo-format',
          label: t('industrial.strip.format'),
          value: geometry ? geometry.sourceFormat.toUpperCase() : '—',
        },
        {
          key: 'strip-geo-entities',
          label: t('industrial.strip.entities'),
          value: geometry ? fmt(geometry.entities.length) : '—',
        },
        {
          key: 'strip-geo-layers',
          label: t('industrial.strip.layers'),
          value: geometry ? fmt(geometry.layers.length) : '—',
        },
        {
          key: 'strip-geo-mesh',
          label: t('industrial.right.mesh'),
          value: `${fmt(mesh.nodes.length)} n · ${fmt(mesh.elements.length)} e`,
        },
      ];
    }
    case 'mesh-viewer':
      return [
        { key: 'strip-nodes', label: t('industrial.strip.nodes'), value: fmt(mesh.nodes.length) },
        { key: 'strip-elements', label: t('industrial.strip.elements'), value: fmt(mesh.elements.length) },
        { key: 'strip-groups', label: t('industrial.strip.groups'), value: fmt(mesh.groups.length) },
        {
          key: 'strip-mesh-material',
          label: t('industrial.right.materials'),
          value: study.materials.map((m) => m.name).join(', ') || '—',
        },
      ];
    case 'material-library':
      return [
        { key: 'strip-mat-count', label: t('industrial.strip.material_count'), value: fmt(study.materials.length) },
        {
          key: 'strip-mat-names',
          label: t('industrial.right.materials'),
          value: study.materials.map((m) => m.name).join(', ') || '—',
        },
      ];
    case 'load-cases':
      return [
        { key: 'strip-bc-count', label: t('industrial.strip.boundary_count'), value: fmt(study.boundaryConditions.length) },
        {
          key: 'strip-steps',
          label: t('industrial.right.steps'),
          value: steps.map((step) => step.name).join(', ') || '—',
        },
      ];
    case 'fea-solver':
      return [
        { key: 'strip-solve-step', label: t('industrial.right.steps'), value: steps.map((step) => step.name).join(', ') || '—' },
        { key: 'strip-solve-state', label: t('industrial.right.solve'), value: solveValue, severity: result && !solving ? 'ok' : 'info' },
      ];
    case 'post-processing':
      return [
        { key: 'strip-fields', label: t('industrial.field'), value: fmt(study.fields.length) },
        { key: 'strip-post-solve', label: t('industrial.right.solve'), value: solveValue, severity: result && !solving ? 'ok' : 'info' },
      ];
    case 'design-scan': {
      const design = ensureCase(study.cases)[0]!.design;
      return [
        { key: 'strip-doe-points', label: t('industrial.strip.design_points'), value: fmt(design?.points.length ?? 0) },
        { key: 'strip-doe-params', label: t('industrial.strip.parameters'), value: fmt(design?.parameters.length ?? 0) },
        { key: 'strip-doe-solve', label: t('industrial.right.solve'), value: solveValue, severity: result && !solving ? 'ok' : 'info' },
      ];
    }
    case 'quick-fluid':
      return [
        { key: 'strip-fluid-step', label: t('industrial.right.steps'), value: steps.map((step) => step.name).join(', ') || '—' },
        { key: 'strip-fluid-state', label: t('industrial.right.solve'), value: solveValue, severity: result && !solving ? 'ok' : 'info' },
      ];
    case 'repro-fingerprint':
      return [
        {
          key: 'strip-fingerprint',
          label: t('industrial.right.fingerprint'),
          value: `${engineeringFingerprint(study).meshHash.slice(0, 12)}…`,
        },
        { key: 'strip-fp-mesh', label: t('industrial.right.mesh'), value: `${fmt(mesh.nodes.length)} n · ${fmt(mesh.elements.length)} e` },
      ];
    case 'industrial-report':
      return [
        { key: 'strip-report-mesh', label: t('industrial.right.mesh'), value: `${fmt(mesh.nodes.length)} n · ${fmt(mesh.elements.length)} e` },
        {
          key: 'strip-report-mat',
          label: t('industrial.right.materials'),
          value: study.materials.map((m) => m.name).join(', ') || '—',
        },
        { key: 'strip-report-solve', label: t('industrial.right.solve'), value: solveValue, severity: result && !solving ? 'ok' : 'info' },
      ];
    default:
      return [];
  }
}
