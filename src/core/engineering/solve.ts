// ==========================================================================
// Engineering solver bridge (P2)
//
// Takes the neutral engineering model, converts the planar subset to the
// existing FEM core and runs one of four analyses:
//   static-structural  – plane stress / plane strain linear elasticity
//   steady-heat        – −∇·(k∇T) = q with temperature / flux BCs
//   transient-heat     – θ-scheme transient conduction
//   potential-flow     – Laplace potential, velocity = ∇φ (quick fluid)
// Results are returned as neutral EngineeringFields so post-processing never
// depends on which solver produced them.
// ==========================================================================

import {
  solveElasticity,
  type PlaneState,
} from '@/core/fem/physics/elasticity';
import { solvePoisson } from '@/core/fem/physics/poisson';
import { solveHeat } from '@/core/fem/physics/heat';
import { rectStructuredMesh } from '@/core/fem/mesh/domain';
import { nodeCount, triangleSignedArea, type EdgeElement, type PlanarMesh } from '@/core/fem/mesh/types';
import { vonMises } from '@/core/fem/post/stress';
import { toPlanarMesh } from './mesh';
import { coefficientByTag, materialProperty, resolveMaterial } from './materials';
import { ensureCase, normalizeStep } from './cases';
import { solve3DSteadyHeat } from './solve3d';
import type {
  BoundaryCondition,
  EngineeringCase,
  EngineeringField,
  EngineeringMesh,
  EngineeringStep,
  EngineeringStepKind,
  EngineeringStudy,
  EngineeringSolveResult,
} from './types';

export class EngineeringSolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineeringSolveError';
  }
}

export const SOLVER_NAME = 'ergalics-fem';
export const SOLVER_VERSION = '1.0.0';

export interface SolveEngineeringOptions {
  /** Step to run; defaults to the first step of the first case. */
  step?: EngineeringStep;
  /** Initial temperature for transient heat (default 0). */
  initialTemperature?: number;
  /** Volumetric source (heat / potential Poisson). */
  source?: number;
}

/** Nodes addressed by a BC target. Dimension 0 groups store node indices;
 *  higher dimensions store element indices, expanded to their nodes. */
export function targetNodeIndices(
  mesh: EngineeringMesh,
  target: { dimension: number; tag: number },
): number[] {
  const group = mesh.groups.find(
    (candidate) => candidate.dimension === target.dimension && candidate.tag === target.tag,
  );
  if (!group) return [];
  if (target.dimension === 0) return [...group.members];
  const nodes = new Set<number>();
  for (const elementIndex of group.members) {
    const element = mesh.elements[elementIndex];
    if (!element) continue;
    for (const node of element.nodes) nodes.add(node);
  }
  return [...nodes].sort((a, b) => a - b);
}

/** Boundary edges selected by a BC target: by edge tag when the planar mesh
 *  carries one, otherwise (element-group targets) the boundary edges whose
 *  endpoints all belong to the target elements. */
function boundaryEdgesForTarget(
  planar: PlanarMesh,
  mesh: EngineeringMesh,
  target: { dimension: number; tag: number },
): EdgeElement[] {
  const tagged = planar.boundaryEdges.filter((edge) => edge.tag === target.tag);
  if (tagged.length > 0) return tagged;
  if (target.dimension < 1) return [];
  const members = new Set(targetNodeIndices(mesh, target));
  return planar.boundaryEdges.filter((edge) => members.has(edge.a) && members.has(edge.b));
}

function coordinateKey(x: number, y: number): string {
  return `${x.toFixed(9)},${y.toFixed(9)}`;
}

function combinedDirichlet(
  mesh: EngineeringMesh,
  conditions: BoundaryCondition[],
  fallback: number,
): { nodes: number[]; value: (x: number, y: number) => number } | null {
  const valueByKey = new Map<string, number>();
  const nodes = new Set<number>();
  for (const condition of conditions) {
    const value = condition.components[0] ?? fallback;
    for (const index of targetNodeIndices(mesh, condition.target)) {
      const node = mesh.nodes[index];
      if (!node) continue;
      nodes.add(index);
      valueByKey.set(coordinateKey(node.x, node.y), value);
    }
  }
  if (nodes.size === 0) return null;
  return {
    nodes: [...nodes].sort((a, b) => a - b),
    value: (x, y) => valueByKey.get(coordinateKey(x, y)) ?? fallback,
  };
}

function fieldRange(
  name: string,
  values: Float64Array,
  components: number,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    // Magnitude for vectors, scalar value otherwise.
    let value = values[i]!;
    if (components > 1) {
      value = 0;
      for (let c = 0; c < components; c += 1) {
        const component = values[i + c] ?? 0;
        value += component * component;
      }
      value = Math.sqrt(value);
      i += components - 1;
    }
    // A non-finite entry means the solve diverged (typically a degenerate
    // element): propagate the failure instead of masking it, so a NaN field
    // can never be reported as a valid result.
    if (!Number.isFinite(value)) {
      throw new EngineeringSolveError(
        `${name} field contains non-finite values — the mesh is likely degenerate or the solve diverged`,
      );
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  // Empty arrays keep the legacy 0/0 display default.
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

function addRangeMetrics(metrics: Record<string, number>, name: string, field: EngineeringField): void {
  const range = fieldRange(name, field.values, field.components);
  metrics[`min_${name}`] = range.min;
  metrics[`max_${name}`] = range.max;
}

/** Run one solver step against a study. Throws EngineeringSolveError. */
export function solveEngineeringStudy(
  study: EngineeringStudy,
  options: SolveEngineeringOptions = {},
): EngineeringSolveResult {
  const step = normalizeStep(
    options.step ?? ensureCase(study.cases)[0]!.steps[0]!,
  );
  // 3-D tetrahedral steady heat: dispatch to the dedicated volume solver
  // (reuses the sparse CG kernel) before the 2-D planar conversion.
  const hasTet4 = study.mesh.elements.some((e) => e.type === 'tet4');
  if (hasTet4 && step.kind === 'steady-heat') {
    const result3d = solve3DSteadyHeat(study, { source: options.source ?? 0 });
    return {
      schema: 'ergalics.engineering-result/v1',
      stepId: step.id,
      stepName: step.name,
      kind: step.kind,
      solvedAt: Date.now(),
      fields: [result3d.field],
      metrics: {
        elementCount: study.mesh.elements.length,
        nodeCount: study.mesh.nodes.length,
        iterations: result3d.iterations,
        residual: result3d.residual,
        minTemperature: Math.min(...result3d.field.values),
        maxTemperature: Math.max(...result3d.field.values),
      },
      iterations: result3d.iterations,
      residual: result3d.residual,
      solver: { name: SOLVER_NAME, version: SOLVER_VERSION, algorithm: 'tet4-p1-cg', tolerance: step.solver.tolerance },
    } as EngineeringSolveResult;
  }
  const planar = toPlanarMesh(study.mesh);
  if (!planar) {
    throw new EngineeringSolveError(
      'mesh is not planarly solvable: only 2-D tri3/quad4 or 3-D tet4/steady-heat meshes are supported',
    );
  }
  // Degenerate elements (zero area / non-finite coordinates) silently produce
  // a singular system; reject them before assembly with a clear message
  // instead of returning a NaN field that looks like a valid result.
  for (let e = 0; e < planar.elements.length; e += 1) {
    const element = planar.elements[e]!;
    const area = Math.abs(triangleSignedArea(planar.nodes, element.a, element.b, element.c));
    if (!Number.isFinite(area) || area <= 0) {
      throw new EngineeringSolveError(
        `degenerate element ${e}: zero or non-finite area — check for duplicate or collinear nodes`,
      );
    }
  }
  // Element physical tags present in the mesh — per-tag materials are only
  // meaningful for tags that actually exist in the mesh.
  const elementTags = new Set<number>();
  for (const element of study.mesh.elements) {
    if (typeof element.group === 'number') elementTags.add(element.group);
  }
  const tags = elementTags.size > 0 ? [...elementTags] : [0];
  const fields: EngineeringField[] = [];
  const metrics: Record<string, number> = {};
  let iterations = 0;
  let residual = 0;

  if (step.kind === 'static-structural') {
    const E = coefficientByTag(study.materials, study.materialAssignment, 'E', 2.1e11, tags);
    const nu = coefficientByTag(study.materials, study.materialAssignment, 'nu', 0.3, tags);
    const constraints = new Map<number, { ux?: number; uy?: number }>();
    const tractions: Array<{ tags: number[]; tx: number; ty: number }> = [];
    const pressures: Array<{ edges: EdgeElement[]; p: number }> = [];
    const pointLoads: Array<{ node: number; fx: number; fy: number }> = [];

    for (const condition of study.boundaryConditions) {
      const nodes = targetNodeIndices(study.mesh, condition.target);
      if (nodes.length === 0) continue;
      if (condition.kind === 'displacement') {
        for (const node of nodes) {
          const current = constraints.get(node) ?? {};
          if (condition.components[0] !== undefined) current.ux = condition.components[0];
          if (condition.components[1] !== undefined) current.uy = condition.components[1];
          constraints.set(node, current);
        }
      } else if (condition.kind === 'force' || condition.kind === 'traction') {
        const fx = condition.components[0] ?? 0;
        const fy = condition.components[1] ?? 0;
        if (condition.target.dimension >= 1) {
          tractions.push({ tags: [condition.target.tag], tx: fx, ty: fy });
        } else {
          // Point force: the component values are total nodal loads.
          for (const node of nodes) pointLoads.push({ node, fx, fy });
        }
      } else if (condition.kind === 'pressure') {
        if (condition.target.dimension >= 1) {
          // A pressure is a scalar acting along the boundary normal, not a
          // constant (tx, ty) vector.
          pressures.push({
            edges: boundaryEdgesForTarget(planar, study.mesh, condition.target),
            p: condition.components[0] ?? 0,
          });
        } else {
          const fx = condition.components[0] ?? 0;
          const fy = condition.components[1] ?? 0;
          for (const node of nodes) pointLoads.push({ node, fx, fy });
        }
      }
    }

    if (constraints.size === 0) {
      throw new EngineeringSolveError(
        'no displacement constraint: add a displacement boundary condition on a node group',
      );
    }

    const result = solveElasticity({
      mesh: planar,
      E,
      nu,
      state: (step.solver.planeState ?? 'plane-stress') as PlaneState,
      thickness: step.solver.thickness ?? 1,
      constraints: [...constraints.entries()].map(([node, values]) => ({
        nodes: [node],
        ...(values.ux !== undefined ? { ux: values.ux } : {}),
        ...(values.uy !== undefined ? { uy: values.uy } : {}),
      })),
      tractions: tractions.map((traction) => ({
        edges: traction.tags,
        tx: traction.tx,
        ty: traction.ty,
      })),
      pressures: pressures.map((pressure) => ({ edges: pressure.edges, p: pressure.p })),
      pointLoads,
      cg: {
        tol: step.solver.tolerance,
        maxIter: step.solver.maxIterations,
      },
    });
    iterations = result.iterations;
    residual = result.residual;

    const n = nodeCount(planar);
    const displacement = new Float64Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      displacement[i * 3] = result.displacement[i * 2]!;
      displacement[i * 3 + 1] = result.displacement[i * 2 + 1]!;
      displacement[i * 3 + 2] = 0;
    }
    fields.push({ name: 'displacement', location: 'node', components: 3, values: displacement, unit: 'm' });
    fields.push({ name: 'vonMises', location: 'node', components: 1, values: result.nodalVonMises, unit: 'Pa' });
    fields.push({ name: 'stress', location: 'element', components: 3, values: result.elementStress, unit: 'Pa' });
    fields.push({ name: 'strain', location: 'element', components: 3, values: result.elementStrain, unit: '-' });
    metrics.maxDisplacement = result.maxDisplacement;
    addRangeMetrics(metrics, 'vonMises', fields[1]!);
    // min_stress / max_stress are the element von Mises invariant; the raw
    // stress field is a 3-vector, so a component-vector norm would not be a
    // standard stress measure.
    const elementVonMises = new Float64Array(planar.elements.length);
    for (let e = 0; e < elementVonMises.length; e += 1) {
      elementVonMises[e] = vonMises(
        result.elementStress[e * 3]!,
        result.elementStress[e * 3 + 1]!,
        result.elementStress[e * 3 + 2]!,
      );
    }
    const stressRange = fieldRange('stress', elementVonMises, 1);
    metrics.min_stress = stressRange.min;
    metrics.max_stress = stressRange.max;
  } else if (step.kind === 'steady-heat' || step.kind === 'transient-heat') {
    const k = coefficientByTag(study.materials, study.materialAssignment, 'k', 1, tags);
    const dirichlet = combinedDirichlet(
      study.mesh,
      study.boundaryConditions.filter((condition) => condition.kind === 'temperature'),
      0,
    );
    if (!dirichlet) {
      throw new EngineeringSolveError(
        'no temperature boundary condition: add a temperature BC on a node or edge group',
      );
    }
    const heatDirichlet = dirichlet;

    // Heat-flux (Neumann) BCs: ∫ q N ds added to the RHS. A positive value is
    // the flux INTO the body, consistent with the Poisson natural condition
    // k·∂T/∂n = q and with a positive volumetric source heating the body.
    const heatFluxSpecs: Array<{ edges: EdgeElement[]; flux: number }> = [];
    for (const condition of study.boundaryConditions) {
      if (condition.kind !== 'heat-flux') continue;
      const edges = boundaryEdgesForTarget(planar, study.mesh, condition.target);
      if (edges.length === 0) {
        throw new EngineeringSolveError(
          `heat-flux boundary condition "${condition.name}" matches no boundary edges ` +
            `(group ${condition.target.dimension}:${condition.target.tag})`,
        );
      }
      heatFluxSpecs.push({ edges, flux: condition.components[0] ?? 0 });
    }
    const neumann = heatFluxSpecs.length > 0
      ? heatFluxSpecs.map((spec) => ({ edges: spec.edges, flux: spec.flux }))
      : undefined;

    if (step.kind === 'steady-heat') {
      const result = solvePoisson({
        mesh: planar,
        k,
        source: () => options.source ?? 0,
        dirichlet: { nodes: heatDirichlet.nodes, value: heatDirichlet.value },
        neumann,
        cg: { tol: step.solver.tolerance, maxIter: step.solver.maxIterations },
      });
      iterations = result.iterations;
      residual = result.residual;
      fields.push({ name: 'temperature', location: 'node', components: 1, values: result.values, unit: 'K' });
      const nE = planar.elements.length;
      const fluxMagnitude = new Float64Array(nE);
      for (let e = 0; e < nE; e += 1) {
        fluxMagnitude[e] = Math.hypot(result.elementFlux[e * 2]!, result.elementFlux[e * 2 + 1]!);
      }
      fields.push({ name: 'heatFlux', location: 'element', components: 1, values: fluxMagnitude, unit: 'W/m²' });
      addRangeMetrics(metrics, 'temperature', fields[0]!);
      addRangeMetrics(metrics, 'heatFlux', fields[1]!);
    } else {
      const result = solveHeat({
        mesh: planar,
        k,
        // ρc per element tag: resolve each tag's material directly (the
        // Coefficient function form). The old rho[0]/cp[0] lookup silently
        // fell back to 1 whenever tag 0 was absent from the per-tag record,
        // corrupting the heat capacity by orders of magnitude.
        heatCapacity: (tag: number) => {
          const material = resolveMaterial(study.materials, study.materialAssignment, tag);
          return materialProperty(material, 'rho', 1) * materialProperty(material, 'cp', 1);
        },
        initial: () => options.initialTemperature ?? 0,
        dirichlet: { nodes: heatDirichlet.nodes, value: heatDirichlet.value },
        neumann,
        dt: step.solver.dt ?? 0.01,
        steps: step.solver.timeSteps ?? 20,
        theta: step.solver.theta ?? 1,
        cg: { tol: step.solver.tolerance, maxIter: step.solver.maxIterations },
      });
      iterations = result.iterations;
      residual = result.residual;
      fields.push({ name: 'temperature', location: 'node', components: 1, values: result.values, unit: 'K', time: result.times[result.times.length - 1] });
      fields.push({
        name: 'temperatureHistory',
        location: 'node',
        components: result.history.length,
        values: flattenHistory(result.history),
        unit: 'K',
      });
      metrics.finalTime = result.times[result.times.length - 1] ?? 0;
      metrics.totalEnergy = result.energyHistory[result.energyHistory.length - 1] ?? 0;
      addRangeMetrics(metrics, 'temperature', fields[0]!);
    }
  } else if (step.kind === 'potential-flow') {
    const dirichlet = combinedDirichlet(
      study.mesh,
      study.boundaryConditions.filter(
        (condition) => condition.kind === 'pressure' || condition.kind === 'displacement',
      ),
      0,
    );
    if (!dirichlet) {
      throw new EngineeringSolveError(
        'potential flow needs at least one pressure/potential boundary condition',
      );
    }
    const result = solvePoisson({
      mesh: planar,
      k: 1,
      source: () => options.source ?? 0,
      dirichlet: { nodes: dirichlet.nodes, value: dirichlet.value },
      cg: { tol: step.solver.tolerance, maxIter: step.solver.maxIterations },
    });
    iterations = result.iterations;
    residual = result.residual;
    fields.push({ name: 'potential', location: 'node', components: 1, values: result.values, unit: 'm²/s' });
    const nE = planar.elements.length;
    const velocity = new Float64Array(nE * 3);
    const speed = new Float64Array(nE);
    for (let e = 0; e < nE; e += 1) {
      const vx = result.elementGradients[e * 2]!;
      const vy = result.elementGradients[e * 2 + 1]!;
      velocity[e * 3] = vx;
      velocity[e * 3 + 1] = vy;
      velocity[e * 3 + 2] = 0;
      speed[e] = Math.hypot(vx, vy);
    }
    fields.push({ name: 'velocity', location: 'element', components: 3, values: velocity, unit: 'm/s' });
    fields.push({ name: 'speed', location: 'element', components: 1, values: speed, unit: 'm/s' });
    addRangeMetrics(metrics, 'potential', fields[0]!);
    addRangeMetrics(metrics, 'speed', fields[2]!);
  } else {
    throw new EngineeringSolveError(`unsupported step kind: ${String(step.kind)}`);
  }

  metrics.iterations = iterations;
  metrics.residual = residual;
  metrics.nodeCount = study.mesh.nodes.length;
  metrics.elementCount = study.mesh.elements.length;

  return {
    schema: 'ergalics.engineering-result/v1',
    stepId: step.id,
    stepName: step.name,
    kind: step.kind,
    solvedAt: Date.now(),
    fields,
    metrics,
    iterations,
    residual,
    solver: {
      name: SOLVER_NAME,
      version: SOLVER_VERSION,
      algorithm: step.solver.algorithm,
      tolerance: step.solver.tolerance,
    },
  };
}

function flattenHistory(history: Float64Array[]): Float64Array {
  const length = history.reduce((sum, snapshot) => sum + snapshot.length, 0);
  const out = new Float64Array(length);
  let offset = 0;
  for (const snapshot of history) {
    out.set(snapshot, offset);
    offset += snapshot.length;
  }
  return out;
}

// --------------------------------------------------------------------------
// Analytic benchmark (acceptance: toPlanarMesh mesh solves within threshold)
// --------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  /** Max |u_fe − u_exact| / max |u_exact| on the same mesh. */
  relativeError: number;
  maxDisplacement: number;
  expectedMaxDisplacement: number;
  order: number | null;
  meshSize: number;
}

export const UNIAXIAL_BENCHMARK = {
  E: 200000,
  nu: 0.3,
  sigma0: 100,
  width: 1,
  height: 1,
  exactUx: (x: number, E = 200000, sigma0 = 100): number => (sigma0 * x) / E,
  exactUy: (_y: number, _nu = 0.3, _sigma0 = 100): number => 0,
};

function benchmarkAt(n: number): { error: number; max: number; expected: number; nodes: number } {
  const mesh = rectStructuredMesh(UNIAXIAL_BENCHMARK.width, UNIAXIAL_BENCHMARK.height, n, n);
  const result = solveElasticity({
    mesh,
    E: UNIAXIAL_BENCHMARK.E,
    nu: UNIAXIAL_BENCHMARK.nu,
    state: 'plane-stress',
    thickness: 1,
    constraints: [
      // left edge (tag 4): ux = 0
      ...Array.from({ length: n + 1 }, (_, row) => ({
        nodes: [row * (n + 1)],
        ux: 0,
      })),
      // bottom edge (tag 1): uy = 0
      ...Array.from({ length: n + 1 }, (_, col) => ({
        nodes: [col],
        uy: 0,
      })),
    ],
    tractions: [{ edges: [2], tx: UNIAXIAL_BENCHMARK.sigma0 }],
    cg: { tol: 1e-12, maxIter: 5000 },
  });
  const nodes = nodeCount(mesh);
  let maxError = 0;
  let maxExpected = 0;
  for (let i = 0; i < nodes; i += 1) {
    const x = mesh.nodes[i * 2]!;
    const expected = UNIAXIAL_BENCHMARK.exactUx(x);
    maxExpected = Math.max(maxExpected, Math.abs(expected));
    const error = Math.abs(result.displacement[i * 2]! - expected);
    maxError = Math.max(maxError, error);
  }
  return {
    error: maxExpected > 0 ? maxError / maxExpected : 0,
    max: result.maxDisplacement,
    expected: maxExpected,
    nodes,
  };
}

/**
 * Run the uniaxial-tension benchmark at two resolutions and report the
 * relative error plus the observed convergence order.
 */
export function runUniaxialBenchmark(): BenchmarkResult {
  const coarse = benchmarkAt(8);
  const fine = benchmarkAt(16);
  const order =
    coarse.error > 0 && fine.error > 0
      ? Math.log(coarse.error / fine.error) / Math.log(2)
      : null;
  return {
    name: 'Uniaxial tension (plane stress)',
    relativeError: fine.error,
    maxDisplacement: fine.max,
    expectedMaxDisplacement: fine.expected,
    order,
    meshSize: fine.nodes,
  };
}

/** Snapshot form of a solve result for `.clproj` / workspace JSON. */
export interface EngineeringResultSnapshot {
  schema: EngineeringSolveResult['schema'];
  stepId: string;
  stepName: string;
  kind: EngineeringStepKind;
  solvedAt: number;
  fields: Array<Omit<EngineeringField, 'values'> & { values: number[] }>;
  metrics: Record<string, number>;
  iterations: number;
  residual: number;
  solver: EngineeringSolveResult['solver'];
}

export function toResultSnapshot(result: EngineeringSolveResult): EngineeringResultSnapshot {
  return {
    ...result,
    fields: result.fields.map((field) => ({ ...field, values: Array.from(field.values) })),
  };
}

export function fromResultSnapshot(raw: unknown): EngineeringSolveResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as Partial<EngineeringResultSnapshot>;
  if (!Array.isArray(snapshot.fields)) return null;
  return {
    schema: 'ergalics.engineering-result/v1',
    stepId: snapshot.stepId ?? '',
    stepName: snapshot.stepName ?? '',
    kind: snapshot.kind ?? 'static-structural',
    solvedAt: snapshot.solvedAt ?? 0,
    fields: snapshot.fields.map((field) => ({
      name: field.name,
      location: field.location ?? 'node',
      components: field.components ?? 1,
      values: Float64Array.from(field.values ?? []),
      ...(typeof field.time === 'number' ? { time: field.time } : {}),
      ...(field.unit ? { unit: field.unit } : {}),
    })),
    metrics: snapshot.metrics ?? {},
    iterations: snapshot.iterations ?? 0,
    residual: snapshot.residual ?? 0,
    solver: snapshot.solver ?? {
      name: SOLVER_NAME,
      version: SOLVER_VERSION,
      algorithm: 'cg',
      tolerance: 1e-10,
    },
  };
}

export type { EngineeringCase };
