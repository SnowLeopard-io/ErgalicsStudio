// ==========================================================================
// Gmsh .msh adapter (ASCII v2 and v4.x) — pure TS
// ==========================================================================
//
// Supports the ASCII layouts produced by Gmsh's default exporter. Binary
// files are detected and rejected with an actionable message rather than
// producing a half-parsed mesh. The adapter normalises element types into the
// shared vocabulary and maps physical tags into EngineeringGroups.
// ==========================================================================

import {
  makeStudy,
  type ElementType,
  type EngineeringElement,
  type EngineeringGroup,
  type EngineeringNode,
  type EngineeringStudy,
} from '../types';

const GMSH_TYPES: Record<number, ElementType> = {
  1: 'line2', 2: 'tri3', 3: 'quad4', 4: 'tet4', 5: 'hex8',
  6: 'wedge6', 7: 'pyramid5', 8: 'line3', 9: 'tri6', 10: 'quad9',
  11: 'tet10', 12: 'quad8', 13: 'hex20', 15: 'point', 17: 'polyhedron', 18: 'polygon',
};

const DIMENSION_BY_TYPE: Partial<Record<ElementType, number>> = {
  point: 0, line2: 1, line3: 1,
  tri3: 2, tri6: 2, quad4: 2, quad8: 2, quad9: 2, polygon: 2,
  tet4: 3, tet10: 3, hex8: 3, hex20: 3, wedge6: 3, pyramid5: 3, polyhedron: 3,
};

export class GmshParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmshParseError';
  }
}

function section(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `$${name}`);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]!.trim() === `$End${name}`) break;
    out.push(lines[i]!);
  }
  return out;
}

function tokens(line: string): string[] {
  return line.trim().split(/\s+/).filter((token) => token.length > 0);
}

function physicalNames(lines: string[]): Map<number, { dimension: number; name: string }> {
  const map = new Map<number, { dimension: number; name: string }>();
  const count = Number(tokens(lines[0] ?? '')[0] ?? 0);
  for (let i = 1; i <= count && i < lines.length; i += 1) {
    const parts = tokens(lines[i]!);
    const dimension = Number(parts[0]);
    const tag = Number(parts[1]);
    const name = parts.slice(2).join(' ').replace(/^"|"$/g, '');
    if (Number.isFinite(tag)) map.set(tag, { dimension, name });
  }
  return map;
}

function readNodes(lines: string[]): EngineeringNode[] {
  const nodes: EngineeringNode[] = [];
  const header = tokens(lines[0] ?? '');
  // v2 header: nodeCount. v4 header: numBlocks nodeCount minTag maxTag.
  if (header.length <= 1) {
    const count = Number(header[0] ?? 0);
    for (let i = 1; i <= count && i < lines.length; i += 1) {
      const parts = tokens(lines[i]!);
      if (parts.length < 4) continue;
      nodes.push({
        id: Number(parts[0]),
        x: Number(parts[1]),
        y: Number(parts[2]),
        z: Number(parts[3]),
      });
    }
    return nodes;
  }

  let cursor = 1;
  const blockCount = Number(header[0] ?? 0);
  for (let block = 0; block < blockCount && cursor < lines.length; block += 1) {
    const blockHeader = tokens(lines[cursor++] ?? '');
    // entityDim entityTag parametric numNodesInBlock (v4.1+ adds parametric)
    const hasParametric = blockHeader.length >= 4;
    const inBlock = Number(blockHeader[hasParametric ? 3 : 2] ?? 0);
    const tagValues: number[] = [];
    for (let i = 0; i < inBlock && cursor < lines.length; i += 1, cursor += 1) {
      tagValues.push(Number(tokens(lines[cursor]!)[0]));
    }
    for (let i = 0; i < inBlock && cursor < lines.length; i += 1, cursor += 1) {
      const parts = tokens(lines[cursor]!);
      nodes.push({
        id: tagValues[i]!,
        x: Number(parts[0] ?? 0),
        y: Number(parts[1] ?? 0),
        z: Number(parts[2] ?? 0),
      });
    }
  }
  return nodes;
}

/** v2 elements carry no type token: infer topology from node count. */
function inferV2Type(nodeCount: number, planar: boolean): ElementType {
  switch (nodeCount) {
    case 1: return 'point';
    case 2: return 'line2';
    case 3: return 'tri3';
    case 4: return planar ? 'quad4' : 'tet4';
    case 6: return planar ? 'tri6' : 'wedge6';
    case 8: return 'hex8';
    case 9: return 'quad9';
    case 10: return 'tet10';
    case 20: return 'hex20';
    default: return 'polyhedron';
  }
}

/**
 * Parse `$Entities` into `${dim}:${entityTag}` → physical tags. Used by MSH 4
 * where element lines carry no physical tag (the entity block does).
 */
function readEntityPhysicalTags(lines: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  if (lines.length === 0) return map;
  const counts = tokens(lines[0]!).map(Number);
  // Order after the header: points (dim 0), curves (1), surfaces (2), volumes (3).
  const perDim = counts.slice(0, 4);
  let cursor = 1;
  for (let dim = 0; dim < 4; dim += 1) {
    const n = perDim[dim] ?? 0;
    for (let i = 0; i < n && cursor < lines.length; i += 1) {
      const parts = tokens(lines[cursor++]!).map(Number);
      const entityTag = parts[0]!;
      // Point: tag x y z numPhys phys… ; Curve/Surface/Volume: tag 6 bbox coords
      // numPhys phys… then bounding entities. Physical count is at index 4/8.
      const physCountIndex = dim === 0 ? 4 : 8;
      const physCount = parts[physCountIndex] ?? 0;
      const physical: number[] = [];
      for (let p = 0; p < physCount; p += 1) physical.push(parts[physCountIndex + 1 + p]!);
      map.set(`${dim}:${entityTag}`, physical);
    }
  }
  return map;
}

function readElements(
  lines: string[],
  nodes: readonly EngineeringNode[],
  entityPhysical: ReadonlyMap<string, number[]> = new Map(),
): EngineeringElement[] {
  const elements: EngineeringElement[] = [];
  const header = tokens(lines[0] ?? '');
  if (header.length <= 1) {
    const count = Number(header[0] ?? 0);
    const planar = nodes.every((node) => Math.abs(node.z) < 1e-9);
    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    for (let i = 1; i <= count && i < lines.length; i += 1) {
      const parts = tokens(lines[i]!).map(Number);
      if (parts.length < 3) continue;
      const id = parts[0]!;
      const tagCount = parts[1]!;
      const labels = parts.slice(2 + tagCount);
      const indices = labels
        .map((label) => indexById.get(label))
        .filter((index): index is number => index !== undefined);
      elements.push({
        id,
        type: inferV2Type(indices.length, planar),
        nodes: indices,
        ...(tagCount > 0 ? { group: parts[2] } : {}),
      });
    }
    return elements;
  }

  let cursor = 1;
  const blockCount = Number(header[0] ?? 0);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  for (let block = 0; block < blockCount && cursor < lines.length; block += 1) {
    const parts = tokens(lines[cursor++] ?? '').map(Number);
    const elementType = GMSH_TYPES[parts[2]!] ?? 'polyhedron';
    const inBlock = Number(parts[3] ?? 0);
    const physical = entityPhysical.get(`${parts[0]}:${parts[1]}`);
    for (let i = 0; i < inBlock && cursor < lines.length; i += 1, cursor += 1) {
      const values = tokens(lines[cursor]!).map(Number);
      const nodeIndices = values
        .slice(1)
        .map((label) => indexById.get(label))
        .filter((index): index is number => index !== undefined);
      elements.push({
        id: values[0]!,
        type: elementType,
        nodes: nodeIndices,
        ...(physical && physical.length > 0 ? { group: physical[0] } : {}),
      });
    }
  }
  return elements;
}

/** Parse a Gmsh ASCII mesh (v2 or v4) into the engineering domain model. */
export function parseGmsh(text: string, name = 'mesh.msh'): EngineeringStudy {
  const format = section(text, 'MeshFormat');
  if (format.length === 0) throw new GmshParseError('missing $MeshFormat section');
  const header = tokens(format[0] ?? '');
  const version = Number(header[0] ?? 0);
  const isBinary = Number(header[1] ?? 0) !== 0;
  if (isBinary) throw new GmshParseError('binary Gmsh files are not supported — re-export as ASCII');
  if (version < 2 || version >= 5) {
    throw new GmshParseError(`unsupported Gmsh version ${version}`);
  }

  const names = physicalNames(section(text, 'PhysicalNames'));
  const entityPhysical = readEntityPhysicalTags(section(text, 'Entities'));
  const nodes = readNodes(section(text, 'Nodes'));
  const elements = readElements(section(text, 'Elements'), nodes, entityPhysical);
  if (nodes.length === 0) throw new GmshParseError('mesh contains no nodes');

  const groups: EngineeringGroup[] = [];
  const byTag = new Map<number, EngineeringGroup>();
  for (const [tag, info] of names) {
    const group: EngineeringGroup = {
      dimension: info.dimension,
      tag,
      name: info.name,
      members: [],
    };
    groups.push(group);
    byTag.set(tag, group);
  }
  elements.forEach((element, elementIndex) => {
    if (element.group === undefined) return;
    const group = byTag.get(element.group);
    if (!group) return;
    const dimension = DIMENSION_BY_TYPE[element.type];
    // Group members are element ARRAY indices, not format ids (which may have
    // gaps) — use the loop index so BC/material targeting stays correct.
    if (dimension === group.dimension) group.members.push(elementIndex);
  });

  // Physical groups are selections, not boundary conditions — a caller that
  // knows the analysis adds BCs on top of these groups.
  return makeStudy(name, 'gmsh', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    metadata: {
      formatVersion: String(version),
      nodeCount: String(nodes.length),
      elementCount: String(elements.length),
    },
  });
}
