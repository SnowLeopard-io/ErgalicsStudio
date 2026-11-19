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

// Gmsh 官方单元类型表（MSH 4.1 §Element types）中，中性模型真正支持的子集。
// 注意：17 = 20 节点二阶六面体（hex20），13/18 是二阶棱柱而非六面体。
const GMSH_TYPES: Record<number, ElementType> = {
  1: 'line2', 2: 'tri3', 3: 'quad4', 4: 'tet4', 5: 'hex8',
  6: 'wedge6', 7: 'pyramid5', 8: 'line3', 9: 'tri6', 10: 'quad9',
  11: 'tet10', 15: 'point', 16: 'quad8', 17: 'hex20',
};

/** Gmsh 高阶 id 在中性模型中无对应拓扑：解析时抛出明确错误，
 *  绝不静默映射成错误类型或丢弃节点。 */
const UNSUPPORTED_GMSH_TYPES: Record<number, { nodeCount: number; label: string }> = {
  12: { nodeCount: 27, label: '27 节点二阶六面体单元' },
  13: { nodeCount: 18, label: '18 节点二阶棱柱单元' },
  14: { nodeCount: 14, label: '14 节点二阶金字塔单元' },
  18: { nodeCount: 15, label: '15 节点二阶棱柱单元' },
  19: { nodeCount: 13, label: '13 节点二阶金字塔单元' },
  20: { nodeCount: 9, label: '9 节点二阶三角形单元' },
  21: { nodeCount: 10, label: '10 节点三阶三角形单元' },
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

/** 键为 `${dimension}:${tag}`：Gmsh 允许不同维度复用同一物理 tag。 */
function physicalNames(lines: string[]): Map<string, { dimension: number; tag: number; name: string }> {
  const map = new Map<string, { dimension: number; tag: number; name: string }>();
  const count = Number(tokens(lines[0] ?? '')[0] ?? 0);
  for (let i = 1; i <= count && i < lines.length; i += 1) {
    const parts = tokens(lines[i]!);
    const dimension = Number(parts[0]);
    const tag = Number(parts[1]);
    const name = parts.slice(2).join(' ').replace(/^"|"$/g, '');
    if (Number.isFinite(tag) && Number.isFinite(dimension)) {
      map.set(`${dimension}:${tag}`, { dimension, tag, name });
    }
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
      // Point: tag x y z numPhys phys… ; Curve/Surface/Volume: tag + 6 bbox
      // coords + numPhys phys… then bounding entities. The physical-tag
      // count therefore sits at index 4 for points, 7 for dim ≥ 1.
      const physCountIndex = dim === 0 ? 4 : 7;
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
    const typeId = parts[2]!;
    const elementType = GMSH_TYPES[typeId];
    if (elementType === undefined) {
      // 内核无对应拓扑（hex27、prism18 等）：按 Gmsh 类型表报出明确错误；
      // 未知 id 时退化为按首个单元行的节点数描述。
      const unsupported = UNSUPPORTED_GMSH_TYPES[typeId];
      if (unsupported) {
        throw new GmshParseError(`暂不支持 ${unsupported.label}（Gmsh 类型 ${typeId}）`);
      }
      const nodeCount = Math.max(tokens(lines[cursor] ?? '').length - 1, 0);
      throw new GmshParseError(`暂不支持 ${nodeCount} 节点单元类型（Gmsh 类型 ${typeId}）`);
    }
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
  // MSH 4.0 的 $Nodes 是“每行标签+坐标”，与 4.1 的“先标签后坐标”不同。
  // 宁可明确拒绝，也不静默解析出 NaN 坐标。
  if (version >= 4 && version < 4.1) {
    throw new GmshParseError('暂不支持 MSH 4.0，请用 Gmsh 重新导出 4.1 或 2.2 格式');
  }
  if (version < 2 || version >= 5) {
    throw new GmshParseError(`unsupported Gmsh version ${version}`);
  }

  const names = physicalNames(section(text, 'PhysicalNames'));
  const entityPhysical = readEntityPhysicalTags(section(text, 'Entities'));
  const nodes = readNodes(section(text, 'Nodes'));
  const elements = readElements(section(text, 'Elements'), nodes, entityPhysical);
  if (nodes.length === 0) throw new GmshParseError('mesh contains no nodes');

  const groups: EngineeringGroup[] = [];
  const byKey = new Map<string, EngineeringGroup>();
  for (const [key, info] of names) {
    const group: EngineeringGroup = {
      dimension: info.dimension,
      tag: info.tag,
      name: info.name,
      members: [],
    };
    groups.push(group);
    byKey.set(key, group);
  }
  elements.forEach((element, elementIndex) => {
    if (element.group === undefined) return;
    const dimension = DIMENSION_BY_TYPE[element.type];
    if (dimension === undefined) return;
    // 同一 tag 可同时属于不同维度，必须用 `${dim}:${tag}` 才能命中正确分组。
    const group = byKey.get(`${dimension}:${element.group}`);
    if (!group) return;
    // Group members are element ARRAY indices, not format ids (which may have
    // gaps) — use the loop index so BC/material targeting stays correct.
    group.members.push(elementIndex);
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
