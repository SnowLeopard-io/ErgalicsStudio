// ==========================================================================
// Nastran .bdf/.dat adapter (free-field and fixed-field ASCII) — pure TS
//
// Reads the bulk-data entries that define an analysis model: GRID (nodes),
// element connectivity (CTRIA3/CQUAD4/CTETRA/CHEXA/CPENTA/CTRIA6/CQUAD8),
// GRID-set constraints (SPC/SPC1) and loads (FORCE/PLOAD2). The executable
// and case-control lines are ignored. This is the most widely deployed
// structured-CAE exchange format, so supporting it makes the workbench
// interoperable with Nastran/Patran/Femap workflows.
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

const NASTRAN_ELEMENTS: Record<string, ElementType> = {
  CTRIA3: 'tri3', CTRIA6: 'tri6',
  CQUAD4: 'quad4', CQUAD8: 'quad8', CQUAD9: 'quad9',
  CTETRA: 'tet4', CTETRA10: 'tet10',
  CHEXA: 'hex8', CPENTA: 'wedge6', CPYRAM: 'pyramid5',
};

export class NastranParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NastranParseError';
  }
}

/** Parse one BDF data line into fields (free `,` or fixed 8-char fields). */
function fields(line: string): string[] {
  if (line.includes(',')) return line.split(',').map((v) => v.trim());
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 8) out.push(line.slice(i, i + 8).trim());
  return out.filter((v) => v.length > 0);
}

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNastran(text: string, name = 'model.bdf'): EngineeringStudy {
  const nodes: EngineeringNode[] = [];
  const elements: EngineeringElement[] = [];
  const groups: EngineeringGroup[] = [];
  const materials: EngineeringMaterial[] = [];
  const boundaryConditions: BoundaryCondition[] = [];
  const nodeIdToIndex = new Map<number, number>();
  const metadata: Record<string, string> = {};
  let continued = false;
  let pendingType = '';
  let setCounter = 0;

  const ensureGroup = (label: string, dimension: number): EngineeringGroup => {
    let group = groups.find((g) => g.name === label && g.dimension === dimension);
    if (!group) {
      group = { dimension, tag: ++setCounter, name: label, members: [] };
      groups.push(group);
    }
    return group;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, ',').trim();
    if (!line || line.startsWith('$') || line.startsWith('C-') || line.startsWith('C ')) continue;
    // Continuation lines begin with a blank/comma field in fixed form.
    const isContinuation = /^[,\s]/.test(raw) && continued;
    const parts = fields(isContinuation ? raw.trimStart() : line);
    const keyword = isContinuation ? pendingType : (parts[0] ?? '').toUpperCase();
    if (!isContinuation) pendingType = keyword;
    continued = line.endsWith(',');

    switch (keyword) {
      case 'GRID': {
        const id = num(parts[1]);
        if (nodeIdToIndex.has(id)) break;
        // Free field: GRID,ID,CP,X1,X2,X3 ; fixed field has CP at index 2.
        const coordStart = parts.length > 6 ? 4 : 3;
        const index = nodes.length;
        nodeIdToIndex.set(id, index);
        nodes.push({
          id,
          x: num(parts[coordStart]),
          y: num(parts[coordStart + 1]),
          z: num(parts[coordStart + 2]),
        });
        break;
      }
      case 'CTRIA3': case 'CTRIA6': case 'QUAD4': case 'CQUAD4':
      case 'CQUAD8': case 'CQUAD9': case 'CTETRA': case 'CHEXA':
      case 'CPENTA': case 'CPYRAM': {
        const type = NASTRAN_ELEMENTS[keyword === 'QUAD4' ? 'CQUAD4' : keyword] ?? 'polyhedron';
        const id = num(parts[1]);
        // Connectivity fields follow the (optional) PID field. A numeric PID
        // is present for most elements; skip it when it looks like a node id.
        const nodeStart = 3;
        const nodeIds = parts.slice(nodeStart).map(num).filter((v) => v > 0);
        const nodeIndices = nodeIds
          .map((label) => nodeIdToIndex.get(label))
          .filter((index): index is number => index !== undefined);
        if (nodeIndices.length >= 2) {
          const pid = num(parts[2]);
          elements.push({
            id,
            type,
            nodes: nodeIndices,
            ...(pid > 0 ? { group: pid } : {}),
          });
        }
        break;
      }
      case 'MAT1': {
        const id = num(parts[1]);
        materials.push({
          name: `MAT${id}`,
          properties: { E: num(parts[2]), nu: num(parts[3]), rho: num(parts[5]) },
        });
        break;
      }
      case 'SPC': case 'SPC1': {
        // SPC1,SID,DOFS,GID1,GID2,... (a node range)
        const dofs = (parts[2] ?? '').split('').filter((c) => /\d/.test(c)).map(Number);
        const from = num(parts[3]);
        const to = parts.length > 4 ? num(parts[4]) : from;
        const group = ensureGroup(`SPC-${keyword}-${from}`, 0);
        for (let id = from; id <= to; id += 1) {
          const index = nodeIdToIndex.get(id);
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
      case 'FORCE': {
        // FORCE,SID,GID,CID,F,FX,FY,FZ
        const node = nodeIdToIndex.get(num(parts[2]));
        if (node === undefined) break;
        const group = ensureGroup(`LOAD-${num(parts[2])}`, 0);
        group.members.push(node);
        const magnitude = num(parts[5]);
        boundaryConditions.push({
          name: group.name, kind: 'force',
          target: { dimension: 0, tag: group.tag },
          components: { 0: magnitude * num(parts[6]), 1: magnitude * num(parts[7]), 2: magnitude * num(parts[8]) },
        });
        break;
      }
      case 'PLOAD2': {
        // PLOAD2,SID,P,ELID1,ELID2,...
        const pressure = num(parts[2]);
        const elset = ensureGroup('PLOAD2', 2);
        for (let i = 3; i < parts.length; i += 1) {
          const id = num(parts[i]);
          const index = elements.findIndex((el) => el.id === id);
          if (index >= 0) elset.members.push(index);
        }
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

  if (nodes.length === 0) throw new NastranParseError('no GRID cards found');
  metadata.elementCount = String(elements.length);
  return makeStudy(name, 'nastran', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    materials, boundaryConditions, metadata,
  });
}
