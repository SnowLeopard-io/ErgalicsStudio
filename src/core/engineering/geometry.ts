// ==========================================================================
// Lightweight CAD geometry readers (P3)
//
// Deliberately B-rep free: DXF is read entity-by-entity, and STEP is scanned
// for `CARTESIAN_POINT` geometry. That is enough to inspect, measure and
// bridge a part outline into the engineering mesh model without shipping a
// WASM solid kernel. Curves (circle / arc) are tessellated deterministically.
// ==========================================================================

import {
  makeStudy,
  meshBounds,
  type EngineeringGeometry,
  type EngineeringMesh,
  type EngineeringStudy,
  type GeometryEntity,
} from './types';

export class GeometryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryParseError';
  }
}

const CIRCLE_SEGMENTS = 64;

function boundsOf(points: Array<[number, number, number]>): EngineeringGeometry['bounds'] {
  if (points.length === 0) return [0, 0, 0, 0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

function finishGeometry(
  sourceFormat: 'dxf' | 'step',
  entities: GeometryEntity[],
  metadata: Record<string, string>,
): EngineeringGeometry {
  const layers = [...new Set(entities.map((entity) => entity.layer).filter((v): v is string => !!v))];
  const points = entities.flatMap((entity) => entity.points);
  return {
    schema: 'ergalics.geometry/v1',
    sourceFormat,
    entities,
    bounds: boundsOf(points),
    layers,
    metadata,
  };
}

// ---- DXF ------------------------------------------------------------------

interface DxfPair {
  code: number;
  value: string;
}

function dxfPairs(text: string): DxfPair[] {
  const lines = text.split(/\r?\n/);
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1]!.trim() });
  }
  return pairs;
}

function num(pairs: DxfPair[], index: number, code: number, fallback = 0): number {
  for (let i = index; i < pairs.length && pairs[i]!.code !== 0; i += 1) {
    if (pairs[i]!.code === code) {
      const value = Number(pairs[i]!.value);
      return Number.isFinite(value) ? value : fallback;
    }
  }
  return fallback;
}

function textValue(pairs: DxfPair[], index: number, code: number, fallback = ''): string {
  for (let i = index; i < pairs.length && pairs[i]!.code !== 0; i += 1) {
    if (pairs[i]!.code === code) return pairs[i]!.value;
  }
  return fallback;
}

function arcPoints(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): Array<[number, number, number]> {
  const start = startDeg;
  let end = endDeg;
  if (end <= start) end += 360;
  const span = Math.min(360, end - start);
  const segments = Math.max(2, Math.ceil((CIRCLE_SEGMENTS * span) / 360));
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = ((start + (span * i) / segments) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), cz]);
  }
  return points;
}

/** Parse the ENTITIES section of an ASCII DXF file. */
export function parseDxf(text: string, name = 'drawing.dxf'): EngineeringGeometry {
  if (!/^\s*0\s*\r?\nSECTION/m.test(text) && !/\bENTITIES\b/.test(text)) {
    throw new GeometryParseError('not an ASCII DXF document (binary DXF is unsupported)');
  }
  const pairs = dxfPairs(text);
  const entities: GeometryEntity[] = [];
  const layers = new Set<string>();
  let inEntities = false;
  let seq = 0;
  let pendingPolyline: GeometryEntity | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i]!;
    if (pair.code !== 0) continue;
    const type = pair.value.toUpperCase();
    if (type === 'SECTION') {
      const sectionName = textValue(pairs, i + 1, 2).toUpperCase();
      inEntities = sectionName === 'ENTITIES';
      continue;
    }
    if (type === 'ENDSEC') {
      inEntities = false;
      pendingPolyline = null;
      continue;
    }
    if (!inEntities) continue;

    const layer = textValue(pairs, i + 1, 8, '0');
    if (layer) layers.add(layer);

    if (type === 'LINE') {
      const x1 = num(pairs, i + 1, 10);
      const y1 = num(pairs, i + 1, 20);
      const z1 = num(pairs, i + 1, 30);
      const x2 = num(pairs, i + 1, 11);
      const y2 = num(pairs, i + 1, 21);
      const z2 = num(pairs, i + 1, 31);
      entities.push({
        id: `dxf-${++seq}`,
        kind: 'line',
        layer,
        points: [[x1, y1, z1], [x2, y2, z2]],
      });
    } else if (type === 'POINT') {
      entities.push({
        id: `dxf-${++seq}`,
        kind: 'point',
        layer,
        points: [[num(pairs, i + 1, 10), num(pairs, i + 1, 20), num(pairs, i + 1, 30)]],
      });
    } else if (type === 'CIRCLE') {
      entities.push({
        id: `dxf-${++seq}`,
        kind: 'circle',
        layer,
        closed: true,
        points: arcPoints(
          num(pairs, i + 1, 10),
          num(pairs, i + 1, 20),
          num(pairs, i + 1, 30),
          num(pairs, i + 1, 40, 1),
          0,
          360,
        ),
      });
    } else if (type === 'ARC') {
      entities.push({
        id: `dxf-${++seq}`,
        kind: 'arc',
        layer,
        points: arcPoints(
          num(pairs, i + 1, 10),
          num(pairs, i + 1, 20),
          num(pairs, i + 1, 30),
          num(pairs, i + 1, 40, 1),
          num(pairs, i + 1, 50, 0),
          num(pairs, i + 1, 51, 360),
        ),
      });
    } else if (type === 'LWPOLYLINE') {
      const points: Array<[number, number, number]> = [];
      let x: number | null = null;
      for (let j = i + 1; j < pairs.length && pairs[j]!.code !== 0; j += 1) {
        if (pairs[j]!.code === 10) x = Number(pairs[j]!.value);
        else if (pairs[j]!.code === 20 && x !== null) {
          const y = Number(pairs[j]!.value);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y, num(pairs, i + 1, 38)]);
          x = null;
        }
      }
      entities.push({
        id: `dxf-${++seq}`,
        kind: 'polyline',
        layer,
        points,
        closed: num(pairs, i + 1, 70, 0) !== 0,
      });
    } else if (type === 'POLYLINE') {
      pendingPolyline = {
        id: `dxf-${++seq}`,
        kind: 'polyline',
        layer,
        points: [],
        closed: (num(pairs, i + 1, 70, 0) & 1) === 1,
      };
      entities.push(pendingPolyline);
    } else if (type === 'VERTEX' && pendingPolyline) {
      pendingPolyline.points.push([
        num(pairs, i + 1, 10),
        num(pairs, i + 1, 20),
        num(pairs, i + 1, 30),
      ]);
    } else if (type === 'SEQEND') {
      pendingPolyline = null;
    }
  }

  return finishGeometry('dxf', entities, {
    name,
    layers: String(layers.size),
    entities: String(entities.length),
    units: textValue(pairs, 0, 9) || 'unknown',
  });
}

// ---- STEP -----------------------------------------------------------------

const CARTESIAN_POINT = /CARTESIAN_POINT\s*\(\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*\)/g;

/** Parse ISO-10303-21 files for their cartesian point geometry. */
export function parseStep(text: string, name = 'part.step'): EngineeringGeometry {
  if (!/ISO-10303-21/i.test(text)) {
    throw new GeometryParseError('not an ISO-10303-21 (STEP) file');
  }
  const points: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = CARTESIAN_POINT.exec(text)) !== null) {
    const parts = match[2]!.split(',').map((part) => Number(part.trim()));
    if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) continue;
    const point: [number, number, number] = [parts[0]!, parts[1]!, parts[2] ?? 0];
    const key = point.map((value) => value.toFixed(6)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  if (points.length === 0) {
    throw new GeometryParseError('STEP file contains no CARTESIAN_POINT geometry');
  }
  // A point cloud is not a solid, but a light wire through the points gives
  // the viewer something measurable; real curve entities are out of scope.
  const entity: GeometryEntity = {
    id: 'step-wire',
    kind: 'polyline',
    layer: 'STEP',
    points,
    closed: false,
  };
  const units = /SI_UNIT\s*\(\s*\.(?:MILLI|CENTI|KILO)?\.\s*,\s*\.METRE/i.test(text)
    ? 'metre'
    : 'unknown';
  return finishGeometry('step', [entity], {
    name,
    entities: '1',
    points: String(points.length),
    units,
  });
}

/** Content-sniffing geometry format detection. */
export function detectGeometryFormat(
  name: string,
  text = '',
): 'dxf' | 'step' | null {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (ext === '.dxf') return 'dxf';
  if (ext === '.step' || ext === '.stp') return 'step';
  if (/ISO-10303-21/i.test(text)) return 'step';
  if (/\bENTITIES\b/.test(text) && /^\s*0\s*\r?\nSECTION/m.test(text)) return 'dxf';
  return null;
}

export function parseGeometryFile(text: string, name: string): EngineeringGeometry {
  const format = detectGeometryFormat(name, text);
  if (format === 'dxf') return parseDxf(text, name);
  if (format === 'step') return parseStep(text, name);
  throw new GeometryParseError(`unsupported geometry file: ${name}`);
}

/** Flatten geometry entities into a line/point mesh for the viewer + solver. */
export function geometryToMesh(geometry: EngineeringGeometry): EngineeringMesh {
  const nodes: EngineeringMesh['nodes'] = [];
  const elements: EngineeringMesh['elements'] = [];
  const groups = new Map<string, number>();
  const indexByKey = new Map<string, number>();
  const nodeIndex = (point: [number, number, number]): number => {
    const key = point.map((value) => value.toFixed(9)).join(',');
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({ id: index + 1, x: point[0], y: point[1], z: point[2] });
    indexByKey.set(key, index);
    return index;
  };
  let elementId = 0;
  for (const entity of geometry.entities) {
    const indices = entity.points.map(nodeIndex);
    const tag = entity.layer ? layerTag(entity.layer, groups) : 0;
    if (entity.kind === 'point') {
      elements.push({ id: ++elementId, type: 'point', nodes: [indices[0]!], group: tag });
      continue;
    }
    const limit = entity.closed && indices.length > 2 ? indices.length : indices.length - 1;
    for (let i = 0; i < limit; i += 1) {
      const a = indices[i]!;
      const b = indices[(i + 1) % indices.length]!;
      if (a === b) continue;
      elements.push({ id: ++elementId, type: 'line2', nodes: [a, b], group: tag });
    }
  }
  const groupList = [...groups.entries()].map(([name, tag]) => ({
    dimension: 1,
    tag,
    name,
    members: elements
      .map((element, index) => (element.group === tag ? index : -1))
      .filter((index) => index >= 0),
  }));
  return {
    nodes,
    elements,
    groups: groupList,
    bounds: meshBounds(nodes),
  };
}

function layerTag(layer: string, groups: Map<string, number>): number {
  const existing = groups.get(layer);
  if (existing !== undefined) return existing;
  const tag = groups.size + 1;
  groups.set(layer, tag);
  return tag;
}

/** Wrap a geometry as a study (the unified entry point's geometry branch). */
export function geometryToStudy(
  geometry: EngineeringGeometry,
  name: string,
): EngineeringStudy {
  return makeStudy(name, geometry.sourceFormat, geometryToMesh(geometry), {
    geometry,
    metadata: { ...geometry.metadata, geometryEntities: String(geometry.entities.length) },
  });
}

/** Human summary for import previews. */
export function geometrySummary(geometry: EngineeringGeometry): string {
  const points = geometry.entities.reduce((count, entity) => count + entity.points.length, 0);
  return `${geometry.entities.length} entities, ${points} points, ${geometry.layers.length} layers`;
}
