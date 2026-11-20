// ==========================================================================
// Industrial sample studies (shown in the example dialog's Industrial tab
// and in the shared import window).
//
// Every sample is generated in code so it needs no bundled binary asset and
// always matches the current neutral model. The studies are deliberately
// solvable out of the box: each one carries a material, a solver step and the
// boundary conditions that step needs.
// ==========================================================================

import { rectStructuredMesh } from '@/core/fem/mesh/domain';
import type { PlanarMesh } from '@/core/fem/mesh/types';
import { materialFromTemplate } from './materials';
import { makeStep } from './cases';
import { geometryToStudy, parseDxf, parseStep } from './geometry';
import { makeStudy } from './types';
import { parseAbaqus } from './formats/abaqus';
import { parseAnsys } from './formats/ansys';
import { parseNastran } from './formats/nastran';
import { parseOpenfoam } from './formats/openfoam';
import { parseVtk } from './formats/vtk';
import type {
  BoundaryCondition,
  EngineeringFormat,
  EngineeringGroup,
  EngineeringMaterial,
  EngineeringMesh,
  EngineeringStep,
  EngineeringStudy,
} from './types';

export interface IndustrialExample {
  id: string;
  /** Registry-style body title, localised at render time. */
  nameI18n: Record<'zh-CN' | 'en-US', string>;
  descriptionI18n: Record<'zh-CN' | 'en-US', string>;
  /** Badge shown on the example card (format / analysis family). */
  format: EngineeringFormat;
  /** Canvas tool opened after loading; defaults to the mesh viewer. */
  toolId?: string;
  build: () => EngineeringStudy;
}

/**
 * Convert a structured FEM rectangle into the neutral mesh.
 *
 * The FEM boundary edges carry tags 1..4 (bottom/right/top/left). We expose
 * each tag twice: a dimension-0 node group (precise Dirichlet targets) and a
 * dimension-1 element group (the target shape traction conditions expect).
 */
function engineeringRectangle(
  planar: PlanarMesh,
  options: { x?: number; y?: number; width?: number; height?: number } = {},
): EngineeringMesh {
  const x0 = options.x ?? 0;
  const y0 = options.y ?? 0;
  const width = options.width ?? 1;
  const height = options.height ?? 1;

  const nodes = [];
  for (let i = 0; i < planar.nodes.length; i += 2) {
    nodes.push({
      id: i / 2 + 1,
      x: x0 + planar.nodes[i]! * width,
      y: y0 + planar.nodes[i + 1]! * height,
      z: 0,
    });
  }

  const elements = planar.elements.map((element, index) => ({
    id: index + 1,
    type: 'tri3' as const,
    nodes: [element.a, element.b, element.c],
    group: element.tag,
  }));

  // Edge tag → adjacent element indices, and edge tag → node indices.
  const tagByEdgeKey = new Map<string, number>();
  const nodeTags = new Map<number, Set<number>>();
  for (const edge of planar.boundaryEdges) {
    if (!edge.tag) continue;
    tagByEdgeKey.set(`${Math.min(edge.a, edge.b)}_${Math.max(edge.a, edge.b)}`, edge.tag);
    const nodeSet = nodeTags.get(edge.tag) ?? new Set<number>();
    nodeSet.add(edge.a);
    nodeSet.add(edge.b);
    nodeTags.set(edge.tag, nodeSet);
  }
  const elementTags = new Map<number, Set<number>>();
  planar.elements.forEach((element, index) => {
    const pairs = [
      [element.a, element.b],
      [element.b, element.c],
      [element.c, element.a],
    ] as const;
    for (const [a, b] of pairs) {
      const tag = tagByEdgeKey.get(`${Math.min(a, b)}_${Math.max(a, b)}`);
      if (!tag) continue;
      const set = elementTags.get(tag) ?? new Set<number>();
      set.add(index);
      elementTags.set(tag, set);
    }
  });

  const groups: EngineeringGroup[] = [];
  for (const [tag, members] of nodeTags) {
    groups.push({
      dimension: 0,
      tag,
      name: edgeName(tag),
      members: [...members].sort((a, b) => a - b),
    });
  }
  for (const [tag, members] of elementTags) {
    groups.push({
      dimension: 1,
      tag,
      name: edgeName(tag),
      members: [...members].sort((a, b) => a - b),
    });
  }

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  return {
    nodes,
    elements,
    groups,
    bounds: [Math.min(...xs), Math.min(...ys), 0, Math.max(...xs), Math.max(...ys), 0],
  };
}

function edgeName(tag: number): string {
  switch (tag) {
    case 1: return 'bottom';
    case 2: return 'right';
    case 3: return 'top';
    case 4: return 'left';
    default: return `edge ${tag}`;
  }
}

function steel(name = 'Steel Q235') {
  const material = materialFromTemplate('steel-q235');
  return material ? { ...material, name } : null;
}

function aluminum(name = 'Aluminium 6061') {
  const material = materialFromTemplate('aluminum-6061');
  return material ? { ...material, name } : null;
}

function copper(name = 'Copper') {
  const material = materialFromTemplate('copper');
  return material ? { ...material, name } : null;
}

function studyWith(
  name: string,
  mesh: EngineeringMesh,
  material: ReturnType<typeof steel>,
  step: ReturnType<typeof makeStep>,
  boundaryConditions: BoundaryCondition[],
): EngineeringStudy {
  return makeStudy(name, 'gmsh', mesh, {
    materials: material ? [material] : [],
    boundaryConditions,
    cases: [{
      name: step.name,
      steps: [step],
      design: { parameters: [], points: [] },
    }],
    metadata: { example: 'industrial' },
  });
}

const plateTension = (): EngineeringStudy => {
  const mesh = engineeringRectangle(rectStructuredMesh(1, 1, 32, 16), { width: 2, height: 1 });
  return studyWith(
    'Plate tension',
    mesh,
    steel(),
    makeStep('Static tension', 'static-structural', { thickness: 0.01 }),
    [
      { name: 'Fixed edge', kind: 'displacement', target: { dimension: 0, tag: 4 }, components: { 0: 0, 1: 0 } },
      { name: 'Pulled edge', kind: 'traction', target: { dimension: 1, tag: 2 }, components: { 0: 5e6, 1: 0 } },
    ],
  );
};

const cantileverBeam = (): EngineeringStudy => {
  const mesh = engineeringRectangle(rectStructuredMesh(1, 1, 36, 8), { width: 1, height: 0.15 });
  return studyWith(
    'Cantilever beam',
    mesh,
    aluminum(),
    makeStep('Tip load', 'static-structural', { thickness: 0.02 }),
    [
      { name: 'Wall', kind: 'displacement', target: { dimension: 0, tag: 4 }, components: { 0: 0, 1: 0 } },
      { name: 'Tip load', kind: 'traction', target: { dimension: 1, tag: 2 }, components: { 0: 0, 1: -2e5 } },
    ],
  );
};

const wallHeat = (): EngineeringStudy => {
  const mesh = engineeringRectangle(rectStructuredMesh(1, 1, 40, 8), { width: 1, height: 0.2 });
  return studyWith(
    'Wall heat conduction',
    mesh,
    copper(),
    makeStep('Steady heat', 'steady-heat'),
    [
      { name: 'Hot wall', kind: 'temperature', target: { dimension: 0, tag: 4 }, components: { 0: 373.15 } },
      { name: 'Cold wall', kind: 'temperature', target: { dimension: 0, tag: 2 }, components: { 0: 293.15 } },
    ],
  );
};

const channelFlow = (): EngineeringStudy => {
  const mesh = engineeringRectangle(rectStructuredMesh(1, 1, 48, 12), { width: 4, height: 1 });
  return makeStudy('Channel potential flow', 'gmsh', mesh, {
    materials: [{
      name: 'Water',
      properties: { rho: 1000, nu: 1e-6, k: 0.6, cp: 4180 },
    }],
    boundaryConditions: [
      { name: 'Inlet', kind: 'pressure', target: { dimension: 0, tag: 4 }, components: { 0: 1 } },
      { name: 'Outlet', kind: 'pressure', target: { dimension: 0, tag: 2 }, components: { 0: 0 } },
    ],
    cases: [{
      name: 'Potential flow',
      steps: [makeStep('Potential flow', 'potential-flow')],
      design: { parameters: [], points: [] },
    }],
    metadata: { example: 'industrial' },
  });
};

/** A 3-D triangular prism split into three tetrahedra, for the volume solver. */
const block3dHeat = (): EngineeringStudy => {
  const mesh: EngineeringMesh = {
    nodes: [
      { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 },
      { id: 3, x: 0, y: 1, z: 0 }, { id: 4, x: 0, y: 0, z: 1 },
      { id: 5, x: 1, y: 0, z: 1 }, { id: 6, x: 0, y: 1, z: 1 },
    ],
    // Canonical prism → 3 tetrahedra sharing the (2,3,4,5) diagonal.
    elements: [
      { id: 1, type: 'tet4', nodes: [0, 1, 2, 4] },
      { id: 2, type: 'tet4', nodes: [0, 2, 3, 4] },
      { id: 3, type: 'tet4', nodes: [2, 3, 4, 5] },
    ],
    groups: [
      { dimension: 0, tag: 1, name: 'Bottom (hot)', members: [0, 1, 2] },
      { dimension: 0, tag: 2, name: 'Top (cold, reference)', members: [3] },
    ],
    bounds: [0, 0, 0, 1, 1, 1],
  };
  return makeStudy('3-D block conduction', 'gmsh', mesh, {
    materials: [{ name: 'Steel', properties: { k: 45, rho: 7850, cp: 460 } }],
    boundaryConditions: [
      { name: 'Hot face', kind: 'temperature', target: { dimension: 0, tag: 1 }, components: { 0: 373.15 } },
      { name: 'Cold face', kind: 'temperature', target: { dimension: 0, tag: 2 }, components: { 0: 293.15 } },
    ],
    cases: [{
      name: 'Steady heat 3-D',
      steps: [makeStep('Steady heat (3-D)', 'steady-heat')],
      design: { parameters: [], points: [] },
    }],
    metadata: { example: 'industrial', analysis: '3d-volume' },
  });
};

/**
 * Structured tetrahedral mesh for a solid region described by a per-cell
 * inclusion test. Every included hex cell splits into the same six
 * 0–6-diagonal tets used by the imported decks, so neighbouring cells share
 * conforming faces. Grid nodes outside the solid are compacted away, which
 * keeps bounds tight and makes plane-based face groups describe the real
 * solid (e.g. the L-bracket's hot face is the actual L footprint).
 */
function shapeTetMesh(options: {
  nx: number;
  ny: number;
  nz: number;
  size: [number, number, number];
  include: (x: number, y: number, z: number) => boolean;
}): EngineeringMesh {
  const { nx, ny, nz, size, include } = options;
  const [sx, sy, sz] = size;
  const id = (i: number, j: number, k: number) => (k * (ny + 1) + j) * (nx + 1) + i;
  const gridNodes: Array<{ id: number; x: number; y: number; z: number }> = [];
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        gridNodes.push({ id: id(i, j, k), x: (i * sx) / nx, y: (j * sy) / ny, z: (k * sz) / nz });
      }
    }
  }
  const rawTets: Array<[number, number, number, number]> = [];
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (!include(((i + 0.5) * sx) / nx, ((j + 0.5) * sy) / ny, ((k + 0.5) * sz) / nz)) continue;
        const v = [
          id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k),
          id(i, j, k + 1), id(i + 1, j, k + 1), id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1),
        ] as const;
        rawTets.push(
          [v[0], v[1], v[2], v[6]],
          [v[0], v[2], v[3], v[6]],
          [v[0], v[3], v[7], v[6]],
          [v[0], v[7], v[4], v[6]],
          [v[0], v[4], v[5], v[6]],
          [v[0], v[5], v[1], v[6]],
        );
      }
    }
  }
  const used = new Set<number>();
  for (const tet of rawTets) for (const node of tet) used.add(node);
  const remap = new Map<number, number>();
  const nodes: EngineeringMesh['nodes'] = [];
  for (const gn of gridNodes) {
    if (!used.has(gn.id)) continue;
    remap.set(gn.id, nodes.length);
    nodes.push({ id: nodes.length + 1, x: gn.x, y: gn.y, z: gn.z });
  }
  const elements = rawTets.map((tet, index) => ({
    id: index + 1,
    type: 'tet4' as const,
    nodes: tet.map((node) => remap.get(node)!),
  }));
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const zs = nodes.map((node) => node.z);
  return {
    nodes,
    elements,
    groups: [],
    bounds: [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  };
}

/** Wire a generated solid into a solvable 3-D steady-heat study. */
function solidHeatStudy(
  name: string,
  mesh: EngineeringMesh,
  material: EngineeringMaterial,
  axis: 'x' | 'z',
): EngineeringStudy {
  const hot = addGroup(mesh, 'Hot face', 0, nodeMembersOn(mesh, axis, 'min'));
  const cold = addGroup(mesh, 'Cold face', 0, nodeMembersOn(mesh, axis, 'max'));
  return makeStudy(name, 'gmsh', mesh, {
    materials: [material],
    boundaryConditions: [
      { name: 'Hot face', kind: 'temperature', target: { dimension: 0, tag: hot }, components: { 0: 373.15 } },
      { name: 'Cold face', kind: 'temperature', target: { dimension: 0, tag: cold }, components: { 0: 293.15 } },
    ],
    cases: [{
      name: 'Steady heat 3-D',
      steps: [makeStep('Steady heat (3-D)', 'steady-heat')],
      design: { parameters: [], points: [] },
    }],
    metadata: { example: 'industrial', analysis: '3d-volume' },
  });
}

const beam3dHeat = (): EngineeringStudy =>
  solidHeatStudy(
    '3-D beam conduction',
    shapeTetMesh({ nx: 16, ny: 4, nz: 4, size: [2, 0.5, 0.5], include: () => true }),
    materialFromTemplate('steel-q235')!,
    'x',
  );

const lBracket3dHeat = (): EngineeringStudy =>
  solidHeatStudy(
    'L-bracket conduction',
    shapeTetMesh({
      nx: 12, ny: 12, nz: 4, size: [1, 1, 0.4],
      include: (x, y) => x <= 0.45 || y <= 0.45,
    }),
    materialFromTemplate('steel-q235')!,
    'z',
  );

const perforatedPlate3dHeat = (): EngineeringStudy =>
  solidHeatStudy(
    'Perforated plate conduction',
    shapeTetMesh({
      nx: 16, ny: 16, nz: 3, size: [1.6, 1.6, 0.3],
      include: (x, y) => Math.hypot(x - 0.8, y - 0.8) > 0.2,
    }),
    materialFromTemplate('copper')!,
    'x',
  );

const hollowTube3dHeat = (): EngineeringStudy =>
  solidHeatStudy(
    'Hollow cylinder conduction',
    shapeTetMesh({
      nx: 16, ny: 16, nz: 6, size: [1, 1, 1],
      include: (x, y) => {
        const r = Math.hypot(x - 0.5, y - 0.5);
        return r > 0.22 && r < 0.45;
      },
    }),
    materialFromTemplate('steel-q235')!,
    'z',
  );

// --------------------------------------------------------------------------
// Imported-format samples
//
// These examples ship a representative ASCII deck instead of building the
// neutral mesh directly, so loading one exercises the real parser path and the
// card badge matches the file format. The meshes are moderately sized (tens to
// a few hundred elements) and every study that supports it comes wired with a
// step plus boundary conditions, so it can be solved immediately.
// --------------------------------------------------------------------------

const GROUP_EPS = 1e-9;

function addGroup(mesh: EngineeringMesh, name: string, dimension: number, members: number[]): number {
  const tag = mesh.groups.reduce((max, group) => Math.max(max, group.tag), 0) + 1;
  mesh.groups.push({ dimension, tag, name, members });
  return tag;
}

function planeValue(mesh: EngineeringMesh, axis: 'x' | 'y' | 'z', side: 'min' | 'max'): number {
  const values = mesh.nodes.map((node) => node[axis]);
  return side === 'min' ? Math.min(...values) : Math.max(...values);
}

function onPlane(mesh: EngineeringMesh, axis: 'x' | 'y' | 'z', side: 'min' | 'max', index: number): boolean {
  const value = planeValue(mesh, axis, side);
  return Math.abs(mesh.nodes[index]![axis] - value) <= GROUP_EPS * Math.max(1, Math.abs(value));
}

function nodeMembersOn(mesh: EngineeringMesh, axis: 'x' | 'y' | 'z', side: 'min' | 'max'): number[] {
  return mesh.nodes.map((_, index) => index).filter((index) => onPlane(mesh, axis, side, index));
}

/**
 * Elements that own an edge on the plane — i.e. at least one node lies on it.
 *
 * A 2-D boundary layer is never fully on the plane (the cells extend inwards),
 * so requiring every node to match would select nothing and leave a traction
 * without any tagged boundary edge. Dimension-1 groups are element selections:
 * `toPlanarMesh` tags the boundary edges of those elements, which is exactly
 * what a traction condition consumes.
 */
function elementMembersOn(mesh: EngineeringMesh, axis: 'x' | 'y' | 'z', side: 'min' | 'max'): number[] {
  return mesh.elements
    .map((_, index) => index)
    .filter((index) => mesh.elements[index]!.nodes.some((node) => onPlane(mesh, axis, side, node)));
}

/** Attach a solver step and boundary conditions to a parsed study. */
function finishImported(
  study: EngineeringStudy,
  step: EngineeringStep,
  boundaryConditions: BoundaryCondition[],
  materials?: EngineeringMaterial[],
  metadata: Record<string, string> = {},
): EngineeringStudy {
  return {
    ...study,
    materials: materials ?? study.materials,
    boundaryConditions,
    cases: [{ name: step.name, steps: [step], design: { parameters: [], points: [] } }],
    metadata: { ...study.metadata, example: 'industrial', ...metadata },
  };
}

/** 16×8 CPS4 quad plate — 153 nodes / 128 elements. */
function abaqusQuadPlateDeck(): string {
  const nx = 16;
  const ny = 8;
  const width = 1.6;
  const height = 0.8;
  const id = (i: number, j: number) => j * (nx + 1) + i + 1;
  const lines = ['*HEADING', 'Quad plate · CPS4 · 16×8', '*NODE, NSET=Nall'];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      lines.push(`${id(i, j)}, ${((i * width) / nx).toFixed(4)}, ${((j * height) / ny).toFixed(4)}, 0.`);
    }
  }
  lines.push('*ELEMENT, TYPE=CPS4, ELSET=Eall');
  let element = 1;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      lines.push(`${element++}, ${id(i, j)}, ${id(i + 1, j)}, ${id(i + 1, j + 1)}, ${id(i, j + 1)}`);
    }
  }
  lines.push(
    '*MATERIAL, NAME=Steel',
    '*DENSITY', '7850.',
    '*ELASTIC', '2.1E11, 0.3',
    '*SOLID SECTION, ELSET=Eall, MATERIAL=Steel',
  );
  return lines.join('\n');
}

/** 12×4 CQUAD4 shell plate — 65 nodes / 48 elements. */
function nastranQuadPlateDeck(): string {
  const nx = 12;
  const ny = 4;
  const width = 1.5;
  const height = 0.5;
  const id = (i: number, j: number) => j * (nx + 1) + i + 1;
  const lines = ['CEND', 'BEGIN BULK'];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      lines.push(`GRID,${id(i, j)},,${((i * width) / nx).toFixed(4)},${((j * height) / ny).toFixed(4)},0.`);
    }
  }
  let element = 1;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      lines.push(`CQUAD4,${element++},1,${id(i, j)},${id(i + 1, j)},${id(i + 1, j + 1)},${id(i, j + 1)}`);
    }
  }
  // MAT1,MID,E,G,NU,RHO — G stays blank so NU/RHO land in their own fields.
  lines.push('MAT1,1,7.0E10,,0.33,2.7E3', 'ENDDATA');
  return lines.join('\n');
}

/** 20×10 legacy VTK quad mesh with temperature / flux point data. */
function vtkQuadPlateDeck(): string {
  const nx = 20;
  const ny = 10;
  const width = 2;
  const height = 1;
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const points: string[] = [];
  const temperature: string[] = [];
  const flux: string[] = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const x = (i * width) / nx;
      const y = (j * height) / ny;
      points.push(`${x.toFixed(4)} ${y.toFixed(4)} 0`);
      temperature.push((293.15 + (100 * x) / width).toFixed(3));
      flux.push(((2.4e5 * (1 - x / width)) | 0).toString());
    }
  }
  const cells: string[] = [];
  let quads = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      cells.push(`4 ${id(i, j)} ${id(i + 1, j)} ${id(i + 1, j + 1)} ${id(i, j + 1)}`);
      quads += 1;
    }
  }
  return [
    '# vtk DataFile Version 3.0',
    'Quad heat plate',
    'ASCII',
    'DATASET UNSTRUCTURED_GRID',
    `POINTS ${(nx + 1) * (ny + 1)} float`,
    points.join(' '),
    `CELLS ${quads} ${quads * 5}`,
    cells.join(' '),
    'CELL_TYPES ' + quads,
    Array.from({ length: quads }, () => '9').join(' '),
    `POINT_DATA ${(nx + 1) * (ny + 1)}`,
    'SCALARS temperature float 1',
    'LOOKUP_TABLE default',
    temperature.join(' '),
    'SCALARS flux float 1',
    'LOOKUP_TABLE default',
    flux.join(' '),
  ].join('\n');
}

/** Structured-point tet block (4×3×2 cells → 6 tets each). */
function tetBlockCells(nx = 4, ny = 3, nz = 2): {
  points: Array<[number, number, number]>;
  tets: [number, number, number, number][];
} {
  const width = 1;
  const height = 0.8;
  const depth = 0.6;
  const id = (i: number, j: number, k: number) => (k * (ny + 1) + j) * (nx + 1) + i;
  const points: Array<[number, number, number]> = [];
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        points.push([(i * width) / nx, (j * height) / ny, (k * depth) / nz]);
      }
    }
  }
  const tets: [number, number, number, number][] = [];
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const v = [
          id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k),
          id(i, j, k + 1), id(i + 1, j, k + 1), id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1),
        ] as const;
        // Cube split around the 0–6 diagonal; every tet keeps a positive volume.
        tets.push(
          [v[0], v[1], v[2], v[6]],
          [v[0], v[2], v[3], v[6]],
          [v[0], v[3], v[7], v[6]],
          [v[0], v[7], v[4], v[6]],
          [v[0], v[4], v[5], v[6]],
          [v[0], v[5], v[1], v[6]],
        );
      }
    }
  }
  return { points, tets };
}

/** ASCII .vtu wrapped around the tet block, with a linear temperature field. */
function vtuTetBlockDeck(): string {
  const { points, tets } = tetBlockCells();
  const maxZ = Math.max(...points.map((point) => point[2]));
  const offsets: number[] = [];
  let running = 0;
  for (const tet of tets) {
    running += tet.length;
    offsets.push(running);
  }
  return [
    '<?xml version="1.0"?>',
    '<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">',
    `<UnstructuredGrid><Piece NumberOfPoints="${points.length}" NumberOfCells="${tets.length}">`,
    '<PointData><DataArray type="Float64" Name="temperature" NumberOfComponents="1" format="ascii">',
    points.map((point) => (293.15 + (80 * point[2]) / maxZ).toFixed(3)).join(' '),
    '</DataArray></PointData>',
    '<Points><DataArray type="Float64" NumberOfComponents="3" format="ascii">',
    points.map((point) => point.map((value) => value.toFixed(4)).join(' ')).join(' '),
    '</DataArray></Points>',
    '<Cells>',
    `<DataArray type="Int32" Name="connectivity" format="ascii">${tets.flat().join(' ')}</DataArray>`,
    `<DataArray type="Int32" Name="offsets" format="ascii">${offsets.join(' ')}</DataArray>`,
    `<DataArray type="UInt8" Name="types" format="ascii">${tets.map(() => '10').join(' ')}</DataArray>`,
    '</Cells>',
    '</Piece></UnstructuredGrid></VTKFile>',
  ].join('\n');
}

/** Ansys SOLID285 (tet4) block — same 4×3×2 discretisation as the VTU sample. */
function ansysTetBlockDeck(): string {
  const { points, tets } = tetBlockCells();
  const lines = ['/PREP7', 'ET,1,SOLID285', 'MP,EX,1,1.2E11', 'MP,NUXY,1,0.34', 'MP,KXX,1,400'];
  points.forEach((point, index) => {
    lines.push(`N,${index + 1},${point[0].toFixed(4)},${point[1].toFixed(4)},${point[2].toFixed(4)}`);
  });
  for (const tet of tets) {
    lines.push(`E,${tet.map((node) => node + 1).join(',')}`);
  }
  lines.push('FINISH');
  return lines.join('\n');
}

/** Two-cell-layer channel: 12 owner cells plus U/p internal fields. */
function openfoamChannelDeck(): string {
  const nx = 4;
  const ny = 3;
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const points: string[] = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      points.push(`(${(i / nx).toFixed(4)} ${(j / ny).toFixed(4)} 0)`);
    }
  }
  const faces: string[] = [];
  const owners: number[] = [];
  let cell = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      faces.push(`4(${id(i, j)} ${id(i + 1, j)} ${id(i + 1, j + 1)} ${id(i, j + 1)})`);
      owners.push(cell++);
    }
  }
  const header = (object: string) => [
    'FoamFile', '{', 'version 2.0;', 'format ascii;', `object ${object};`, '}', '',
  ].join('\n');
  const velocity = Array.from({ length: cell }, (_, index) => `(1.5 ${(0.2 * index).toFixed(2)} 0)`);
  const pressure = Array.from({ length: cell }, (_, index) => (1e5 - 250 * index).toFixed(1));
  return [
    header('points'),
    `${points.length}`, '(', points.join('\n'), ')',
    header('faces'),
    `${faces.length}`, '(', faces.join('\n'), ')',
    header('owner'),
    `${owners.length}`, '(', owners.join('\n'), ')',
    header('U'),
    'dimensions [0 1 -1 0 0 0 0];',
    `internalField nonuniform List<vector> ${cell}`,
    '(', velocity.join('\n'), ')',
    header('p'),
    'dimensions [0 2 -2 0 0 0 0];',
    `internalField nonuniform List<scalar> ${cell}`,
    '(', pressure.join('\n'), ')',
  ].join('\n');
}

/** Layered bracket outline: fillet arc, holes, slots and centre lines. */
function dxfBracketDeck(): string {
  const entity = (kind: string, layer: string, values: Array<[number, string | number]>) =>
    ['0', kind, '8', layer, ...values.flatMap(([code, value]) => [String(code), String(value)])].join('\n');
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    entity('LINE', layer, [[10, x1], [20, y1], [11, x2], [21, y2]]);
  const circle = (layer: string, x: number, y: number, r: number) =>
    entity('CIRCLE', layer, [[10, x], [20, y], [40, r]]);
  const arc = (layer: string, x: number, y: number, r: number, start: number, end: number) =>
    entity('ARC', layer, [[10, x], [20, y], [40, r], [50, start], [51, end]]);
  const slot = (layer: string, x: number, y: number, w: number, h: number) =>
    entity('LWPOLYLINE', layer, [
      [90, 4], [70, 1],
      [10, x], [20, y],
      [10, x + w], [20, y],
      [10, x + w], [20, y + h],
      [10, x], [20, y + h],
    ]);
  return [
    '0', 'SECTION', '2', 'ENTITIES',
    line('OUTLINE', 0, 0, 1.6, 0),
    line('OUTLINE', 1.6, 0, 1.6, 0.75),
    arc('OUTLINE', 1.45, 0.75, 0.15, 0, 90),
    line('OUTLINE', 1.45, 0.9, 0, 0.9),
    line('OUTLINE', 0, 0.9, 0, 0),
    circle('HOLES', 0.35, 0.45, 0.09),
    circle('HOLES', 0.75, 0.45, 0.09),
    circle('HOLES', 1.15, 0.45, 0.09),
    slot('SLOTS', 0.2, 0.15, 0.35, 0.14),
    slot('SLOTS', 0.2, 0.61, 0.35, 0.14),
    line('CENTER', 0, 0.45, 1.6, 0.45),
    line('CENTER', 0.8, 0, 0.8, 0.9),
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

/** STEP wireframe frame: 8 vertices, 12 box edges plus two face diagonals. */
function stepFrameDeck(): string {
  const xs = [0, 1.2];
  const ys = [0, 0.8];
  const zs = [0, 0.4];
  const points: Array<[number, number, number]> = [];
  for (const z of zs) for (const y of ys) for (const x of xs) points.push([x, y, z]);
  const edges: Array<[number, number]> = [
    [1, 2], [2, 4], [4, 3], [3, 1],
    [5, 6], [6, 8], [8, 7], [7, 5],
    [1, 5], [2, 6], [3, 7], [4, 8],
    [1, 7], [2, 8],
  ];
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Frame'),'2;1');",
    "FILE_NAME('frame.step','2024-01-01T00:00:00',('ergalics'),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  points.forEach((point, index) => {
    lines.push(`#${index + 1}=CARTESIAN_POINT('p${index + 1}',(${point.map((value) => value.toFixed(3)).join(',')}));`);
  });
  points.forEach((_, index) => {
    lines.push(`#${100 + index + 1}=VERTEX_POINT('v${index + 1}',#${index + 1});`);
  });
  edges.forEach(([from, to], index) => {
    lines.push(`#${200 + index + 1}=EDGE_CURVE('e${index + 1}',#${100 + from},#${100 + to},.T.);`);
  });
  lines.push('#1000=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));', 'ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}

const abaqusQuadPlate = (): EngineeringStudy => {
  const study = parseAbaqus(abaqusQuadPlateDeck(), 'quad_plate.inp');
  const step = makeStep('Uniform tension', 'static-structural', { thickness: 0.012 });
  const fixed = addGroup(study.mesh, 'Fixed edge', 0, nodeMembersOn(study.mesh, 'x', 'min'));
  const tip = addGroup(study.mesh, 'Tension edge', 1, elementMembersOn(study.mesh, 'x', 'max'));
  return finishImported(study, step, [
    { name: 'Fixed edge', kind: 'displacement', target: { dimension: 0, tag: fixed }, components: { 0: 0, 1: 0 } },
    { name: 'Tension edge', kind: 'traction', target: { dimension: 1, tag: tip }, components: { 0: 8e6, 1: 0 } },
  ]);
};

const nastranQuadPlate = (): EngineeringStudy => {
  const study = parseNastran(nastranQuadPlateDeck(), 'quad_plate.bdf');
  const step = makeStep('Tip load', 'static-structural', { thickness: 0.01 });
  const fixed = addGroup(study.mesh, 'Clamped edge', 0, nodeMembersOn(study.mesh, 'x', 'min'));
  const tip = addGroup(study.mesh, 'Tip edge', 1, elementMembersOn(study.mesh, 'x', 'max'));
  return finishImported(study, step, [
    { name: 'Clamped edge', kind: 'displacement', target: { dimension: 0, tag: fixed }, components: { 0: 0, 1: 0 } },
    { name: 'Tip traction', kind: 'traction', target: { dimension: 1, tag: tip }, components: { 0: 4e6, 1: 0 } },
  ]);
};

const vtkQuadPlateHeat = (): EngineeringStudy => {
  const study = parseVtk(vtkQuadPlateDeck(), 'quad_heat.vtk');
  const step = makeStep('Steady heat', 'steady-heat');
  const hot = addGroup(study.mesh, 'Hot edge', 0, nodeMembersOn(study.mesh, 'x', 'min'));
  const cold = addGroup(study.mesh, 'Cold edge', 0, nodeMembersOn(study.mesh, 'x', 'max'));
  return finishImported(
    study,
    step,
    [
      { name: 'Hot edge', kind: 'temperature', target: { dimension: 0, tag: hot }, components: { 0: 393.15 } },
      { name: 'Cold edge', kind: 'temperature', target: { dimension: 0, tag: cold }, components: { 0: 293.15 } },
    ],
    [materialFromTemplate('copper')!],
  );
};

const vtuTetBlockHeat = (): EngineeringStudy => {
  const study = parseVtk(vtuTetBlockDeck(), 'tet_block.vtu');
  const step = makeStep('Steady heat (3-D)', 'steady-heat');
  const bottom = addGroup(study.mesh, 'Bottom (hot)', 0, nodeMembersOn(study.mesh, 'z', 'min'));
  const top = addGroup(study.mesh, 'Top (cold)', 0, nodeMembersOn(study.mesh, 'z', 'max'));
  return finishImported(
    study,
    step,
    [
      { name: 'Hot face', kind: 'temperature', target: { dimension: 0, tag: bottom }, components: { 0: 373.15 } },
      { name: 'Cold face', kind: 'temperature', target: { dimension: 0, tag: top }, components: { 0: 293.15 } },
    ],
    [materialFromTemplate('copper')!],
    { analysis: '3d-volume' },
  );
};

const ansysTetBlockHeat = (): EngineeringStudy => {
  const study = parseAnsys(ansysTetBlockDeck(), 'tet_block.cdb');
  const step = makeStep('Steady heat (3-D)', 'steady-heat');
  const bottom = addGroup(study.mesh, 'Bottom (hot)', 0, nodeMembersOn(study.mesh, 'z', 'min'));
  const top = addGroup(study.mesh, 'Top (cold)', 0, nodeMembersOn(study.mesh, 'z', 'max'));
  return finishImported(
    study,
    step,
    [
      { name: 'Hot face', kind: 'temperature', target: { dimension: 0, tag: bottom }, components: { 0: 373.15 } },
      { name: 'Cold face', kind: 'temperature', target: { dimension: 0, tag: top }, components: { 0: 293.15 } },
    ],
    [materialFromTemplate('steel-q235')!],
    { analysis: '3d-volume' },
  );
};

const openfoamChannel = (): EngineeringStudy => {
  const study = parseOpenfoam(openfoamChannelDeck(), 'channel');
  return { ...study, metadata: { ...study.metadata, example: 'industrial' } };
};

const dxfBracket = (): EngineeringStudy =>
  geometryToStudy(parseDxf(dxfBracketDeck(), 'bracket.dxf'), 'Bracket plate (DXF)');

const stepFrame = (): EngineeringStudy =>
  geometryToStudy(parseStep(stepFrameDeck(), 'frame.step'), 'Frame (STEP)');

export const INDUSTRIAL_EXAMPLES: IndustrialExample[] = [
  {
    id: 'industrial-plate-tension',
    nameI18n: { 'zh-CN': '平板单轴拉伸', 'en-US': 'Plate under tension' },
    descriptionI18n: {
      'zh-CN': '两端固定的二维平板在均布拉力下的平面应力解，含位移与 von Mises 应力场。',
      'en-US': 'Plane-stress solution for a plate pulled on one edge, with displacement and von Mises fields.',
    },
    format: 'gmsh',
    build: plateTension,
  },
  {
    id: 'industrial-cantilever',
    nameI18n: { 'zh-CN': '悬臂梁端部载荷', 'en-US': 'Cantilever beam' },
    descriptionI18n: {
      'zh-CN': '铝制悬臂梁受端部横向载荷，展示弯曲变形与应力集中。',
      'en-US': 'Aluminium cantilever with a transverse tip load, showing bending deformation and stress.',
    },
    format: 'gmsh',
    build: cantileverBeam,
  },
  {
    id: 'industrial-wall-heat',
    nameI18n: { 'zh-CN': '墙体稳态导热', 'en-US': 'Steady wall conduction' },
    descriptionI18n: {
      'zh-CN': '铜质墙体两侧给定温度，求解稳态温度场与热流密度。',
      'en-US': 'Copper wall with fixed hot/cold faces, solved for the steady temperature and heat-flux fields.',
    },
    format: 'gmsh',
    build: wallHeat,
  },
  {
    id: 'industrial-channel-flow',
    nameI18n: { 'zh-CN': '通道势流', 'en-US': 'Channel potential flow' },
    descriptionI18n: {
      'zh-CN': '矩形通道内拉普拉斯势流，进出口给定势差并输出速度场。',
      'en-US': 'Laplace potential flow through a rectangular channel with a potential drop, returning the velocity field.',
    },
    format: 'gmsh',
    build: channelFlow,
  },
  {
    id: 'industrial-block-3d-heat',
    nameI18n: { 'zh-CN': '三维块体稳态导热', 'en-US': '3-D block conduction' },
    descriptionI18n: {
      'zh-CN': '三棱柱四面体网格的三维稳态温度场，展示真正的体积单元求解。',
      'en-US': 'A tetrahedral prism solved with the 3-D volume heat kernel — a real volumetric analysis.',
    },
    format: 'gmsh',
    build: block3dHeat,
  },
  {
    id: 'industrial-beam-3d',
    nameI18n: { 'zh-CN': '三维悬臂梁（实体导热）', 'en-US': '3-D beam conduction' },
    descriptionI18n: {
      'zh-CN': '2×0.5×0.5 m 实体梁剖分为 1536 个四面体，两端定温，载入即可求解体积温度场。',
      'en-US': 'A 2×0.5×0.5 m solid beam split into 1536 tets with fixed end temperatures — solvable as loaded.',
    },
    format: 'gmsh',
    build: beam3dHeat,
  },
  {
    id: 'industrial-l-bracket-3d',
    nameI18n: { 'zh-CN': 'L 形支架（实体导热）', 'en-US': 'L-bracket conduction' },
    descriptionI18n: {
      'zh-CN': 'L 形截面支架的四面体实体网格，底面加热、顶面散热，展示非矩形立体模型。',
      'en-US': 'A tetrahedral solid of an L-shaped bracket heated from below — a non-rectangular 3-D body.',
    },
    format: 'gmsh',
    build: lBracket3dHeat,
  },
  {
    id: 'industrial-perforated-plate-3d',
    nameI18n: { 'zh-CN': '带孔平板（实体导热）', 'en-US': 'Perforated plate conduction' },
    descriptionI18n: {
      'zh-CN': '中心开孔的铜板实体网格，左右端定温，孔边可以看到温度场的绕流式分布。',
      'en-US': 'A copper plate with a central hole held at hot/cold ends — the field bends around the bore.',
    },
    format: 'gmsh',
    build: perforatedPlate3dHeat,
  },
  {
    id: 'industrial-tube-3d',
    nameI18n: { 'zh-CN': '空心圆筒（实体导热）', 'en-US': 'Hollow cylinder conduction' },
    descriptionI18n: {
      'zh-CN': '环形截面的空心圆筒实体网格，底面定温加热，是典型的轴/套筒类零件形态。',
      'en-US': 'A hollow cylinder (annulus section) heated at the base — a typical shaft/sleeve part shape.',
    },
    format: 'gmsh',
    build: hollowTube3dHeat,
  },
  {
    id: 'industrial-abaqus-quad-plate',
    nameI18n: { 'zh-CN': 'Abaqus 四边形板（CPS4）', 'en-US': 'Abaqus quad plate (CPS4)' },
    descriptionI18n: {
      'zh-CN': '153 节点 / 128 个 CPS4 四边形单元，左端固支、右端均布拉力，可直接求解。',
      'en-US': '153 nodes / 128 CPS4 quads clamped on the left edge and pulled on the right — solve as-is.',
    },
    format: 'abaqus',
    build: abaqusQuadPlate,
  },
  {
    id: 'industrial-nastran-shell-plate',
    nameI18n: { 'zh-CN': 'Nastran 壳板（CQUAD4）', 'en-US': 'Nastran shell plate (CQUAD4)' },
    descriptionI18n: {
      'zh-CN': '48 个 CQUAD4 壳单元、MAT1 铝合金材料，固支边加端部拉力，走 Nastran 解析路径。',
      'en-US': '48 CQUAD4 shells with a MAT1 aluminium deck, clamped edge and tip traction.',
    },
    format: 'nastran',
    build: nastranQuadPlate,
  },
  {
    id: 'industrial-vtk-heat-plate',
    nameI18n: { 'zh-CN': 'VTK 导热板（含场数据）', 'en-US': 'VTK heated plate with fields' },
    descriptionI18n: {
      'zh-CN': '20×10 四边形网格附带温度与热流点数据，两端定温边界，可直接求解稳态导热。',
      'en-US': 'A 20×10 quad grid with temperature and flux point data and fixed-temperature edges.',
    },
    format: 'vtk',
    build: vtkQuadPlateHeat,
  },
  {
    id: 'industrial-vtu-tet-block',
    nameI18n: { 'zh-CN': 'VTU 四面体块体（三维导热）', 'en-US': 'VTU tet block (3-D heat)' },
    descriptionI18n: {
      'zh-CN': '4×3×2 网格剖分为 144 个四面体，带初始温度场，上下表面定温，走体单元求解。',
      'en-US': 'A 4×3×2 block split into 144 tets with an initial field, solved by the volume heat kernel.',
    },
    format: 'vtu',
    build: vtuTetBlockHeat,
  },
  {
    id: 'industrial-ansys-tet-block',
    nameI18n: { 'zh-CN': 'Ansys 四面体块体（SOLID285）', 'en-US': 'Ansys tet block (SOLID285)' },
    descriptionI18n: {
      'zh-CN': 'CDB 文本中的 N/E 命令生成 144 个 SOLID285 四面体，上下表面施加温度边界。',
      'en-US': 'N/E commands in a CDB deck build 144 SOLID285 tets with hot and cold faces.',
    },
    format: 'ansys',
    build: ansysTetBlockHeat,
  },
  {
    id: 'industrial-openfoam-channel',
    nameI18n: { 'zh-CN': 'OpenFOAM 通道（polyMesh + 场）', 'en-US': 'OpenFOAM channel (polyMesh + fields)' },
    descriptionI18n: {
      'zh-CN': '12 个单元的通道网格，附带 U 速度矢量与 p 压力 internalField，用于演示场数据导入。',
      'en-US': 'A 12-cell channel with U velocity and p pressure internalFields — a field-import sample.',
    },
    format: 'openfoam',
    build: openfoamChannel,
  },
  {
    id: 'industrial-dxf-bracket',
    nameI18n: { 'zh-CN': 'DXF 支架图（多图层）', 'en-US': 'DXF bracket drawing (layers)' },
    descriptionI18n: {
      'zh-CN': 'OUTLINE/HOLES/SLOTS/CENTER 四个图层，含圆角圆弧、圆孔与矩形槽，导入后打开几何页。',
      'en-US': 'Four layers with a fillet arc, holes and rectangular slots — opens the geometry tool.',
    },
    format: 'dxf',
    toolId: 'geometry-import',
    build: dxfBracket,
  },
  {
    id: 'industrial-step-frame',
    nameI18n: { 'zh-CN': 'STEP 线框框架', 'en-US': 'STEP wireframe frame' },
    descriptionI18n: {
      'zh-CN': '由 CARTESIAN_POINT / VERTEX_POINT / EDGE_CURVE 构成的 8 顶点、14 棱线框体。',
      'en-US': 'An 8-vertex, 14-edge wireframe built from CARTESIAN_POINT / VERTEX_POINT / EDGE_CURVE.',
    },
    format: 'step',
    toolId: 'geometry-import',
    build: stepFrame,
  },
];

export function industrialExampleById(id: string): IndustrialExample | undefined {
  return INDUSTRIAL_EXAMPLES.find((example) => example.id === id);
}
