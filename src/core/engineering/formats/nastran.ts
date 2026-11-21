// ==========================================================================
// Nastran .bdf/.dat adapter (free-field and fixed-field ASCII) — pure TS
//
// Reads the bulk-data entries that define an analysis model: GRID (nodes),
// element connectivity (CTRIA3/CQUAD4/CTETRA/CHEXA/CPENTA/CTRIA6/CQUAD8),
// GRID-set constraints (SPC/SPC1) and loads (FORCE/PLOAD2). The executable
// and case-control lines are ignored. This is the most widely deployed
// structured-CAE exchange format, so supporting it makes the workbench
// interoperable with Nastran/Patran/Femap workflows.
//
// Fixed-field lines are read by column position, so blank fields are
// significant and must not be collapsed. Free-field lines are comma
// separated. `+`/`*`/`&` continuation lines extend element connectivity and
// `*CARD` large-field entries are accepted.
// ==========================================================================

import {
  makeStudy,
  type BoundaryCondition,
  type ElementType,
  type EngineeringElement,
  type EngineeringGroup,
  type EngineeringMaterial,
  type EngineeringNode,
  type EngineeringStudy,
} from '../types';

/** Supported topology per card name, keyed by the number of nodes present. */
const ELEMENT_TOPOLOGY: Record<string, Record<number, ElementType>> = {
  CTRIA3: { 3: 'tri3' },
  CTRIA6: { 6: 'tri6' },
  CQUAD4: { 4: 'quad4' },
  CQUAD8: { 8: 'quad8' },
  CQUAD9: { 9: 'quad9' },
  CTETRA: { 4: 'tet4', 10: 'tet10' },
  CHEXA: { 8: 'hex8', 20: 'hex20' },
  CPENTA: { 6: 'wedge6' },
  CPYRAM: { 5: 'pyramid5' },
};

/** High-order variants the neutral model cannot represent yet. */
const UNSUPPORTED_TOPOLOGY: Record<string, Record<number, string>> = {
  CPENTA: { 15: 'wedge15' },
  CPYRAM: { 13: 'pyramid13' },
};

export class NastranParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NastranParseError';
  }
}

/** Split a fixed-field line into 8-character columns, keeping blank fields. */
function fixedFields(line: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 8) out.push(line.slice(i, i + 8).trim());
  return out;
}

/** Split a free-field line on commas. */
function freeFields(line: string): string[] {
  return line.split(',').map((value) => value.trim());
}

/** Normalise a card token: strip the large-field `*` and uppercase. */
function cardKeyword(token: string | undefined): string {
  const cleaned = (token ?? '').trim().replace(/^\*/, '');
  return (cleaned.split(/[,\s]/)[0] ?? '').toUpperCase();
}

/**
 * A continuation line carries its marker (`+`/`*`/`&` or an empty field) in
 * the first field. Large-field cards also start with `*` but are followed
 * immediately by the card name, so they are not continuations.
 */
function isContinuationLine(line: string): boolean {
  const trimmed = line.trimStart();
  const first = trimmed[0];
  if (first === '+' || first === '&' || first === ',') return true;
  if (first === '*') return !/^\*[A-Za-z]/.test(trimmed);
  return false;
}

/** Data fields of a continuation line, marker field removed. */
function continuationFields(line: string): string[] {
  if (line.includes(',')) {
    const parts = freeFields(line);
    const first = parts[0] ?? '';
    return first === '' || first === '+' || first === '*' || first === '&'
      ? parts.slice(1)
      : parts;
  }
  return fixedFields(line).slice(1);
}

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nodeIds(parts: string[]): number[] {
  return parts.map(num).filter((value) => value > 0);
}

function maxNodeCount(keyword: string): number {
  const counts = {
    ...ELEMENT_TOPOLOGY[keyword],
    ...UNSUPPORTED_TOPOLOGY[keyword],
  };
  return Math.max(0, ...Object.keys(counts).map(Number));
}

interface PendingElement {
  id: number;
  keyword: string;
  pid: number;
  nodeIds: number[];
}

interface RawElement extends PendingElement {
  type: ElementType;
}

export function parseNastran(text: string, name = 'model.bdf'): EngineeringStudy {
  const nodes: EngineeringNode[] = [];
  const elements: EngineeringElement[] = [];
  const groups: EngineeringGroup[] = [];
  const materials: EngineeringMaterial[] = [];
  const boundaryConditions: BoundaryCondition[] = [];
  const nodeIdToIndex = new Map<number, number>();
  const rawElements: RawElement[] = [];
  const pressureCards: Array<{ pressure: number; elementIds: number[] }> = [];
  const metadata: Record<string, string> = {};
  let pending: PendingElement | null = null;
  let setCounter = 0;

  const ensureGroup = (label: string, dimension: number): EngineeringGroup => {
    let group = groups.find((g) => g.name === label && g.dimension === dimension);
    if (!group) {
      group = { dimension, tag: ++setCounter, name: label, members: [] };
      groups.push(group);
    }
    return group;
  };

  const flushElement = (): void => {
    if (!pending) return;
    const { id, keyword, pid, nodeIds: collected } = pending;
    pending = null;
    const type = ELEMENT_TOPOLOGY[keyword]?.[collected.length];
    if (!type) {
      const unsupported = UNSUPPORTED_TOPOLOGY[keyword]?.[collected.length];
      if (unsupported) {
        throw new NastranParseError(
          `element ${id}: ${keyword} with ${collected.length} nodes maps to ${unsupported}, which the kernel does not support`,
        );
      }
      const expected = ELEMENT_TOPOLOGY[keyword]
        ? Object.keys(ELEMENT_TOPOLOGY[keyword]).join('/')
        : 'a known topology';
      throw new NastranParseError(
        `element ${id}: ${keyword} has ${collected.length} node(s), expected ${expected}`,
      );
    }
    rawElements.push({ id, keyword, pid, nodeIds: collected, type });
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('$') || line.startsWith('C-') || line.startsWith('C ')) continue;

    if (isContinuationLine(raw)) {
      if (!pending) continue;
      pending.nodeIds.push(...nodeIds(continuationFields(raw)));
      if (pending.nodeIds.length >= maxNodeCount(pending.keyword)) flushElement();
      continue;
    }

    const free = line.includes(',');
    // Fixed-field columns are positional: keep the raw line's leading blanks.
    const parts = free ? freeFields(line) : fixedFields(raw);
    const keyword = cardKeyword(parts[0]);
    if (!keyword) continue;

    if (pending) flushElement();

    switch (keyword) {
      case 'GRID': {
        const id = num(parts[1]);
        const cp = num(parts[2]);
        if (cp !== 0) {
          throw new NastranParseError(`GRID ${id}: 暂不支持局部坐标系 CP=${cp}`);
        }
        if (nodeIdToIndex.has(id)) break;
        // CP/CD/PS occupy fields 3-5; coordinates are always fields 4-6.
        const index = nodes.length;
        nodeIdToIndex.set(id, index);
        nodes.push({
          id,
          x: num(parts[3]),
          y: num(parts[4]),
          z: num(parts[5]),
        });
        break;
      }
      case 'CTRIA3': case 'CTRIA6': case 'QUAD4': case 'CQUAD4':
      case 'CQUAD8': case 'CQUAD9': case 'CTETRA': case 'CHEXA':
      case 'CPENTA': case 'CPYRAM': {
        // Connectivity follows EID (field 2) and the optional PID (field 3).
        const card = keyword === 'QUAD4' ? 'CQUAD4' : keyword;
        pending = {
          id: num(parts[1]),
          keyword: card,
          pid: num(parts[2]),
          nodeIds: nodeIds(parts.slice(3)),
        };
        if (pending.nodeIds.length >= maxNodeCount(card)) flushElement();
        break;
      }
      case 'MAT1': {
        // MAT1,MID,E,G,NU,RHO — G is field 4, NU is field 5.
        const id = num(parts[1]);
        materials.push({
          name: `MAT${id}`,
          properties: { E: num(parts[2]), nu: num(parts[4]), rho: num(parts[5]) },
        });
        break;
      }
      case 'SPC1': {
        // SPC1,SID,DOFS,GID1,GID2,... — a list of GRIDs, not a range.
        const sid = num(parts[1]);
        const dofs = (parts[2] ?? '').split('').filter((c) => /\d/.test(c)).map(Number);
        const group = ensureGroup(`SPC-SPC1-${sid}`, 0);
        for (let i = 3; i < parts.length; i += 1) {
          const gid = num(parts[i]);
          if (gid <= 0) continue;
          const index = nodeIdToIndex.get(gid);
          if (index !== undefined) group.members.push(index);
        }
        const components: Record<number, number> = {};
        for (const dof of dofs) {
          if (dof >= 1 && dof <= 6) components[dof - 1] = 0;
        }
        boundaryConditions.push({
          name: group.name, kind: 'displacement',
          target: { dimension: 0, tag: group.tag }, components,
        });
        break;
      }
      case 'SPC': {
        // SPC,SID,GID,DOF,VALUE — one DOF per card.
        const sid = num(parts[1]);
        const gid = num(parts[2]);
        const dof = num(parts[3]);
        const value = num(parts[4]);
        const group = ensureGroup(`SPC-SPC-${sid}`, 0);
        const index = nodeIdToIndex.get(gid);
        if (index !== undefined) group.members.push(index);
        const components: Record<number, number> = {};
        if (dof >= 1 && dof <= 6) components[dof - 1] = value;
        boundaryConditions.push({
          name: group.name, kind: 'displacement',
          target: { dimension: 0, tag: group.tag }, components,
        });
        break;
      }
      case 'FORCE': {
        // FORCE,SID,GID,CID,F,N1,N2,N3 — F times the normalised direction.
        const sid = num(parts[1]);
        const gid = num(parts[2]);
        const node = nodeIdToIndex.get(gid);
        if (node === undefined) break;
        const magnitude = num(parts[4]);
        const n1 = num(parts[5]);
        const n2 = num(parts[6]);
        const n3 = num(parts[7]);
        const norm = Math.hypot(n1, n2, n3);
        if (norm === 0) {
          throw new NastranParseError(
            `FORCE ${sid}: direction vector is zero for GRID ${gid}`,
          );
        }
        const group = ensureGroup(`LOAD-${gid}`, 0);
        group.members.push(node);
        boundaryConditions.push({
          name: group.name, kind: 'force',
          target: { dimension: 0, tag: group.tag },
          components: {
            0: magnitude * n1 / norm,
            1: magnitude * n2 / norm,
            2: magnitude * n3 / norm,
          },
        });
        break;
      }
      case 'PLOAD2': {
        // PLOAD2,SID,P,ELID1,ELID2,... — resolved after the element table.
        const elementIds: number[] = [];
        for (let i = 3; i < parts.length; i += 1) {
          const id = num(parts[i]);
          if (id > 0) elementIds.push(id);
        }
        pressureCards.push({ pressure: num(parts[2]), elementIds });
        break;
      }
      default:
        break;
    }
  }
  flushElement();

  // Elements are resolved after the whole deck so GRIDs may appear after
  // their cards; dangling references are an error, never a silent drop.
  for (const raw of rawElements) {
    const connectivity = raw.nodeIds.map((label) => {
      const index = nodeIdToIndex.get(label);
      if (index === undefined) {
        throw new NastranParseError(`element ${raw.id}: GRID ${label} not found`);
      }
      return index;
    });
    elements.push({
      id: raw.id,
      type: raw.type,
      nodes: connectivity,
      ...(raw.pid > 0 ? { group: raw.pid } : {}),
    });
  }

  for (const card of pressureCards) {
    const elset = ensureGroup('PLOAD2', 2);
    for (const id of card.elementIds) {
      const index = elements.findIndex((el) => el.id === id);
      if (index >= 0) elset.members.push(index);
    }
    boundaryConditions.push({
      name: elset.name, kind: 'pressure',
      target: { dimension: 2, tag: elset.tag }, components: { 0: card.pressure },
    });
  }

  if (nodes.length === 0) throw new NastranParseError('no GRID cards found');
  metadata.elementCount = String(elements.length);
  return makeStudy(name, 'nastran', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    materials, boundaryConditions, metadata,
  });
}
