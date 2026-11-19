// ==========================================================================
// Ansys APDL .cdb/.dat adapter (ASCII) — pure TS
//
// Reads both the classic SOLID/FLOTRAN command stream (N, E/EN, ET, D, F,
// SF/SFE, MP) and the block format written by CDWRITE (`NBLOCK`/`EBLOCK`,
// which real .cdb exports use). Block records take precedence; the command
// parser remains as a fallback for hand-written decks.
//
// `ET,slot,type` stores the topology under an arbitrary user slot, so the
// *type* (name or legacy numeric id) is what matters, not the slot.
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

/** Ansys element name → neutral topology (more reliable than numeric ids). */
const ANSYS_NAMES: Record<string, ElementType> = {
  TRIA3: 'tri3', TRIA6: 'tri6', QUAD4: 'quad4', QUAD8: 'quad8', QUAD9: 'quad9',
  TET4: 'tet4', SOLID45: 'hex8', SOLID185: 'hex8', SOLID186: 'hex20',
  SOLID187: 'tet10', SOLID188: 'hex20', SOLID92: 'tet10', SOLID95: 'hex20',
  SOLID90: 'tet10', SOLID87: 'tet10', SOLID70: 'hex8', SOLID65: 'hex8',
  SOLID278: 'hex8', SOLID279: 'hex20', SOLID285: 'tet4', SOLID226: 'hex20',
  SOLID227: 'tet10', SHELL181: 'quad4', SHELL281: 'quad8', SHELL63: 'quad4',
  SHELL93: 'quad8', PLANE42: 'quad4', PLANE82: 'quad8', PLANE182: 'quad4',
  PLANE183: 'quad8', WEDGE6: 'wedge6', PYRAMID5: 'pyramid5',
};

/** Legacy Ansys element TYPE numbers (the 3rd ET field, never the slot). */
const ANSYS_TYPE_IDS: Record<number, ElementType> = {
  42: 'quad4', 45: 'hex8', 63: 'quad4', 65: 'hex8', 70: 'hex8', 82: 'quad8',
  87: 'tet10', 90: 'tet10', 92: 'tet10', 93: 'quad8', 95: 'hex20',
  181: 'quad4', 182: 'quad4', 183: 'quad8', 185: 'hex8', 186: 'hex20',
  187: 'tet10', 188: 'hex20', 226: 'hex20', 227: 'tet10', 278: 'hex8',
  279: 'hex20', 281: 'quad8', 285: 'tet4',
};

/** Total (corner + midside) node count for each topology. */
const FULL_NODE_COUNT: Partial<Record<ElementType, number>> = {
  point: 1,
  line2: 2, line3: 3,
  tri3: 3, tri6: 6,
  quad4: 4, quad8: 8, quad9: 9,
  tet4: 4, tet10: 10,
  hex8: 8, hex20: 20,
  wedge6: 6,
  pyramid5: 5,
};

/** Fallback topology when a declared type and its node count disagree. */
const NODE_COUNT_TYPE: Record<number, ElementType> = {
  2: 'line2', 3: 'tri3', 4: 'tet4', 5: 'pyramid5', 6: 'wedge6',
  8: 'hex8', 9: 'quad9', 10: 'tet10', 20: 'hex20',
};

/** Probe order used when an EBLOCK declares no type and no ET is active. */
const EBLOCK_INFER_ORDER = [8, 4, 6, 20, 10, 9, 5, 3, 2];

export class AnsysParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnsysParseError';
  }
}

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitFields(line: string): string[] {
  return line.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}

function isInteger(token: string | undefined): boolean {
  return token !== undefined && /^[-+]?\d+$/.test(token);
}

function isNumericToken(token: string | undefined): boolean {
  return token !== undefined && token !== '' && Number.isFinite(Number(token));
}

/** Resolve a topology from the declaration, cross-checked against node count. */
function resolveKind(declared: ElementType | null, nodeCount: number): ElementType {
  if (declared !== null && FULL_NODE_COUNT[declared] === nodeCount) return declared;
  const inferred = NODE_COUNT_TYPE[nodeCount];
  if (inferred) return inferred;
  return declared ?? 'polyhedron';
}

/** Guess nodes-per-record from an EBLOCK's flat numeric stream. */
function inferNodesPerElement(total: number): number | null {
  for (const per of EBLOCK_INFER_ORDER) {
    if (total >= per + 1 && total % (per + 1) === 0) return per;
  }
  return null;
}

export function parseAnsys(text: string, name = 'model.cdb'): EngineeringStudy {
  const nodes: EngineeringNode[] = [];
  const elements: EngineeringElement[] = [];
  const groups: EngineeringGroup[] = [];
  const materials: EngineeringMaterial[] = [];
  const boundaryConditions: BoundaryCondition[] = [];
  const nodeIdToIndex = new Map<number, number>();
  const metadata: Record<string, string> = {};
  let etKind: ElementType | null = null;
  let setCounter = 0;
  let nodesFromBlock = false;
  let elementsFromBlock = false;
  const lines = text.split(/\r?\n/);

  const ensureGroup = (label: string, dimension: number): EngineeringGroup => {
    let group = groups.find((g) => g.name === label && g.dimension === dimension);
    if (!group) {
      group = { dimension, tag: ++setCounter, name: label, members: [] };
      groups.push(group);
    }
    return group;
  };

  const addNode = (id: number, x: number, y: number, z: number): void => {
    if (nodeIdToIndex.has(id)) return;
    nodeIdToIndex.set(id, nodes.length);
    nodes.push({ id, x, y, z });
  };

  const addElement = (
    elementId: number | undefined,
    nodeIds: number[],
    declared: ElementType | null,
  ): void => {
    const indices = nodeIds
      .map((label) => nodeIdToIndex.get(label))
      .filter((index): index is number => index !== undefined);
    if (indices.length < 2) return;
    elements.push({
      id: elementId !== undefined && elementId > 0 ? elementId : elements.length + 1,
      type: resolveKind(declared, indices.length),
      nodes: indices,
    });
  };

  /** Consume an NBLOCK body; return the index of its last line. */
  const parseNodeBlock = (start: number): number => {
    let i = start;
    for (; i < lines.length; i += 1) {
      const line = (lines[i] ?? '').trim();
      if (!line) break;
      if (line.startsWith('!') || line.startsWith('(')) continue;
      const fields = splitFields(line);
      if (line === '-1' || fields[0] === '-1') { i += 1; break; }
      if (!isInteger(fields[0])) break;
      addNode(Number(fields[0]), num(fields[1]), num(fields[2]), num(fields[3]));
    }
    return i - 1;
  };

  /** Consume an EBLOCK body; records are `elemId` + N node labels. */
  const parseElementBlock = (headerIndex: number): number => {
    const header = splitFields((lines[headerIndex] ?? '').trim());
    let declared = etKind;
    for (let k = 2; k < header.length; k += 1) {
      const token = (header[k] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (ANSYS_NAMES[token]) { declared = ANSYS_NAMES[token] ?? null; break; }
      if (isInteger(header[k])) {
        const mapped = ANSYS_TYPE_IDS[Number(header[k])];
        if (mapped) { declared = mapped; break; }
      }
    }

    const tokens: number[] = [];
    let i = headerIndex + 1;
    for (; i < lines.length; i += 1) {
      const line = (lines[i] ?? '').trim();
      if (!line) break;
      if (line.startsWith('!') || line.startsWith('(')) continue;
      const fields = splitFields(line);
      if (fields[0] === '-1') { i += 1; break; }
      if (!fields.every(isNumericToken)) break;
      for (const field of fields) tokens.push(Number(field));
    }
    while (tokens.length > 0 && tokens[tokens.length - 1] === -1) tokens.pop();

    let per = declared !== null ? (FULL_NODE_COUNT[declared] ?? null) : null;
    // The trailing integer in the header is often the record count; use it to
    // disambiguate when the type is missing or contradicts the data.
    const headerInts = header.slice(2).filter(isInteger).map(Number);
    const declaredCount = headerInts.length > 0 ? headerInts[headerInts.length - 1] : undefined;
    if (
      declaredCount !== undefined && declaredCount > 0 &&
      tokens.length % declaredCount === 0
    ) {
      const perFromCount = tokens.length / declaredCount - 1;
      if (perFromCount >= 2 && perFromCount <= 30) per = perFromCount;
    }
    // A declared type whose record width disagrees with the data is wrong.
    if (per === null || tokens.length % (per + 1) !== 0) {
      per = inferNodesPerElement(tokens.length);
    }
    if (per === null) {
      const id = tokens[0];
      if (id !== undefined && tokens.length >= 3) addElement(id, tokens.slice(1), declared);
      return i - 1;
    }
    for (let cursor = 0; cursor + per < tokens.length; cursor += per + 1) {
      const id = tokens[cursor];
      if (id === undefined) break;
      addElement(id, tokens.slice(cursor + 1, cursor + 1 + per), declared);
    }
    return i - 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (!line || line.startsWith('!') || line.startsWith('/')) continue;
    const fields = splitFields(line);
    const cmd = (fields[0] ?? '').toUpperCase();

    if (cmd === 'NBLOCK') {
      if (!nodesFromBlock && elements.length === 0) {
        nodes.length = 0;
        nodeIdToIndex.clear();
      }
      nodesFromBlock = true;
      i = parseNodeBlock(i + 1);
      continue;
    }
    if (cmd === 'EBLOCK') {
      if (!elementsFromBlock) elements.length = 0;
      elementsFromBlock = true;
      i = parseElementBlock(i);
      continue;
    }

    switch (cmd) {
      case 'ET': {
        // ET,slot,type — the slot is arbitrary; only the type identifies topology.
        const typeToken = (fields[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        let kind: ElementType | undefined = ANSYS_NAMES[typeToken];
        if (!kind && isInteger(fields[2])) kind = ANSYS_TYPE_IDS[Number(fields[2])];
        etKind = kind ?? null;
        break;
      }
      case 'N': {
        addNode(num(fields[1]), num(fields[2]), num(fields[3]), num(fields[4]));
        break;
      }
      case 'E': case 'EN': {
        if (elementsFromBlock) break;
        const elemId = cmd === 'EN' ? num(fields[1]) : undefined;
        const nodeIds = fields.slice(cmd === 'EN' ? 2 : 1)
          .filter(isInteger)
          .map(Number);
        // SOLID186 etc. may continue on the following pure-numeric lines.
        const expected = etKind !== null ? (FULL_NODE_COUNT[etKind] ?? null) : null;
        let j = i + 1;
        while (expected !== null && nodeIds.length < expected && j < lines.length) {
          const cont = (lines[j] ?? '').trim();
          if (!cont || cont.startsWith('!') || cont.startsWith('/')) break;
          const contFields = splitFields(cont);
          if (!contFields.every(isInteger)) break;
          nodeIds.push(...contFields.map(Number));
          j += 1;
        }
        i = j - 1;
        addElement(elemId, nodeIds, etKind);
        break;
      }
      case 'MP': {
        // MP,EX,mat,value / MP,PRXY,mat,value / MP,DENS,mat,value
        const prop = (fields[1] ?? '').toUpperCase();
        const matId = num(fields[2]);
        let material = materials.find((m) => m.name === `MAT${matId}`);
        if (!material) {
          material = { name: `MAT${matId}`, properties: {} };
          materials.push(material);
        }
        const key = prop === 'EX' ? 'E' : prop === 'PRXY' || prop === 'NUXY' ? 'nu' : prop === 'DENS' ? 'rho' : prop;
        material.properties[key] = num(fields[3]);
        break;
      }
      case 'D': {
        // D,node,dof,value — dof string like UX / UY / ALL / 1
        const node = nodeIdToIndex.get(num(fields[1]));
        if (node === undefined) break;
        const dof = (fields[2] ?? '').toUpperCase();
        const group = ensureGroup(`D-${dof}`, 0);
        group.members.push(node);
        const components: Record<number, number> = {};
        if (dof === 'ALL') {
          components[0] = 0;
          components[1] = 0;
          components[2] = 0;
        }
        else if (dof.startsWith('UX') || dof === '1') components[0] = num(fields[3]);
        else if (dof.startsWith('UY') || dof === '2') components[1] = num(fields[3]);
        else if (dof.startsWith('UZ') || dof === '3') components[2] = num(fields[3]);
        boundaryConditions.push({
          name: group.name, kind: 'displacement',
          target: { dimension: 0, tag: group.tag }, components,
        });
        break;
      }
      case 'F': {
        const node = nodeIdToIndex.get(num(fields[1]));
        if (node === undefined) break;
        const dof = (fields[2] ?? '').toUpperCase();
        const group = ensureGroup(`F-${num(fields[1])}`, 0);
        group.members.push(node);
        const value = num(fields[3]);
        const component = dof.startsWith('FY') || dof === '2' ? 1 : dof.startsWith('FZ') || dof === '3' ? 2 : 0;
        boundaryConditions.push({
          name: group.name, kind: 'force',
          target: { dimension: 0, tag: group.tag }, components: { [component]: value },
        });
        break;
      }
      case 'SF': case 'SFE': {
        const pressure = num(fields[3] ?? fields[2]);
        const elset = ensureGroup('SFE', 2);
        const elId = num(fields[1]);
        const index = elements.findIndex((el) => el.id === elId);
        if (index >= 0) elset.members.push(index);
        boundaryConditions.push({
          name: elset.name, kind: 'pressure',
          target: { dimension: 2, tag: elset.tag }, components: { 0: pressure },
        });
        break;
      }
      default:
        break;
    }
  }

  if (nodes.length === 0) throw new AnsysParseError('no nodes found (N commands or NBLOCK expected)');
  metadata.elementCount = String(elements.length);
  return makeStudy(name, 'ansys', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    materials, boundaryConditions, metadata,
  });
}
