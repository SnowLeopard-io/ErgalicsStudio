// ==========================================================================
// Ergalics Studio — engineering domain model (pure TS)
//
// The missing layer between "a file on disk" and "a solvable problem":
// every CAD/CAE format is parsed into these neutral objects. Adapters never
// leak their own syntax upstream, and solvers/visualisers never parse text.
//
// Design rules:
//   • Nodes are a flat XYZ Float64Array (3 components, even for 2D meshes).
//   • Elements are typed by a small closed vocabulary shared by all formats.
//   • Groups are physical/entity groups, NOT node ids — renaming a node must
//     not change which surface a boundary condition is attached to.
//   • Fields are raw arrays plus a location; time steps stay separate.
// ==========================================================================

export const ENGINEERING_MODEL_SCHEMA = 'ergalics.engineering/v1';

/** Closed element vocabulary; one entry per supported topology. */
export type ElementType =
  | 'point'
  | 'line2' | 'line3'
  | 'tri3' | 'tri6'
  | 'quad4' | 'quad8' | 'quad9'
  | 'tet4' | 'tet10'
  | 'hex8' | 'hex20'
  | 'wedge6'
  | 'pyramid5'
  | 'polygon'
  | 'polyhedron';

/** Number of corner nodes for each known element type. */
export const ELEMENT_CORNER_COUNT: Readonly<Record<ElementType, number>> = {
  point: 1,
  line2: 2, line3: 2,
  tri3: 3, tri6: 3,
  quad4: 4, quad8: 4, quad9: 4,
  tet4: 4, tet10: 4,
  hex8: 8, hex20: 8,
  wedge6: 6,
  pyramid5: 5,
  polygon: 0,
  polyhedron: 0,
};

export interface EngineeringNode {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface EngineeringElement {
  id: number;
  type: ElementType;
  /** Zero-based node indices into EngineeringMesh.nodes. */
  nodes: number[];
  /** Format-specific physical group tag, when present. */
  group?: number;
}

/** A named selection of mesh entities (physical group / nset / elset). */
export interface EngineeringGroup {
  /** 0 = nodes, 1 = edges, 2 = faces, 3 = volumes. */
  dimension: number;
  tag: number;
  name: string;
  /** Node indices for dimension 0, element indices otherwise. */
  members: number[];
}

export interface EngineeringMesh {
  nodes: EngineeringNode[];
  elements: EngineeringElement[];
  groups: EngineeringGroup[];
  /** Bounding box [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: [number, number, number, number, number, number];
}

export type FieldLocation = 'node' | 'element' | 'integration';

export interface EngineeringField {
  name: string;
  location: FieldLocation;
  /** Number of scalar components per entry (1 = scalar, 3 = vector). */
  components: number;
  values: Float64Array;
  /** Physical time/frequency of this step, when known. */
  time?: number;
  unit?: string;
}

export type BoundaryKind =
  | 'displacement'
  | 'force'
  | 'traction'
  | 'temperature'
  | 'heat-flux'
  | 'pressure'
  | 'electric-potential'
  | 'other';

export interface BoundaryCondition {
  name: string;
  kind: BoundaryKind;
  /** Group tag and dimension this condition acts on. */
  target: { dimension: number; tag: number };
  /** Component index → prescribed value (e.g. {0: 0, 1: 0} fixes x/y). */
  components: Record<number, number>;
  /** Raw format expression, preserved when it cannot be reduced to a number. */
  expression?: string;
}

export interface EngineeringMaterial {
  name: string;
  /** Engineering properties: E, nu, rho, k, cp, … (SI by default). */
  properties: Record<string, number | number[]>;
}

export type EngineeringFormat =
  | 'gmsh'
  | 'abaqus'
  | 'vtk'
  | 'vtu'
  | 'dxf'
  | 'step';

// ---- geometry (P3, lightweight B-rep-free representation) -----------------

export type GeometryEntityKind = 'point' | 'line' | 'polyline' | 'circle' | 'arc';

/** One drawable geometry entity. Points are XYZ; `closed` closes a polyline. */
export interface GeometryEntity {
  id: string;
  kind: GeometryEntityKind;
  points: Array<[number, number, number]>;
  closed?: boolean;
  layer?: string;
}

/** Lightweight geometry model produced by the DXF / STEP readers. */
export interface EngineeringGeometry {
  schema: 'ergalics.geometry/v1';
  sourceFormat: 'dxf' | 'step';
  entities: GeometryEntity[];
  bounds: [number, number, number, number, number, number];
  layers: string[];
  metadata: Record<string, string>;
}

// ---- solver / case model (P2, P4) -----------------------------------------

export type EngineeringStepKind =
  | 'static-structural'
  | 'steady-heat'
  | 'transient-heat'
  | 'potential-flow';

export interface EngineeringSolverConfig {
  /** Linear solver identifier (only 'cg' ships today, kept open-ended). */
  algorithm: string;
  tolerance: number;
  maxIterations: number;
  /** Plane stress / plane strain for structural steps. */
  planeState?: 'plane-stress' | 'plane-strain';
  thickness?: number;
  /** Transient heat controls. */
  dt?: number;
  timeSteps?: number;
  theta?: number;
}

export interface EngineeringStep {
  id: string;
  name: string;
  kind: EngineeringStepKind;
  solver: EngineeringSolverConfig;
}

export interface EngineeringDesignParameter {
  name: string;
  min: number;
  max: number;
  levels: number;
}

export interface EngineeringDesignPoint {
  id: string;
  name: string;
  params: Record<string, number>;
}

export interface EngineeringDesignSpace {
  parameters: EngineeringDesignParameter[];
  points: EngineeringDesignPoint[];
}

export interface EngineeringCase {
  name: string;
  steps: EngineeringStep[];
  design: EngineeringDesignSpace;
}

/** Element group tag → material name. Omitted tags use the first material. */
export type MaterialAssignment = Record<string, string>;

export interface EngineeringStudy {
  schema: typeof ENGINEERING_MODEL_SCHEMA;
  name: string;
  sourceFormat: EngineeringFormat;
  mesh: EngineeringMesh;
  materials: EngineeringMaterial[];
  boundaryConditions: BoundaryCondition[];
  fields: EngineeringField[];
  /** Original format metadata worth keeping (sections, units, version). */
  metadata: Record<string, string>;
  /** Imported geometry (DXF / STEP). Mesh formats leave this undefined. */
  geometry?: EngineeringGeometry;
  /** Load case / solver steps (P2/P4). */
  cases?: EngineeringCase[];
  /** Physical element-group tag → material name. */
  materialAssignment?: MaterialAssignment;
}

/** Solver identity written into results and repro fingerprints. */
export interface EngineeringSolverIdentity {
  name: string;
  version: string;
  algorithm: string;
  tolerance: number;
}

/** Result of one engineering step (fields + scalar metrics). */
export interface EngineeringSolveResult {
  schema: 'ergalics.engineering-result/v1';
  stepId: string;
  stepName: string;
  kind: EngineeringStepKind;
  solvedAt: number;
  fields: EngineeringField[];
  metrics: Record<string, number>;
  iterations: number;
  residual: number;
  solver: EngineeringSolverIdentity;
}

export function emptyMesh(): EngineeringMesh {
  return { nodes: [], elements: [], groups: [], bounds: [0, 0, 0, 0, 0, 0] };
}

export function meshBounds(nodes: readonly EngineeringNode[]): EngineeringMesh['bounds'] {
  if (nodes.length === 0) return [0, 0, 0, 0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.z < minZ) minZ = node.z;
    if (node.x > maxX) maxX = node.x;
    if (node.y > maxY) maxY = node.y;
    if (node.z > maxZ) maxZ = node.z;
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

export function makeStudy(
  name: string,
  sourceFormat: EngineeringFormat,
  mesh: EngineeringMesh,
  extra: Partial<Omit<EngineeringStudy, 'schema' | 'name' | 'sourceFormat' | 'mesh'>> = {},
): EngineeringStudy {
  return {
    schema: ENGINEERING_MODEL_SCHEMA,
    name,
    sourceFormat,
    mesh: { ...mesh, bounds: mesh.bounds.some((v) => v !== 0) ? mesh.bounds : meshBounds(mesh.nodes) },
    materials: extra.materials ?? [],
    boundaryConditions: extra.boundaryConditions ?? [],
    fields: extra.fields ?? [],
    metadata: extra.metadata ?? {},
    ...(extra.geometry ? { geometry: extra.geometry } : {}),
    ...(extra.cases ? { cases: extra.cases } : {}),
    ...(extra.materialAssignment ? { materialAssignment: extra.materialAssignment } : {}),
  };
}
