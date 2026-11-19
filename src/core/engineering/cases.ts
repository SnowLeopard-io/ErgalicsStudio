// ==========================================================================
// Engineering cases — solver steps + a deterministic design space (DOE)
//
// A case groups the steps of one analysis (static structural, steady heat,
// transient heat, potential flow) and an optional parameter design space.
// `expandDesign` enumerates the space deterministically so a scan is
// reproducible without storing every point: the full-factorial grid, or a
// seeded Latin-hypercube sample for large spaces.
// ==========================================================================

import type {
  EngineeringCase,
  EngineeringDesignParameter,
  EngineeringDesignPoint,
  EngineeringDesignSpace,
  EngineeringSolverConfig,
  EngineeringStep,
  EngineeringStepKind,
} from './types';

export const DEFAULT_SOLVER: EngineeringSolverConfig = {
  algorithm: 'cg',
  tolerance: 1e-10,
  maxIterations: 2000,
  planeState: 'plane-stress',
  thickness: 1,
  dt: 0.01,
  timeSteps: 20,
  theta: 1,
};

let stepSeq = 0;

export function makeStep(
  name: string,
  kind: EngineeringStepKind,
  solver: Partial<EngineeringSolverConfig> = {},
): EngineeringStep {
  stepSeq += 1;
  return {
    id: `step-${Date.now().toString(36)}-${stepSeq}`,
    name,
    kind,
    solver: { ...DEFAULT_SOLVER, ...solver },
  };
}

export function defaultCase(): EngineeringCase {
  return {
    name: 'Load case 1',
    steps: [makeStep('Static structural', 'static-structural')],
    design: { parameters: [], points: [] },
  };
}

/** Ensure a study always has at least one case (used by editors/solvers). */
export function ensureCase(cases: EngineeringCase[] | undefined): EngineeringCase[] {
  return cases && cases.length > 0 ? cases : [defaultCase()];
}

/** Keep the step ids stable while filling in every solver default. */
export function normalizeStep(step: EngineeringStep): EngineeringStep {
  return { ...step, solver: { ...DEFAULT_SOLVER, ...step.solver } };
}

export interface CaseIssue {
  severity: 'error' | 'warning';
  message: string;
}

const STEP_KINDS: readonly EngineeringStepKind[] = [
  'static-structural',
  'steady-heat',
  'transient-heat',
  'potential-flow',
];

export function isStepKind(value: string): value is EngineeringStepKind {
  return (STEP_KINDS as readonly string[]).includes(value);
}

export function validateCase(studyCase: EngineeringCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
  if (!studyCase.name.trim()) issues.push({ severity: 'error', message: 'case name is empty' });
  if (studyCase.steps.length === 0) {
    issues.push({ severity: 'error', message: 'case has no solver step' });
  }
  for (const step of studyCase.steps) {
    if (!isStepKind(step.kind)) {
      issues.push({ severity: 'error', message: `step "${step.name}" has an unknown kind` });
    }
    if (!(step.solver.tolerance > 0)) {
      issues.push({ severity: 'warning', message: `step "${step.name}" tolerance must be > 0` });
    }
    if (!(step.solver.maxIterations >= 1)) {
      issues.push({ severity: 'warning', message: `step "${step.name}" needs at least 1 iteration` });
    }
    if (step.kind === 'transient-heat') {
      if (!(step.solver.dt && step.solver.dt > 0)) {
        issues.push({ severity: 'error', message: `step "${step.name}" needs dt > 0` });
      }
      if (!(step.solver.timeSteps && step.solver.timeSteps >= 1)) {
        issues.push({ severity: 'error', message: `step "${step.name}" needs time steps ≥ 1` });
      }
    }
  }
  const names = new Set<string>();
  for (const parameter of studyCase.design.parameters) {
    if (names.has(parameter.name)) {
      issues.push({ severity: 'error', message: `duplicate parameter "${parameter.name}"` });
    }
    names.add(parameter.name);
    if (!(parameter.max >= parameter.min)) {
      issues.push({ severity: 'error', message: `parameter "${parameter.name}" range is inverted` });
    }
    if (!(parameter.levels >= 1) || !Number.isInteger(parameter.levels)) {
      issues.push({ severity: 'warning', message: `parameter "${parameter.name}" levels must be a positive integer` });
    }
  }
  return issues;
}

/** Values of one parameter along its range (inclusive). */
export function parameterLevels(parameter: EngineeringDesignParameter): number[] {
  const levels = Math.max(1, Math.floor(parameter.levels));
  if (levels === 1) return [parameter.min];
  const out: number[] = [];
  for (let i = 0; i < levels; i += 1) {
    out.push(parameter.min + ((parameter.max - parameter.min) * i) / (levels - 1));
  }
  return out;
}

/** Number of points a full-factorial expansion would generate. */
export function designPointCount(parameters: readonly EngineeringDesignParameter[]): number {
  if (parameters.length === 0) return 0;
  return parameters.reduce((count, parameter) => count * Math.max(1, Math.floor(parameter.levels)), 1);
}

/** Above this count the expander switches to a seeded Latin hypercube. */
export const FULL_FACTORIAL_LIMIT = 2048;
export const DEFAULT_SCAN_POINTS = 64;

/**
 * Enumerate a design space deterministically. Full factorial while the count
 * is small, otherwise a seeded Latin-hypercube sample (`samples` points).
 */
export function expandDesign(
  design: EngineeringDesignSpace,
  options: { samples?: number } = {},
): EngineeringDesignPoint[] {
  const parameters = design.parameters.filter((parameter) => parameter.name.trim() !== '');
  if (parameters.length === 0) return [];
  const total = designPointCount(parameters);
  if (total <= FULL_FACTORIAL_LIMIT) {
    return fullFactorial(parameters);
  }
  return latinHypercube(parameters, Math.max(2, options.samples ?? DEFAULT_SCAN_POINTS));
}

function fullFactorial(parameters: EngineeringDesignParameter[]): EngineeringDesignPoint[] {
  const values = parameters.map(parameterLevels);
  const points: EngineeringDesignPoint[] = [];
  const walk = (index: number, current: Record<string, number>): void => {
    if (index === parameters.length) {
      points.push(pointFrom(parameters, current));
      return;
    }
    for (const value of values[index]!) {
      walk(index + 1, { ...current, [parameters[index]!.name]: value });
    }
  };
  walk(0, {});
  return points;
}

/** Deterministic LCG (no Math.random – scans must reproduce exactly). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function latinHypercube(
  parameters: EngineeringDesignParameter[],
  samples: number,
): EngineeringDesignPoint[] {
  const random = seeded(0x9e3779b9);
  const columns = parameters.map((parameter) => {
    const values: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const jitter = random();
      const t = (i + jitter) / samples;
      values.push(parameter.min + (parameter.max - parameter.min) * t);
    }
    // Fisher–Yates with the same deterministic stream.
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  });
  const points: EngineeringDesignPoint[] = [];
  for (let row = 0; row < samples; row += 1) {
    const current: Record<string, number> = {};
    parameters.forEach((parameter, column) => {
      current[parameter.name] = columns[column]![row]!;
    });
    points.push(pointFrom(parameters, current));
  }
  return points;
}

function pointFrom(
  parameters: EngineeringDesignParameter[],
  params: Record<string, number>,
): EngineeringDesignPoint {
  const label = parameters.map((parameter) => `${parameter.name}=${round(params[parameter.name]!)}`).join(', ');
  return {
    id: `dp-${hashLabel(label)}`,
    name: label || 'design point',
    params,
  };
}

function round(value: number): number {
  return Number(value.toPrecision(5));
}

function hashLabel(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Apply a design point to the study's physical inputs. Today a parameter is
 * addressed by property path:
 *   `material.<material name>.E`     → material property
 *   `step.<step id>.tolerance`       → solver tolerance
 *   `bc.<boundary condition name>.<component>` → prescribed component value
 * Unknown paths are ignored (a warning is returned) so a scan never crashes
 * on a renamed entity.
 */
export function applyDesignPoint(params: {
  point: EngineeringDesignPoint;
  materials: Array<{ name: string; properties: Record<string, number | number[]> }>;
  steps: EngineeringStep[];
  boundaryConditions: Array<{ name: string; components: Record<number, number> }>;
}): string[] {
  const warnings: string[] = [];
  for (const [path, value] of Object.entries(params.point.params)) {
    const [head, ...rest] = path.split('.');
    if (head === 'material' && rest.length >= 2) {
      const name = rest[0]!;
      const property = rest.slice(1).join('.');
      const material = params.materials.find((item) => item.name === name);
      if (!material) {
        warnings.push(`unknown material "${name}"`);
        continue;
      }
      material.properties[property] = value;
    } else if (head === 'step' && rest.length >= 2) {
      const step = params.steps.find((item) => item.id === rest[0]);
      if (!step) {
        warnings.push(`unknown step "${rest[0]}"`);
        continue;
      }
      const key = rest[1] as keyof EngineeringSolverConfig;
      (step.solver as unknown as Record<string, unknown>)[key] = value;
    } else if (head === 'bc' && rest.length >= 2) {
      const bc = params.boundaryConditions.find((item) => item.name === rest[0]);
      if (!bc) {
        warnings.push(`unknown boundary condition "${rest[0]}"`);
        continue;
      }
      bc.components[Number(rest[1])] = value;
    } else {
      warnings.push(`unknown parameter path "${path}"`);
    }
  }
  return warnings;
}
