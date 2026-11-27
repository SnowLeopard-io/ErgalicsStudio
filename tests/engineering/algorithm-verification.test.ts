// ==========================================================================
// 工业求解链路（EngineeringStudy → 2D/3D 内核）正确性校验
//
// 覆盖：常规拉伸/剪切/导热/势流、边界与零值、极大/极小数值、非法材料与
// 拓扑、瞬态极端步长、3D 退化单元，并用解析解输出误差台账。
// ==========================================================================

import { afterAll, describe, expect, it } from 'vitest';
import { rectStructuredMesh } from '@ergalics/sci-kernels/fem/mesh/domain';
import {
  meshBounds,
  type EngineeringElement,
  type EngineeringGroup,
  type EngineeringMaterial,
  type EngineeringMesh,
  type EngineeringStep,
  type EngineeringStudy,
  type EngineeringSolveResult,
  makeStudy,
} from '../../apps/studio/src/core/engineering/types';
import { makeStep } from '../../apps/studio/src/core/engineering/cases';
import { solveEngineeringStudy } from '../../apps/studio/src/core/engineering/solve';
import { solve3DSteadyHeat, Solve3DError } from '../../apps/studio/src/core/engineering/solve3d';
import { nodeCount, nodeX, nodeY, type PlanarMesh } from '@ergalics/sci-kernels/fem/mesh/types';

// ---- 精度台账：测试结束时统一打印，便于交付审阅 --------------------------

interface AccuracyRow {
  算例: string;
  参考解: string;
  实测误差: string;
  门槛: string;
  结论: string;
}

const ledger: AccuracyRow[] = [];

function record(caseName: string, reference: string, error: number, limit: number): void {
  ledger.push({
    算例: caseName,
    参考解: reference,
    实测误差: error.toExponential(2),
    门槛: limit.toExponential(0),
    结论: error <= limit ? 'PASS' : 'FAIL',
  });
}

afterAll(() => {
  console.table(ledger);
});

// ---- 工程模型构造助手 ------------------------------------------------------

/**
 * 把 2D 平面网格包装成工程网格：tri3 为体单元，每条边界边生成一个 line2
 * 单元并挂到 dimension-1 组，完全复刻 Gmsh 的物理组语义（压力/热流按边标签
 * 定位，而不是按相邻体单元猜测）。
 */
function toEngineeringMesh(planar: PlanarMesh, nodeGroups: EngineeringGroup[] = []): EngineeringMesh {
  const nodes = Array.from({ length: nodeCount(planar) }, (_, i) => ({
    id: i + 1,
    x: nodeX(planar, i),
    y: nodeY(planar, i),
    z: 0,
  }));
  const elements: EngineeringElement[] = planar.elements.map((element, i) => ({
    id: i + 1,
    type: 'tri3',
    nodes: [element.a, element.b, element.c],
    group: element.tag,
  }));
  const groups = [...nodeGroups];
  const lineByTag = new Map<number, number[]>();
  for (const edge of planar.boundaryEdges) {
    if (edge.tag === 0) continue;
    const index = elements.length;
    elements.push({ id: 100000 + index, type: 'line2', nodes: [edge.a, edge.b], group: edge.tag });
    const list = lineByTag.get(edge.tag) ?? [];
    list.push(index);
    lineByTag.set(edge.tag, list);
  }
  for (const [tag, members] of lineByTag) {
    groups.push({ dimension: 1, tag, name: `edge-${tag}`, members });
  }
  return { nodes, elements, groups, bounds: meshBounds(nodes) };
}

function nodeGroup(tag: number, name: string, members: number[]): EngineeringGroup {
  return { dimension: 0, tag, name, members };
}

function nodesWhere(mesh: PlanarMesh, predicate: (x: number, y: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < nodeCount(mesh); i += 1) {
    if (predicate(nodeX(mesh, i), nodeY(mesh, i))) out.push(i);
  }
  return out;
}

interface StudyOptions {
  materials?: EngineeringMaterial[];
  boundaryConditions?: EngineeringStudy['boundaryConditions'];
  nodeGroups?: EngineeringGroup[];
  step?: EngineeringStep;
}

const STEEL: EngineeringMaterial = { name: 'steel', properties: { E: 2e11, nu: 0.3, rho: 7850, k: 45, cp: 470 } };

function buildStudy(planar: PlanarMesh, options: StudyOptions = {}): EngineeringStudy {
  const mesh = toEngineeringMesh(planar, options.nodeGroups ?? []);
  return makeStudy('verify', 'gmsh', mesh, {
    materials: options.materials ?? [STEEL],
    boundaryConditions: options.boundaryConditions ?? [],
    cases: [{
      name: 'case-1',
      steps: [options.step ?? makeStep('Static', 'static-structural')],
      design: { parameters: [], points: [] },
    }],
  });
}

function fieldOf(result: EngineeringSolveResult, name: string): Float64Array {
  const field = result.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`missing field ${name}`);
  return field.values;
}

function relativeError(actual: ArrayLike<number>, reference: ArrayLike<number>): number {
  let maxRef = 0;
  let maxErr = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxRef = Math.max(maxRef, Math.abs(reference[i]!));
    maxErr = Math.max(maxErr, Math.abs(actual[i]! - reference[i]!));
  }
  return maxRef === 0 ? maxErr : maxErr / maxRef;
}

// ---- 2D 结构静力 -----------------------------------------------------------

describe('2D 结构静力：解析参考解与边界场景', () => {
  const W = 2;
  const H = 1;

  function barStudy(
    E: number,
    traction: number,
    state: 'plane-stress' | 'plane-strain' = 'plane-stress',
    thickness = 1,
  ): EngineeringStudy {
    const planar = rectStructuredMesh(W, H, 8, 4);
    return buildStudy(planar, {
      materials: [{ name: 'steel', properties: { E, nu: 0.3 } }],
      nodeGroups: [
        nodeGroup(11, 'left', nodesWhere(planar, (x) => Math.abs(x) < 1e-9)),
        nodeGroup(12, 'origin', [0]),
      ],
      boundaryConditions: [
        { name: 'fix-x', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0 } },
        { name: 'fix-y', kind: 'displacement', target: { dimension: 0, tag: 12 }, components: { 1: 0 } },
        { name: 'pull', kind: 'traction', target: { dimension: 1, tag: 2 }, components: { 0: traction } },
      ],
      step: makeStep('Static', 'static-structural', { planeState: state, thickness }),
    });
  }

  it('单轴拉伸（平面应力）精确复现 ux=σx/E、uy=−νσx/E', () => {
    const E = 2e11;
    const sigma = 100;
    const result = solveEngineeringStudy(barStudy(E, sigma));
    const planar = rectStructuredMesh(W, H, 8, 4);
    const u = fieldOf(result, 'displacement');
    const reference = new Float64Array(nodeCount(planar) * 3);
    for (let i = 0; i < nodeCount(planar); i += 1) {
      reference[i * 3] = (sigma / E) * nodeX(planar, i);
      reference[i * 3 + 1] = (-0.3 * sigma / E) * nodeY(planar, i);
    }
    const error = relativeError(u, reference);
    expect(error).toBeLessThan(1e-9);
    record('单轴拉伸（平面应力）', 'ux=σx/E, uy=−νσx/E', error, 1e-9);
    const stress = fieldOf(result, 'stress');
    for (let e = 0; e < planar.elements.length; e += 1) {
      expect(stress[e * 3]).toBeCloseTo(sigma, 4);
    }
  });

  it('单轴拉伸（平面应变）斜率符合 σ(1−ν²)/E', () => {
    const E = 2e11;
    const nu = 0.3;
    const sigma = 100;
    const result = solveEngineeringStudy(barStudy(E, sigma, 'plane-strain'));
    const planar = rectStructuredMesh(W, H, 8, 4);
    // 平面应变：εz = 0 ⇒ εx = σ(1−ν²)/E，εy = −ν/(1−ν)·εx。
    const strainX = (sigma * (1 - nu * nu)) / E;
    const u = fieldOf(result, 'displacement');
    const reference = new Float64Array(nodeCount(planar) * 3);
    for (let i = 0; i < nodeCount(planar); i += 1) {
      reference[i * 3] = strainX * nodeX(planar, i);
      reference[i * 3 + 1] = (-nu / (1 - nu)) * strainX * nodeY(planar, i);
    }
    const error = relativeError(u, reference);
    expect(error).toBeLessThan(1e-9);
    record('单轴拉伸（平面应变）', 'εx=σ(1−ν²)/E', error, 1e-9);
  });

  it('压力载荷方向与量值正确（右边界向内压缩）', () => {
    const E = 2e11;
    const pressure = 50;
    const planar = rectStructuredMesh(W, H, 6, 3);
    const study = buildStudy(planar, {
      nodeGroups: [
        nodeGroup(11, 'left', nodesWhere(planar, (x) => Math.abs(x) < 1e-9)),
        nodeGroup(12, 'origin', [0]),
      ],
      boundaryConditions: [
        { name: 'fix-x', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0 } },
        { name: 'fix-y', kind: 'displacement', target: { dimension: 0, tag: 12 }, components: { 1: 0 } },
        { name: 'press', kind: 'pressure', target: { dimension: 1, tag: 2 }, components: { 0: pressure } },
      ],
    });
    const result = solveEngineeringStudy(study);
    const u = fieldOf(result, 'displacement');
    const reference = new Float64Array(nodeCount(planar) * 3);
    for (let i = 0; i < nodeCount(planar); i += 1) {
      reference[i * 3] = (-pressure / E) * nodeX(planar, i);
      // 单轴压缩（σy = 0）的横向泊松膨胀。
      reference[i * 3 + 1] = (0.3 * pressure / E) * nodeY(planar, i);
    }
    const error = relativeError(u, reference);
    expect(error).toBeLessThan(1e-9);
    record('右侧均布压力', 'ux=−p·x/E', error, 1e-9);
  });

  it('全边界给定位移（刚体平移）：内部节点精确、应力为零', () => {
    const planar = rectStructuredMesh(W, H, 4, 2);
    const boundary = nodesWhere(planar, (x, y) => x === 0 || x === W || y === 0 || y === H);
    const study = buildStudy(planar, {
      nodeGroups: [nodeGroup(13, 'boundary', boundary)],
      boundaryConditions: [
        { name: 'tx', kind: 'displacement', target: { dimension: 0, tag: 13 }, components: { 0: 3 } },
        { name: 'ty', kind: 'displacement', target: { dimension: 0, tag: 13 }, components: { 1: -2 } },
      ],
    });
    const result = solveEngineeringStudy(study);
    const u = fieldOf(result, 'displacement');
    // 精确消元下给定自由度必须严格等于给定值（默认容差 1e-10 也不得被
    // Dirichlet 右端修正项的巨大量级“淹没”）。
    for (let i = 0; i < nodeCount(planar); i += 1) {
      expect(u[i * 3]).toBeCloseTo(3, 9);
      expect(u[i * 3 + 1]).toBeCloseTo(-2, 9);
    }
    const mises = fieldOf(result, 'vonMises');
    expect(Math.max(...Array.from(mises).map(Math.abs))).toBeLessThan(1e-3);
  });

  it('零载荷：位移与应力严格为零（无随机漂移）', () => {
    const planar = rectStructuredMesh(W, H, 4, 2);
    const study = buildStudy(planar, {
      nodeGroups: [
        nodeGroup(11, 'left', nodesWhere(planar, (x) => Math.abs(x) < 1e-9)),
        nodeGroup(12, 'origin', [0]),
      ],
      boundaryConditions: [
        { name: 'fix-x', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0 } },
        { name: 'fix-y', kind: 'displacement', target: { dimension: 0, tag: 12 }, components: { 1: 0 } },
      ],
    });
    const result = solveEngineeringStudy(study);
    expect(result.metrics.maxDisplacement).toBe(0);
    expect(result.metrics.max_vonMises).toBe(0);
    expect(Math.max(...Array.from(fieldOf(result, 'displacement')).map(Math.abs))).toBe(0);
  });

  it('极大/极小材料与载荷保持线性缩放（1e−12 ~ 1e12）', () => {
    const reference = solveEngineeringStudy(barStudy(2e11, 100));
    const planar = rectStructuredMesh(W, H, 8, 4);
    const referenceU = fieldOf(reference, 'displacement');
    const cases: Array<[string, number, number]> = [
      ['E=2e15, σ=1e6', 2e15, 1e6],
      ['E=2e5, σ=1e-4', 2e5, 1e-4],
      ['E=2e11, σ=1e-12', 2e11, 1e-12],
      ['E=2e11, σ=1e12', 2e11, 1e12],
    ];
    for (const [label, modulus, traction] of cases) {
      const result = solveEngineeringStudy(barStudy(modulus, traction));
      const expected = new Float64Array(nodeCount(planar) * 3);
      for (let i = 0; i < nodeCount(planar); i += 1) {
        expected[i * 3] = (traction / modulus) * nodeX(planar, i);
        expected[i * 3 + 1] = (-0.3 * traction / modulus) * nodeY(planar, i);
      }
      const error = relativeError(fieldOf(result, 'displacement'), expected);
      expect(error, label).toBeLessThan(1e-8);
      record(`量级 ${label}`, '同参考拉伸场', error, 1e-8);
    }
    // 线性系统解应与参考场严格同比。
    expect(relativeError(referenceU, referenceU)).toBe(0);
  });

  it('非法材料/几何输入给出明确错误而非 NaN 结果', () => {
    expect(() => solveEngineeringStudy(barStudy(0, 100))).toThrow(/Young/);
    expect(() => solveEngineeringStudy(barStudy(-1, 100))).toThrow(/Young/);
    expect(() => solveEngineeringStudy(barStudy(2e11, 100, 'plane-stress', 0))).toThrow(/thickness/);
    expect(() => solveEngineeringStudy(barStudy(2e11, 100, 'plane-stress', -2))).toThrow(/thickness/);

    const planar = rectStructuredMesh(1, 1, 2, 2);
    const badNu = buildStudy(planar, {
      materials: [{ name: 'bad', properties: { E: 1, nu: 0.5 } }],
      nodeGroups: [nodeGroup(11, 'left', nodesWhere(planar, (x) => x === 0))],
      boundaryConditions: [
        { name: 'fix', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0, 1: 0 } },
      ],
    });
    expect(() => solveEngineeringStudy(badNu)).toThrow(/Poisson/);

    const badK = buildStudy(planar, {
      materials: [{ name: 'bad', properties: { E: 1, nu: 0.3, k: 0 } }],
      nodeGroups: [nodeGroup(21, 'left', [0]), nodeGroup(22, 'right', [2])],
      boundaryConditions: [
        { name: 'cold', kind: 'temperature', target: { dimension: 0, tag: 21 }, components: { 0: 0 } },
        { name: 'hot', kind: 'temperature', target: { dimension: 0, tag: 22 }, components: { 0: 1 } },
      ],
      step: makeStep('Heat', 'steady-heat'),
    });
    expect(() => solveEngineeringStudy(badK)).toThrow(/conductivity/);
  });

  it('缺少约束/温度边界时抛出领域错误', () => {
    const planar = rectStructuredMesh(1, 1, 2, 2);
    expect(() => solveEngineeringStudy(buildStudy(planar, { boundaryConditions: [] }))).toThrow(/displacement constraint/);

    const noTemp = buildStudy(planar, { step: makeStep('Heat', 'steady-heat') });
    expect(() => solveEngineeringStudy(noTemp)).toThrow(/temperature boundary/);

    const noFlow = buildStudy(planar, { step: makeStep('Flow', 'potential-flow') });
    expect(() => solveEngineeringStudy(noFlow)).toThrow(/pressure\/potential/);
  });

  it('不支持的分析类型与退化网格被拒绝', () => {
    const planar = rectStructuredMesh(1, 1, 2, 2);
    const unsupported = buildStudy(planar, {
      step: { ...makeStep('Modal', 'static-structural'), kind: 'modal' as EngineeringStep['kind'] },
    });
    expect(() => solveEngineeringStudy(unsupported)).toThrow(/unsupported step kind/);

    const degenerate: PlanarMesh = {
      nodes: Float64Array.from([0, 0, 1, 0, 2, 0]),
      nodeTags: new Int32Array(3),
      elements: [{ a: 0, b: 1, c: 2, tag: 0 }],
      boundaryEdges: [],
    };
    const degenerateStudy = buildStudy(degenerate, {
      nodeGroups: [nodeGroup(11, 'all', [0, 1, 2])],
      boundaryConditions: [
        { name: 'fix', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0, 1: 0 } },
      ],
    });
    expect(() => solveEngineeringStudy(degenerateStudy)).toThrow(/degenerate element/);
  });
});

// ---- 稳态/瞬态热与势流 -----------------------------------------------------

describe('热传导与势流：解析场、极端系数与非法输入', () => {
  function heatStudy(k: number, leftTemp = 0, rightTemp = 1, flux?: number): EngineeringStudy {
    const planar = rectStructuredMesh(1, 1, 8, 4);
    const boundaryConditions: EngineeringStudy['boundaryConditions'] = [
      { name: 'left', kind: 'temperature', target: { dimension: 0, tag: 21 }, components: { 0: leftTemp } },
    ];
    if (flux === undefined) {
      boundaryConditions.push({
        name: 'right', kind: 'temperature', target: { dimension: 0, tag: 22 }, components: { 0: rightTemp },
      });
    } else {
      boundaryConditions.push({
        name: 'flux', kind: 'heat-flux', target: { dimension: 1, tag: 2 }, components: { 0: flux },
      });
    }
    return buildStudy(planar, {
      materials: [{ name: 'm', properties: { k, rho: 1000, cp: 500 } }],
      nodeGroups: [
        nodeGroup(21, 'left', nodesWhere(planar, (x) => Math.abs(x) < 1e-9)),
        nodeGroup(22, 'right', nodesWhere(planar, (x) => Math.abs(x - 1) < 1e-9)),
      ],
      boundaryConditions,
      step: makeStep('Heat', 'steady-heat'),
    });
  }

  it('线性温度场 T=x 精确复现，热流幅值等于 k', () => {
    const k = 3;
    const result = solveEngineeringStudy(heatStudy(k));
    const planar = rectStructuredMesh(1, 1, 8, 4);
    const reference = new Float64Array(nodeCount(planar));
    for (let i = 0; i < nodeCount(planar); i += 1) reference[i] = nodeX(planar, i);
    const error = relativeError(fieldOf(result, 'temperature'), reference);
    expect(error).toBeLessThan(1e-10);
    record('稳态导热 T=x', 'T(x)=x, |q|=k', error, 1e-10);
    for (const flux of fieldOf(result, 'heatFlux')) expect(flux).toBeCloseTo(k, 8);
  });

  it('极大/极小导热系数下的热流问题保持线性精确', () => {
    const planar = rectStructuredMesh(1, 1, 8, 4);
    for (const [k, q] of [[1e15, 1e9], [1e-9, 1e-9]] as const) {
      const study = heatStudy(k, 0, 1, q);
      // 右侧温度条件被置空后，仅剩热流；解析斜率 q/k。
      const result = solveEngineeringStudy(study);
      const slope = q / k;
      const reference = new Float64Array(nodeCount(planar));
      for (let i = 0; i < nodeCount(planar); i += 1) reference[i] = slope * nodeX(planar, i);
      const error = relativeError(fieldOf(result, 'temperature'), reference);
      expect(error, `k=${k}`).toBeLessThan(1e-8);
      record(`热流 k=${k}`, `T=q·x/k`, error, 1e-8);
    }
  });

  it('零源项 + 全零边界：温度恒为零', () => {
    const result = solveEngineeringStudy(heatStudy(5, 0, 0));
    expect(Math.max(...Array.from(fieldOf(result, 'temperature')).map(Math.abs))).toBe(0);
  });

  it('非法热流边界（无匹配边）与非有限源项被拒绝', () => {
    const planar = rectStructuredMesh(1, 1, 4, 2);
    const dangling = buildStudy(planar, {
      nodeGroups: [nodeGroup(21, 'left', [0])],
      boundaryConditions: [
        { name: 'left', kind: 'temperature', target: { dimension: 0, tag: 21 }, components: { 0: 0 } },
        { name: 'flux', kind: 'heat-flux', target: { dimension: 1, tag: 99 }, components: { 0: 1 } },
      ],
      step: makeStep('Heat', 'steady-heat'),
    });
    expect(() => solveEngineeringStudy(dangling)).toThrow(/matches no boundary edges/);

    const study = heatStudy(1);
    expect(() => solveEngineeringStudy(study, { source: Number.NaN })).toThrow();
    expect(() => solveEngineeringStudy(study, { source: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('瞬态：极端时间步长下常值场保持（1e−9 与 1e6）', () => {
    for (const dt of [1e-9, 1e6]) {
      const planar = rectStructuredMesh(1, 1, 4, 2);
      const study = buildStudy(planar, {
        materials: [{ name: 'm', properties: { k: 1, rho: 1, cp: 1 } }],
        nodeGroups: [nodeGroup(21, 'all', nodesWhere(planar, (x) => x === 0))],
        boundaryConditions: [
          { name: 'hot', kind: 'temperature', target: { dimension: 0, tag: 21 }, components: { 0: 5 } },
        ],
        step: makeStep('Transient', 'transient-heat', { dt, timeSteps: 3, theta: 1 }),
      });
      const result = solveEngineeringStudy(study, { initialTemperature: 5 });
      const values = fieldOf(result, 'temperature');
      for (const value of values) expect(value, `dt=${dt}`).toBeCloseTo(5, 8);
    }
  });

  it('瞬态非法参数（dt/theta/steps/初值/热容）在计算前报错', () => {
    const planar = rectStructuredMesh(1, 1, 2, 2);
    const base: StudyOptions = {
      nodeGroups: [nodeGroup(21, 'left', [0])],
      boundaryConditions: [
        { name: 'hot', kind: 'temperature', target: { dimension: 0, tag: 21 }, components: { 0: 0 } },
      ],
    };
    const make = (solver: Record<string, number>, materials = [{ name: 'm', properties: { k: 1, rho: 1, cp: 1 } }]) =>
      buildStudy(planar, {
        materials,
        nodeGroups: [...(base.nodeGroups ?? [])],
        boundaryConditions: [...(base.boundaryConditions ?? [])],
        step: makeStep('Transient', 'transient-heat', { ...solver }),
      });
    expect(() => solveEngineeringStudy(make({ dt: 0 }))).toThrow(/dt/);
    expect(() => solveEngineeringStudy(make({ dt: -1 }))).toThrow(/dt/);
    expect(() => solveEngineeringStudy(make({ dt: Number.NaN }))).toThrow(/dt/);
    expect(() => solveEngineeringStudy(make({ dt: Number.POSITIVE_INFINITY }))).toThrow(/dt/);
    expect(() => solveEngineeringStudy(make({ timeSteps: 0 }))).toThrow(/steps/);
    expect(() => solveEngineeringStudy(make({ timeSteps: 2.5 }))).toThrow(/steps/);
    expect(() => solveEngineeringStudy(make({ theta: 2 }))).toThrow(/theta/);
    expect(() => solveEngineeringStudy(make({ theta: -0.1 }))).toThrow(/theta/);
    expect(() => solveEngineeringStudy(make({ theta: Number.NaN }))).toThrow(/theta/);
    const rho0 = make({}, [{ name: 'm', properties: { k: 1, rho: 0, cp: 1 } }]);
    expect(() => solveEngineeringStudy(rho0))
      .toThrow(/heat capacity/);
    expect(() => solveEngineeringStudy(make({}, [{ name: 'm', properties: { k: 1, rho: 1, cp: 0 } }])))
      .toThrow(/heat capacity/);
    expect(() => solveEngineeringStudy(make({}), { initialTemperature: Number.NaN }))
      .toThrow(/initial temperature/);
    // 合法基线不抛错，确保上述断言不是被无关错误“蒙对”。
    expect(() => solveEngineeringStudy(make({}))).not.toThrow();
  });

  it('势流：均匀势 φ=x 得到单位速度，极端势值同样线性', () => {
    const planar = rectStructuredMesh(1, 1, 6, 3);
    for (const level of [1, 1e9]) {
      const study = buildStudy(planar, {
        nodeGroups: [
          nodeGroup(31, 'left', nodesWhere(planar, (x) => Math.abs(x) < 1e-9)),
          nodeGroup(32, 'right', nodesWhere(planar, (x) => Math.abs(x - 1) < 1e-9)),
        ],
        boundaryConditions: [
          { name: 'p0', kind: 'pressure', target: { dimension: 0, tag: 31 }, components: { 0: 0 } },
          { name: 'p1', kind: 'pressure', target: { dimension: 0, tag: 32 }, components: { 0: level } },
        ],
        step: makeStep('Flow', 'potential-flow'),
      });
      const result = solveEngineeringStudy(study);
      const velocity = fieldOf(result, 'velocity');
      let maxRel = 0;
      for (let e = 0; e < planar.elements.length; e += 1) {
        maxRel = Math.max(maxRel, Math.abs(velocity[e * 3]! - level) / level);
        maxRel = Math.max(maxRel, Math.abs(velocity[e * 3 + 1]!) / level);
      }
      expect(maxRel).toBeLessThan(1e-6);
      record(`势流 Δφ=${level}`, 'u=Δφ/L, v=0', maxRel, 1e-6);
    }
  });

  it('非平面网格（z≠0）被明确拒绝', () => {
    const planar = rectStructuredMesh(1, 1, 2, 2);
    const mesh = toEngineeringMesh(planar, [nodeGroup(11, 'all', [0])]);
    mesh.nodes[1]!.z = 0.5;
    const study = makeStudy('bad', 'gmsh', mesh, {
      boundaryConditions: [
        { name: 'fix', kind: 'displacement', target: { dimension: 0, tag: 11 }, components: { 0: 0, 1: 0 } },
      ],
      cases: [{ name: 'c', steps: [makeStep('Static', 'static-structural')], design: { parameters: [], points: [] } }],
    });
    expect(() => solveEngineeringStudy(study)).toThrow(/not planarly solvable/);
  });
});

// ---- 3D 四面体稳态热 -------------------------------------------------------

describe('3D tet4 稳态热：退化、非有限输入与解析自由度', () => {
  function tetStudy(nodes: Array<[number, number, number]>, elements: number[][], hot: number[] = [0]): EngineeringStudy {
    const mesh: EngineeringMesh = {
      nodes: nodes.map(([x, y, z], i) => ({ id: i + 1, x, y, z })),
      elements: elements.map((ns, i) => ({ id: i + 1, type: 'tet4', nodes: ns })),
      groups: [{ dimension: 0, tag: 41, name: 'hot', members: hot }],
      bounds: meshBounds(nodes.map(([x, y, z], i) => ({ id: i + 1, x, y, z }))),
    };
    return makeStudy('tet', 'gmsh', mesh, {
      materials: [{ name: 'm', properties: { k: 1 } }],
      boundaryConditions: [
        { name: 'hot', kind: 'temperature', target: { dimension: 0, tag: 41 }, components: { 0: 100 } },
      ],
      cases: [{ name: 'c', steps: [makeStep('Heat', 'steady-heat')], design: { parameters: [], points: [] } }],
    });
  }

  it('全节点给定温度时精确返回，0 次迭代', () => {
    const study = tetStudy(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 2, 3]],
      [0, 1, 2, 3],
    );
    const result = solve3DSteadyHeat(study);
    expect(Array.from(result.field.values)).toEqual([100, 100, 100, 100]);
    expect(result.iterations).toBe(0);
    expect(result.residual).toBe(0);
  });

  it('单节点自由时结果有界且不出现 NaN/Infinity', () => {
    const study = tetStudy(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 2, 3]],
      [0, 1, 2],
    );
    const result = solve3DSteadyHeat(study);
    for (const value of result.field.values) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    record('tet4 单自由度', '0 ≤ T ≤ 100', 0, 1e-8);
  });

  it('零体积/共面 tet4 在装配前被拒绝', () => {
    const study = tetStudy(
      [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]],
      [[0, 1, 2, 3]],
    );
    expect(() => solve3DSteadyHeat(study)).toThrow(Solve3DError);
    expect(() => solve3DSteadyHeat(study)).toThrow(/degenerate tet4/);
  });

  it('非有限源项与零导热系数被拒绝', () => {
    const study = tetStudy(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 2, 3]],
    );
    expect(() => solve3DSteadyHeat(study, { source: Number.NaN })).toThrow(Solve3DError);
    expect(() => solve3DSteadyHeat(study, { source: Number.POSITIVE_INFINITY })).toThrow(Solve3DError);

    study.materials = [{ name: 'm', properties: { k: 0 } }];
    expect(() => solve3DSteadyHeat(study)).toThrow(/thermal conductivity/);
  });

  it('无 tet4 网格/无温度边界/热流边界均给出明确错误', () => {
    const planar = rectStructuredMesh(1, 1, 2, 2);
    const planarStudy = buildStudy(planar, { step: makeStep('Heat', 'steady-heat') });
    expect(() => solve3DSteadyHeat(planarStudy)).toThrow(/requires tet4/);

    const noBc = tetStudy(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 2, 3]],
    );
    noBc.boundaryConditions = [];
    expect(() => solve3DSteadyHeat(noBc)).toThrow(/temperature boundary/);

    const flux = tetStudy(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 2, 3]],
    );
    flux.boundaryConditions.push({
      name: 'flux', kind: 'heat-flux', target: { dimension: 2, tag: 41 }, components: { 0: 1 },
    });
    expect(() => solve3DSteadyHeat(flux)).toThrow(/flux/);
  });
});
