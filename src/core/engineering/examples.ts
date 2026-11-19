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
import { makeStudy } from './types';
import type {
  BoundaryCondition,
  EngineeringFormat,
  EngineeringGroup,
  EngineeringMesh,
  EngineeringStudy,
} from './types';

export interface IndustrialExample {
  id: string;
  /** Registry-style body title, localised at render time. */
  nameI18n: Record<'zh-CN' | 'en-US', string>;
  descriptionI18n: Record<'zh-CN' | 'en-US', string>;
  /** Badge shown on the example card (format / analysis family). */
  format: EngineeringFormat;
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
];

export function industrialExampleById(id: string): IndustrialExample | undefined {
  return INDUSTRIAL_EXAMPLES.find((example) => example.id === id);
}
