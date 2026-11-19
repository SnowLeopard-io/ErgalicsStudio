// ==========================================================================
// Ansys APDL .cdb/.dat adapter (ASCII) — pure TS
//
// Reads the classic SOLID/FLOTRAN model commands: N (nodes), E/EN (elements
// with the current ET type), D (constraints), F (nodal force), SF/SFE
// (surface loads), MP (linear material properties). Command lines are
// comma-separated and may continue with a trailing comma.
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

const ANSYS_ELEMENTS: Record<number, ElementType> = {
  1: 'tri3', 2: 'quad4', 3: 'tet4', 4: 'hex8', 5: 'wedge6',
  6: 'pyramid5', 8: 'tet10', 11: 'quad8', 12: 'hex20',
  13: 'tri6', 25: 'quad9',
};

/** Ansys element NAME → our topology (more reliable than the numeric id). */
const ANSYS_NAMES: Record<string, ElementType> = {
  TRIA3: 'tri3', TRIA6: 'tri6', QUAD4: 'quad4', QUAD8: 'quad8', QUAD9: 'quad9',
  TET4: 'tet4', SOLID45: 'hex8', SOLID185: 'hex8', SOLID186: 'hex20',
  SOLID187: 'tet10', SOLID92: 'tet10', SOLID95: 'hex20',
  WEDGE6: 'wedge6', PYRAMID5: 'pyramid5',
};

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

export function parseAnsys(text: string, name = 'model.cdb'): EngineeringStudy {
  const nodes: EngineeringNode[] = [];
  const elements: EngineeringElement[] = [];
  const groups: EngineeringGroup[] = [];
  const materials: EngineeringMaterial[] = [];
  const boundaryConditions: BoundaryCondition[] = [];
  const nodeIdToIndex = new Map<number, number>();
  const metadata: Record<string, string> = {};
  let etType = 3; // default to tet4
  let etName = '';
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
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('/')) continue;
    const parts = line.split(',').map((v) => v.trim());
    const cmd = (parts[0] ?? '').toUpperCase();
    switch (cmd) {
      case 'ET': {
        etType = num(parts[1]);
        etName = (parts[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        break;
      }
      case 'N': {
        const id = num(parts[1]);
        if (nodeIdToIndex.has(id)) break;
        const index = nodes.length;
        nodeIdToIndex.set(id, index);
        nodes.push({ id, x: num(parts[2]), y: num(parts[3]), z: num(parts[4]) });
        break;
      }
      case 'E': case 'EN': {
        const nodeIndices = parts.slice(1)
          .map(num)
          .map((label) => nodeIdToIndex.get(label))
          .filter((index): index is number => index !== undefined);
        if (nodeIndices.length >= 2) {
          elements.push({
            id: elements.length + 1,
            type: ANSYS_NAMES[etName] ?? ANSYS_ELEMENTS[etType] ?? 'polyhedron',
            nodes: nodeIndices,
          });
        }
        break;
      }
      case 'MP': {
        // MP,EX,mat,value / MP,PRXY,mat,value / MP,DENS,mat,value
        const prop = (parts[1] ?? '').toUpperCase();
        const matId = num(parts[2]);
        let material = materials.find((m) => m.name === `MAT${matId}`);
        if (!material) {
          material = { name: `MAT${matId}`, properties: {} };
          materials.push(material);
        }
        const key = prop === 'EX' ? 'E' : prop === 'PRXY' || prop === 'NUXY' ? 'nu' : prop === 'DENS' ? 'rho' : prop;
        material.properties[key] = num(parts[3]);
        break;
      }
      case 'D': {
        // D,node,dof,value — dof string like UX / UY / ALL / 1
        const node = nodeIdToIndex.get(num(parts[1]));
        if (node === undefined) break;
        const dof = (parts[2] ?? '').toUpperCase();
        const group = ensureGroup(`D-${dof}`, 0);
        group.members.push(node);
        const components: Record<number, number> = {};
        if (dof === 'ALL') {
          components[0] = 0;
          components[1] = 0;
          components[2] = 0;
        }
        else if (dof.startsWith('UX') || dof === '1') components[0] = num(parts[3]);
        else if (dof.startsWith('UY') || dof === '2') components[1] = num(parts[3]);
        else if (dof.startsWith('UZ') || dof === '3') components[2] = num(parts[3]);
        boundaryConditions.push({
          name: group.name, kind: 'displacement',
          target: { dimension: 0, tag: group.tag }, components,
        });
        break;
      }
      case 'F': {
        const node = nodeIdToIndex.get(num(parts[1]));
        if (node === undefined) break;
        const dof = (parts[2] ?? '').toUpperCase();
        const group = ensureGroup(`F-${num(parts[1])}`, 0);
        group.members.push(node);
        const value = num(parts[3]);
        const component = dof.startsWith('FY') || dof === '2' ? 1 : dof.startsWith('FZ') || dof === '3' ? 2 : 0;
        boundaryConditions.push({
          name: group.name, kind: 'force',
          target: { dimension: 0, tag: group.tag }, components: { [component]: value },
        });
        break;
      }
      case 'SF': case 'SFE': {
        const pressure = num(parts[3] ?? parts[2]);
        const elset = ensureGroup('SFE', 2);
        const elId = num(parts[1]);
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

  if (nodes.length === 0) throw new AnsysParseError('no N (node) commands found');
  metadata.elementCount = String(elements.length);
  return makeStudy(name, 'ansys', { nodes, elements, groups, bounds: [0, 0, 0, 0, 0, 0] }, {
    materials, boundaryConditions, metadata,
  });
}
