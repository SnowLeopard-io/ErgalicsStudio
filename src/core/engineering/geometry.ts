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

// ---- 长度单位 --------------------------------------------------------------
// CAD 导出器用 `$INSUNITS`（DXF HEADER）或 STEP 单位定义实体声明长度单位。
// 解析结果统一换算到米，比例因子即单位对应的米数。

interface LengthUnit {
  metres: number;
  name: string;
}

const UNIT_INCH: LengthUnit = { metres: 0.0254, name: 'inch' };
const UNIT_FOOT: LengthUnit = { metres: 0.3048, name: 'foot' };
const UNIT_MILE: LengthUnit = { metres: 1609.344, name: 'mile' };
const UNIT_MILLIMETRE: LengthUnit = { metres: 0.001, name: 'millimetre' };
const UNIT_CENTIMETRE: LengthUnit = { metres: 0.01, name: 'centimetre' };
const UNIT_METRE: LengthUnit = { metres: 1, name: 'metre' };
const UNIT_KILOMETRE: LengthUnit = { metres: 1000, name: 'kilometre' };
const UNIT_MICROINCH: LengthUnit = { metres: 2.54e-8, name: 'microinch' };
const UNIT_MICRON: LengthUnit = { metres: 1e-6, name: 'micron' };
const UNIT_MIL: LengthUnit = { metres: 2.54e-5, name: 'mil' };
const UNIT_YARD: LengthUnit = { metres: 0.9144, name: 'yard' };

const UNKNOWN_LENGTH_UNIT: LengthUnit = { metres: 1, name: 'unknown' };

// INSUNITS 编码 → 米。0 表示无单位，按 1 倍处理。
const LENGTH_UNITS_BY_CODE = new Map<number, LengthUnit>([
  [0, { metres: 1, name: 'unitless' }],
  [1, UNIT_INCH],
  [2, UNIT_FOOT],
  [3, UNIT_MILE],
  [4, UNIT_MILLIMETRE],
  [5, UNIT_CENTIMETRE],
  [6, UNIT_METRE],
  [7, UNIT_KILOMETRE],
  [8, UNIT_MICROINCH],
  [9, UNIT_MICRON],
  [10, UNIT_MIL],
  [11, UNIT_YARD],
]);

// STEP 的 CONVERSION_BASED_UNIT 名称 → 米（键为去掉空白/下划线/连字符后的大写名）。
const LENGTH_UNITS_BY_NAME = new Map<string, LengthUnit>([
  ['INCH', UNIT_INCH],
  ['IN', UNIT_INCH],
  ['FOOT', UNIT_FOOT],
  ['FEET', UNIT_FOOT],
  ['FT', UNIT_FOOT],
  ['MILE', UNIT_MILE],
  ['YARD', UNIT_YARD],
  ['YD', UNIT_YARD],
  ['MIL', UNIT_MIL],
  ['THOU', UNIT_MIL],
  ['MICROINCH', UNIT_MICROINCH],
  ['MICRON', UNIT_MICRON],
  ['MICROMETRE', UNIT_MICRON],
  ['MICROMETER', UNIT_MICRON],
  ['MILLIMETRE', UNIT_MILLIMETRE],
  ['MILLIMETER', UNIT_MILLIMETRE],
  ['CENTIMETRE', UNIT_CENTIMETRE],
  ['CENTIMETER', UNIT_CENTIMETRE],
  ['METRE', UNIT_METRE],
  ['METER', UNIT_METRE],
  ['KILOMETRE', UNIT_KILOMETRE],
  ['KILOMETER', UNIT_KILOMETRE],
]);

const SI_PREFIX_TO_METRES: Record<string, number> = {
  '': 1,
  MILLI: 1e-3,
  CENTI: 1e-2,
  DECI: 1e-1,
  DECA: 1e1,
  HECTO: 1e2,
  KILO: 1e3,
  MICRO: 1e-6,
  NANO: 1e-9,
};

/**
 * 读取 DXF HEADER 中的 `$INSUNITS`：键是组码 9，值是紧随其后的组码 70。
 * 从整个组码表扫描（旧实现从头扫且被首个组码 0 截断，永远读不到）。
 */
function dxfLengthUnit(pairs: DxfPair[]): LengthUnit {
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i]!;
    if (pair.code !== 9 || pair.value.toUpperCase() !== '$INSUNITS') continue;
    for (let j = i + 1; j < pairs.length; j += 1) {
      const value = pairs[j]!;
      if (value.code === 9) break;
      if (value.code === 70) {
        return LENGTH_UNITS_BY_CODE.get(Number(value.value)) ?? UNKNOWN_LENGTH_UNIT;
      }
    }
  }
  return UNKNOWN_LENGTH_UNIT;
}

/** 识别 STEP 中声明的长度单位；无法识别时保持 1 倍并标记 unknown。 */
function stepLengthUnit(text: string): LengthUnit {
  // 1) HEADER 里显式写出的 INSUNITS 编码（键与值可能分行）。
  const declared = /\$?INSUNITS\s*[:=]?\s*['"]?(\d+)/i.exec(text);
  if (declared) {
    const unit = LENGTH_UNITS_BY_CODE.get(Number(declared[1]));
    if (unit) return unit;
  }
  // 2) 标准单位定义实体。CONVERSION_BASED_UNIT 优先：其 SI_UNIT 基单位
  //    往往写成毫米（例如英寸文件里的 LENGTH_MEASURE(25.4) 基准）。
  const conversion = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/gi;
  let match: RegExpExecArray | null;
  while ((match = conversion.exec(text)) !== null) {
    const key = match[1]!.trim().toUpperCase().replace(/[\s_-]+/g, '');
    const unit = LENGTH_UNITS_BY_NAME.get(key);
    if (unit) return unit;
  }
  // 3) SI_UNIT(.MILLI.,.METRE.) / SI_UNIT($,.METRE.)。
  const si = /SI_UNIT\s*\(\s*(?:\.([A-Z]+)\.|\$)\s*,\s*\.METRE\s*\./i.exec(text);
  if (si) {
    const prefix = (si[1] ?? '').toUpperCase();
    const metres = SI_PREFIX_TO_METRES[prefix];
    if (metres !== undefined) {
      return { metres, name: prefix ? `${prefix.toLowerCase()}metre` : 'metre' };
    }
  }
  return UNKNOWN_LENGTH_UNIT;
}

function scalePoints(entities: GeometryEntity[], factor: number): void {
  if (factor === 1) return;
  for (const entity of entities) {
    for (const point of entity.points) {
      point[0] *= factor;
      point[1] *= factor;
      point[2] *= factor;
    }
  }
}

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

  // 统一换算到米；圆/圆弧的半径已折算进离散点，随坐标一起缩放。
  const unit = dxfLengthUnit(pairs);
  scalePoints(entities, unit.metres);

  return finishGeometry('dxf', entities, {
    name,
    layers: String(layers.size),
    entities: String(entities.length),
    units: unit.name,
  });
}

// ---- STEP -----------------------------------------------------------------

const CARTESIAN_POINT = /CARTESIAN_POINT\s*\(\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*\)/g;

/** Parse ISO-10303-21 files for their cartesian point geometry. */
export function parseStep(text: string, name = 'part.step'): EngineeringGeometry {
  if (!/ISO-10303-21/i.test(text)) {
    throw new GeometryParseError('not an ISO-10303-21 (STEP) file');
  }
  // 解析得到的坐标仍是以文件声明单位计的数值，统一换算到米。
  const unit = stepLengthUnit(text);
  const factor = unit.metres;
  const points: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = CARTESIAN_POINT.exec(text)) !== null) {
    const parts = match[2]!.split(',').map((part) => Number(part.trim()));
    if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) continue;
    const point: [number, number, number] = [
      parts[0]! * factor,
      parts[1]! * factor,
      (parts[2] ?? 0) * factor,
    ];
    const key = point.map((value) => value.toFixed(6)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  if (points.length === 0) {
    throw new GeometryParseError('STEP file contains no CARTESIAN_POINT geometry');
  }

  // Reconstruct real wire-frame topology where present: map entity ids to
  // coordinates, VERTEX_POINT → cartesian point, EDGE_CURVE → vertex pair.
  // This yields genuine CAD edges instead of a naive point-cloud polyline.
  const cartesianById = new Map<string, [number, number, number]>();
  const pointRe = /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)\s*\)/g;
  let pm: RegExpExecArray | null = null;
  while ((pm = pointRe.exec(text)) !== null) {
    const coords = pm[2]!.split(',').map((v) => Number(v.trim()) * factor);
    if (coords.length >= 2 && coords.every((v) => Number.isFinite(v))) {
      cartesianById.set(pm[1]!, [coords[0]!, coords[1]!, coords[2] ?? 0]);
    }
  }
  const vertexToPoint = new Map<string, string>();
  const vertexRe = /#(\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)/g;
  let vm: RegExpExecArray | null = null;
  while ((vm = vertexRe.exec(text)) !== null) vertexToPoint.set(vm[1]!, vm[2]!);

  const wireEntities: GeometryEntity[] = [];
  const edgeRe =
    /#(\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,/g;
  let em: RegExpExecArray | null = null;
  while ((em = edgeRe.exec(text)) !== null) {
    const pa = cartesianById.get(vertexToPoint.get(em[2]!) ?? '');
    const pb = cartesianById.get(vertexToPoint.get(em[3]!) ?? '');
    if (pa && pb) {
      wireEntities.push({
        id: `edge-${em[1]}`, kind: 'line', layer: 'STEP', points: [pa, pb], closed: false,
      });
    }
  }
  if (wireEntities.length === 0) {
    // Fallback: no explicit EDGE_CURVE topology — keep the point cloud as a
    // measurable polyline so the viewer still shows something informative.
    wireEntities.push({ id: 'step-wire', kind: 'polyline', layer: 'STEP', points, closed: false });
  }
  return finishGeometry('step', wireEntities, {
    name,
    entities: String(wireEntities.length),
    points: String(points.length),
    units: unit.name,
    topology: wireEntities.length > 1 ? 'edge-curves' : 'point-cloud',
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
