// ==========================================================================
// Engineering study persistence + reproducibility fingerprints (P4 / v3)
//
// A study is a plain object except for `fields[].values` (Float64Array),
// which JSON cannot carry. `toStudySnapshot` / `fromStudySnapshot` convert
// between the live model and the serialisable form stored in `.clproj`
// (`state.engineering.study`). The fingerprint mirrors the repro-lock v3
// contract: mesh, materials, case and solver identity.
// ==========================================================================

import { hashString } from '@/core/repro/random';
import { ContentHasher } from '@/core/build/hash';
import {
  ENGINEERING_MODEL_SCHEMA,
  meshBounds,
  type EngineeringField,
  type EngineeringMaterial,
  type EngineeringMesh,
  type EngineeringStudy,
} from './types';
import { ensureCase } from './cases';

export interface StudySnapshot {
  schema: string;
  name: string;
  sourceFormat: EngineeringStudy['sourceFormat'];
  mesh: EngineeringMesh;
  materials: EngineeringMaterial[];
  boundaryConditions: EngineeringStudy['boundaryConditions'];
  /** Optional: persisted project state omits it (the last solve result keeps
   *  the only copy); workspace/export snapshots still include it. */
  fields?: Array<Omit<EngineeringField, 'values'> & { values: number[] }>;
  metadata: Record<string, string>;
  geometry?: EngineeringStudy['geometry'];
  cases?: EngineeringStudy['cases'];
  materialAssignment?: EngineeringStudy['materialAssignment'];
}

/** Convert the live model into a JSON-safe snapshot. `includeFields: false`
 *  drops the (large) solved fields so a project write does not store the same
 *  arrays twice — `result` carries them and the load path restores them. */
export function toStudySnapshot(
  study: EngineeringStudy,
  options: { includeFields?: boolean } = {},
): StudySnapshot {
  return {
    schema: study.schema,
    name: study.name,
    sourceFormat: study.sourceFormat,
    mesh: study.mesh,
    materials: study.materials,
    boundaryConditions: study.boundaryConditions,
    ...(options.includeFields === false
      ? {}
      : {
          fields: study.fields.map((field) => ({
            ...field,
            values: Array.from(field.values),
          })),
        }),
    metadata: study.metadata,
    ...(study.geometry ? { geometry: study.geometry } : {}),
    ...(study.cases ? { cases: study.cases } : {}),
    ...(study.materialAssignment ? { materialAssignment: study.materialAssignment } : {}),
  };
}

/** Restore the live model (typed arrays rebuilt, stale fields dropped). */
export function fromStudySnapshot(raw: unknown): EngineeringStudy | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as Partial<StudySnapshot>;
  if (!snapshot.mesh || !Array.isArray(snapshot.mesh.nodes)) return null;
  const fields: EngineeringField[] = Array.isArray(snapshot.fields)
    ? snapshot.fields
        .filter((field) => field && typeof field.name === 'string')
        .map((field) => ({
          name: field.name,
          location: field.location ?? 'node',
          components: field.components ?? 1,
          values: Float64Array.from(field.values ?? []),
          ...(typeof field.time === 'number' ? { time: field.time } : {}),
          ...(field.unit ? { unit: field.unit } : {}),
        }))
    : [];
  return {
    schema: ENGINEERING_MODEL_SCHEMA,
    name: snapshot.name ?? 'Engineering study',
    sourceFormat: snapshot.sourceFormat ?? 'gmsh',
    mesh: {
      nodes: snapshot.mesh.nodes,
      elements: snapshot.mesh.elements ?? [],
      groups: snapshot.mesh.groups ?? [],
      bounds:
        snapshot.mesh.bounds ?? meshBounds(snapshot.mesh.nodes),
    },
    materials: snapshot.materials ?? [],
    boundaryConditions: snapshot.boundaryConditions ?? [],
    fields,
    metadata: snapshot.metadata ?? {},
    ...(snapshot.geometry ? { geometry: snapshot.geometry } : {}),
    ...(snapshot.cases && snapshot.cases.length > 0 ? { cases: snapshot.cases } : {}),
    ...(snapshot.materialAssignment
      ? { materialAssignment: snapshot.materialAssignment }
      : {}),
  };
}

/** Deep clone that also duplicates typed arrays (safe for edit buffers). */
export function cloneStudy(study: EngineeringStudy): EngineeringStudy {
  return fromStudySnapshot(structuredCloneSafe(toStudySnapshot(study)))!;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON below (plain data only) */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// --------------------------------------------------------------------------
// Fingerprints
// --------------------------------------------------------------------------

export interface EngineeringFingerprint {
  schema: 'ergalics.engineering-fingerprint/v1';
  meshHash: string;
  materialHashes: Record<string, string>;
  caseHash: string;
  solver: {
    name: string;
    version: string;
    algorithm: string;
    tolerance: number;
  };
}

/** Canonical mesh text: node coordinates (6 dp) + element topology + groups.
 *  Human-readable debugging aid only — `meshHash` hashes full-precision
 *  coordinates (the solver and BC matching use the exact values, so a 6 dp
 *  text hash would collide inputs that differ below the 6th decimal). */
export function meshFingerprintText(mesh: EngineeringMesh): string {
  const nodes = mesh.nodes
    .map((node) => `${node.id}:${node.x.toFixed(6)},${node.y.toFixed(6)},${node.z.toFixed(6)}`)
    .join(';');
  const elements = mesh.elements
    .map((element) => `${element.id}:${element.type}:${element.nodes.join(',')}:${element.group ?? 0}`)
    .join(';');
  const groups = mesh.groups
    .map((group) => `${group.dimension}/${group.tag}/${group.name}:${group.members.join(',')}`)
    .join(';');
  return `${nodes}|${elements}|${groups}`;
}

/** Full-precision content hash of the mesh (exact IEEE-754 coordinates). */
export function meshHash(mesh: EngineeringMesh): string {
  const hasher = new ContentHasher().updateString(
    `mesh:${mesh.nodes.length}:${mesh.elements.length}:${mesh.groups.length}:`,
  );
  for (const node of mesh.nodes) {
    hasher.updateNumber(node.id).updateNumber(node.x).updateNumber(node.y).updateNumber(node.z);
  }
  hasher.updateString('|elements:');
  for (const element of mesh.elements) {
    hasher.updateNumber(element.id).updateString(element.type);
    for (const index of element.nodes) hasher.updateNumber(index);
    hasher.updateNumber(element.group ?? 0);
    hasher.updateString(';');
  }
  hasher.updateString('|groups:');
  for (const group of mesh.groups) {
    hasher.updateNumber(group.dimension).updateNumber(group.tag).updateString(group.name);
    for (const member of group.members) hasher.updateNumber(member);
    hasher.updateString(';');
  }
  return hasher.digest();
}

export function materialHash(material: EngineeringMaterial): string {
  const properties = Object.keys(material.properties)
    .sort()
    .map((key) => `${key}=${JSON.stringify(material.properties[key])}`)
    .join('&');
  return hashString(`${material.name}:${properties}`);
}

export function caseHash(study: EngineeringStudy): string {
  const bcs = study.boundaryConditions
    .map((bc) => {
      const components = Object.keys(bc.components)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => `${key}=${bc.components[Number(key)]}`)
        .join(',');
      return `${bc.name}/${bc.kind}/${bc.target.dimension}:${bc.target.tag}/${components}/${bc.expression ?? ''}`;
    })
    .join(';');
  const cases = ensureCase(study.cases)
    .map((studyCase) => {
      const steps = studyCase.steps
        .map((step) => `${step.kind}:${step.solver.algorithm}:${step.solver.tolerance}:${step.solver.maxIterations}:${step.solver.planeState ?? ''}:${step.solver.thickness ?? ''}:${step.solver.dt ?? ''}:${step.solver.timeSteps ?? ''}:${step.solver.theta ?? ''}`)
        .join(',');
      return `${studyCase.name}[${steps}]`;
    })
    .join(';');
  const assignment = Object.keys(study.materialAssignment ?? {})
    .sort()
    .map((key) => `${key}=${study.materialAssignment![key]}`)
    .join(',');
  return hashString(`${bcs}|${cases}|${assignment}`);
}

export function engineeringFingerprint(
  study: EngineeringStudy,
  options: { solverName?: string; solverVersion?: string } = {},
): EngineeringFingerprint {
  const materials: Record<string, string> = {};
  for (const material of study.materials) materials[material.name] = materialHash(material);
  const steps = ensureCase(study.cases)[0]!.steps;
  const primary = steps[0]!;
  return {
    schema: 'ergalics.engineering-fingerprint/v1',
    meshHash: meshHash(study.mesh),
    materialHashes: materials,
    caseHash: caseHash(study),
    solver: {
      name: options.solverName ?? 'ergalics-fem',
      version: options.solverVersion ?? '1.0.0',
      algorithm: primary.solver.algorithm,
      tolerance: primary.solver.tolerance,
    },
  };
}

export interface FingerprintDrift {
  field: 'mesh' | 'material' | 'case' | 'solver';
  target: string;
  expected: string;
  actual: string;
}

/** Compare a locked fingerprint against the current study. */
export function verifyEngineeringFingerprint(
  expected: EngineeringFingerprint,
  study: EngineeringStudy,
): FingerprintDrift[] {
  const actual = engineeringFingerprint(study, {
    solverName: expected.solver.name,
    solverVersion: expected.solver.version,
  });
  const drifts: FingerprintDrift[] = [];
  if (actual.meshHash !== expected.meshHash) {
    drifts.push({
      field: 'mesh',
      target: 'meshHash',
      expected: expected.meshHash,
      actual: actual.meshHash,
    });
  }
  const names = new Set([
    ...Object.keys(expected.materialHashes),
    ...Object.keys(actual.materialHashes),
  ]);
  for (const name of names) {
    const a = expected.materialHashes[name];
    const b = actual.materialHashes[name];
    if (a !== b) {
      drifts.push({
        field: 'material',
        target: name,
        expected: a ?? 'missing',
        actual: b ?? 'missing',
      });
    }
  }
  if (actual.caseHash !== expected.caseHash) {
    drifts.push({
      field: 'case',
      target: 'caseHash',
      expected: expected.caseHash,
      actual: actual.caseHash,
    });
  }
  if (
    actual.solver.name !== expected.solver.name ||
    actual.solver.version !== expected.solver.version ||
    actual.solver.algorithm !== expected.solver.algorithm ||
    actual.solver.tolerance !== expected.solver.tolerance
  ) {
    drifts.push({
      field: 'solver',
      target: 'solver',
      expected: JSON.stringify(expected.solver),
      actual: JSON.stringify(actual.solver),
    });
  }
  return drifts;
}
