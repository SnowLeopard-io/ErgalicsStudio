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

import type { EngineeringMesh } from '@/core/engineering/types';

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
