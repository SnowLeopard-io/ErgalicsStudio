// ==========================================================================
// Engineering mesh helpers — validation + bridge to the existing FEM core.
// ==========================================================================

import type { PlanarMesh, TriElement, EdgeElement } from '@/core/fem/mesh/types';
import {
  ELEMENT_CORNER_COUNT,
  type EngineeringMesh,
  type ElementType,
  meshBounds,
} from './types';

export interface MeshIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** Structural validation before a mesh is handed to a solver. */
export function validateMesh(mesh: EngineeringMesh): MeshIssue[] {
  const issues: MeshIssue[] = [];
  const nodeIds = new Set(mesh.nodes.map((n) => n.id));
  if (nodeIds.size !== mesh.nodes.length) {
    issues.push({ severity: 'error', message: 'duplicate node ids' });
  }
  const elementIds = new Set(mesh.elements.map((e) => e.id));
  if (elementIds.size !== mesh.elements.length) {
    issues.push({ severity: 'error', message: 'duplicate element ids' });
  }
  for (const element of mesh.elements) {
    if (ELEMENT_CORNER_COUNT[element.type] === 0 && element.nodes.length < 3) {
      issues.push({
        severity: 'error',
        message: `element ${element.id}: polygon needs at least 3 nodes`,
      });
    } else if (
      ELEMENT_CORNER_COUNT[element.type] > 0 &&
      element.nodes.length !== ELEMENT_CORNER_COUNT[element.type]
    ) {
      issues.push({
        severity: 'error',
        message: `element ${element.id}: ${element.type} expects ${ELEMENT_CORNER_COUNT[element.type]} nodes, got ${element.nodes.length}`,
      });
    }
    if (element.nodes.some((index) => index < 0 || index >= mesh.nodes.length)) {
      issues.push({ severity: 'error', message: `element ${element.id}: node index out of range` });
    }
    if (new Set(element.nodes).size !== element.nodes.length) {
      issues.push({ severity: 'warning', message: `element ${element.id}: repeated node index` });
    }
  }
  const bounds = meshBounds(mesh.nodes);
  if (!bounds.every((value) => Number.isFinite(value))) {
    issues.push({ severity: 'error', message: 'non-finite node coordinate' });
  }
  return issues;
}

export interface PlanarConversionOptions {
  /** Max |z| still considered planar (default 1e-9). */
  tolerance?: number;
  /**
   * Use physical groups with dimension 1 as boundary edges when available;
   * otherwise derive geometric boundary edges from the element connectivity.
   */
  deriveBoundaryEdges?: boolean;
}

/**
 * Convert an imported 2D triangular/quadrilateral mesh into the existing
 * `PlanarMesh` used by `src/core/fem`. Returns null for 3D meshes or meshes
 * with unsupported element types — callers should surface a clear message.
 */
export function toPlanarMesh(
  mesh: EngineeringMesh,
  options: PlanarConversionOptions = {},
): PlanarMesh | null {
  const tolerance = options.tolerance ?? 1e-9;
  if (mesh.nodes.some((node) => Math.abs(node.z) > tolerance)) return null;

  const indexById = new Map<number, number>();
  mesh.nodes.forEach((node, index) => indexById.set(node.id, index));
  const coordinates = new Float64Array(mesh.nodes.length * 2);
  const nodeTags = new Int32Array(mesh.nodes.length);
  mesh.nodes.forEach((node, index) => {
    coordinates[index * 2] = node.x;
    coordinates[index * 2 + 1] = node.y;
  });
  for (const group of mesh.groups) {
    if (group.dimension !== 0) continue;
    for (const index of group.members) {
      // Dimension-0 groups already store node indices, not format node ids.
      if (index >= 0 && index < nodeTags.length) nodeTags[index] = group.tag;
    }
  }

  const elements: TriElement[] = [];
  const edgeCount = new Map<string, { a: number; b: number; count: number }>();
  const addEdge = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    const existing = edgeCount.get(key);
    if (existing) existing.count += 1;
    else edgeCount.set(key, { a: lo, b: hi, count: 1 });
  };
  const pushTri = (a: number, b: number, c: number, tag: number): void => {
    elements.push({ a, b, c, tag });
    addEdge(a, b); addEdge(b, c); addEdge(c, a);
  };

  for (const element of mesh.elements) {
    const nodes = element.nodes.map((index) => indexById.get(mesh.nodes[index]!.id) ?? index);
    if (nodes.some((node) => node < 0 || node >= mesh.nodes.length)) return null;
    const tag = element.group ?? 0;
    if (element.type === 'tri3') pushTri(nodes[0]!, nodes[1]!, nodes[2]!, tag);
    else if (element.type === 'quad4') {
      pushTri(nodes[0]!, nodes[1]!, nodes[2]!, tag);
      pushTri(nodes[0]!, nodes[2]!, nodes[3]!, tag);
    } else if (element.type === 'line2' || element.type === 'line3' || element.type === 'point') {
      // Boundary entities carry no area: they are already represented by
      // dimension-1 groups / derived boundary edges.
      continue;
    } else return null;
  }

  const boundaryEdges: EdgeElement[] = [];
  const taggedEdges = new Map<string, number>();
  for (const group of mesh.groups) {
    if (group.dimension !== 1) continue;
    const memberSet = new Set(group.members);
    for (let elementIndex = 0; elementIndex < mesh.elements.length; elementIndex += 1) {
      if (!memberSet.has(elementIndex)) continue;
      const nodes = mesh.elements[elementIndex]!.nodes;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        const b = nodes[(i + 1) % nodes.length]!;
        taggedEdges.set(`${Math.min(a, b)}:${Math.max(a, b)}`, group.tag);
      }
    }
  }
  for (const [key, edge] of edgeCount) {
    if (options.deriveBoundaryEdges !== false && edge.count !== 1) continue;
    boundaryEdges.push({ a: edge.a, b: edge.b, tag: taggedEdges.get(key) ?? 0 });
  }

  return { nodes: coordinates, nodeTags, elements, boundaryEdges };
}

/** Compact text summary used by import previews and diagnostics. */
export function meshSummary(mesh: EngineeringMesh): string {
  const counts = new Map<ElementType, number>();
  for (const element of mesh.elements) {
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  }
  const types = [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(' ');
  return `${mesh.nodes.length} nodes, ${mesh.elements.length} elements (${types}), ${mesh.groups.length} groups`;
}
