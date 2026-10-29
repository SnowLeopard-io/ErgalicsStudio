// ==========================================================================
// fem-lab — finite element laboratory plugin.
//
// Choose a physics (Poisson / transient heat / plane elasticity), a
// parametric 2-D domain and a target mesh size; the plugin meshes the domain
// with the built-in Bowyer–Watson Delaunay mesher, assembles and solves the
// P1 system with the kernel's own CG solver, and renders the result as a
// field colour map on the 2-D canvas (deformed mesh overlay for elasticity).
// A benchmark action reproduces the kernel's analytic validation cases
// (Poisson L² order ≈ 2, uniaxial bar exactness, heat decay/energy).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  annulusDomain,
  circleDomain,
  convergenceOrder,
  dropDegenerateTriangles,
  HEAT_SINE_CASE,
  l2Error,
  lShapeDomain,
  meshDomain,
  meshQuality,
  POISSON_SINE_CASE,
  rectStructuredMesh,
  rectangleDomain,
  rectangleWithHoleDomain,
  selectNodesByPredicate,
  solveElasticity,
  solveHeat,
  solvePoisson,
  totalHeatEnergy,
  type EdgeElement,
  type PlanarDomain,
  type PlanarMesh,
} from '@/core/fem';
import { femLabManifest } from './manifest';

type PhysicsKind = 'poisson' | 'heat' | 'elasticity';
type GeometryKind = 'rectangle' | 'circle' | 'annulus' | 'lshape' | 'rect-hole';

interface RunState {
  kind: PhysicsKind;
  mesh: PlanarMesh;
  /** Colour field per node (u / temperature / von Mises). */
  values: Float64Array;
  /** Interleaved displacements (elasticity only). */
  displacement: Float64Array | null;
  label: string;
  unit: string;
  iterations: number;
  residual: number;
  extra: string;
}

interface State {
  physics: PhysicsKind;
  geometry: GeometryKind;
  h: number;
  f0: number;
  g0: number;
  u0: number;
  dt: number;
  steps: number;
  theta: number;
  E: number;
  nu: number;
  sigma0: number;
  planeState: 'plane-stress' | 'plane-strain';
  deformPercent: number; // 0 = deformed overlay off
}

const DEFAULT_STATE: State = {
  physics: 'poisson',
  geometry: 'rectangle',
  h: 0.08,
  f0: 1,
  g0: 0,
  u0: 1,
  dt: 0.005,
  steps: 200,
  theta: 0.5,
  E: 200000,
  nu: 0.3,
  sigma0: 100,
  planeState: 'plane-stress',
  deformPercent: 0,
};

// ---- helpers ---------------------------------------------------------------

/** Build the selected parametric domain. */
function buildDomain(geometry: GeometryKind): PlanarDomain {
  switch (geometry) {
    case 'rectangle':
      return rectangleDomain(1, 1);
    case 'circle':
      return circleDomain(1, 0, 0);
    case 'annulus':
      return annulusDomain(0.4, 1, 0, 0);
    case 'lshape':
      return lShapeDomain();
    case 'rect-hole':
      return rectangleWithHoleDomain(2, 1, 1, 0.5, 0.3);
  }
}

/** All boundary tags declared by the domain. */
function allEdgeTags(domain: PlanarDomain): number[] {
  return Object.keys(domain.edgeLegend).map(Number);
}

/** Viridis-like colour ramp, t ∈ [0, 1] → rgb string. */
function fieldColor(t: number): string {
  const stops: Array<[number, number, number]> = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const s = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const f = s - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const r = Math.round(a[0] + f * (b[0] - a[0]));
  const g = Math.round(a[1] + f * (b[1] - a[1]));
  const bl = Math.round(a[2] + f * (b[2] - a[2]));
  return `rgb(${r},${g},${bl})`;
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(Math.abs(x) < 0.01 ? 5 : Math.abs(x) < 1 ? 4 : 2);
}

// ---- plugin ----------------------------------------------------------------

export class FemLabPlugin implements Plugin {
  readonly manifest = femLabManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { ...DEFAULT_STATE };
  private run: RunState | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    const sel = (key: string, en: string, cn: string, options: Array<{ value: string; label: string }>, value: string, group: string, visibleWhen?: ParamDefinition['visibleWhen']): ParamDefinition => ({
      key,
      label: en,
      labelI18n: { 'zh-CN': cn, 'en-US': en },
      type: 'select',
      options,
      value,
      group,
      visibleWhen,
    });
    const num = (key: string, en: string, cn: string, value: number, step: number, group: string, hintEn?: string, hintZh?: string, visibleWhen?: ParamDefinition['visibleWhen']): ParamDefinition => ({
      key,
      label: en,
      labelI18n: { 'zh-CN': cn, 'en-US': en },
      type: 'number',
      step,
      value,
      group,
      hint: hintEn ? (zh ? hintZh ?? hintEn : hintEn) : undefined,
      visibleWhen,
    });
    const physicsIn = (...kinds: string[]) => ({ key: 'physics', in: kinds }) as ParamDefinition['visibleWhen'];
    return [
      sel(
        'physics',
        'Physics',
        '物理场',
        [
          { value: 'poisson', label: zh ? 'Poisson −∇·(k∇u)=f' : 'Poisson −∇·(k∇u)=f' },
          { value: 'heat', label: zh ? '瞬态热传导 ∂u/∂t=αΔu+Q' : 'Transient heat ∂u/∂t=αΔu+Q' },
          { value: 'elasticity', label: zh ? '平面线弹性' : 'Plane elasticity' },
        ],
        this.state.physics,
        zh ? '物理场' : 'Physics',
      ),
      sel(
        'geometry',
        'Domain geometry',
        '域几何',
        [
          { value: 'rectangle', label: zh ? '单位正方形' : 'Unit square' },
          { value: 'circle', label: zh ? '单位圆' : 'Unit circle' },
          { value: 'annulus', label: zh ? '圆环 0.4–1' : 'Annulus 0.4–1' },
          { value: 'lshape', label: zh ? 'L 形域' : 'L-shape' },
          { value: 'rect-hole', label: zh ? '带圆孔矩形' : 'Rectangle with hole' },
        ],
        this.state.geometry,
        zh ? '物理场' : 'Physics',
      ),
      {
        key: 'h',
        label: 'Mesh target size h',
        labelI18n: { 'zh-CN': '网格目标尺寸 h', 'en-US': 'Mesh target size h' },
        type: 'range',
        min: 0.03,
        max: 0.25,
        step: 0.005,
        value: this.state.h,
        group: zh ? '网格' : 'Mesh',
        hint: zh ? '越小越精细（Delaunay + 均匀细化）' : 'smaller = finer (Delaunay + uniform refinement)',
      },
      num('f0', 'Source f₀ (Poisson/heat Q)', '源项 f₀（Poisson/热源 Q）', this.state.f0, 0.1, zh ? 'Poisson' : 'Poisson', undefined, undefined, physicsIn('poisson', 'heat')),
      num('g0', 'Dirichlet value', 'Dirichlet 边界值', this.state.g0, 0.1, zh ? 'Poisson' : 'Poisson', undefined, undefined, physicsIn('poisson')),
      num('u0', 'Initial amplitude', '初始温度幅值', this.state.u0, 0.1, zh ? '热传导' : 'Heat', undefined, undefined, physicsIn('heat')),
      num('dt', 'Time step Δt', '时间步长 Δt', this.state.dt, 0.001, zh ? '热传导' : 'Heat', undefined, undefined, physicsIn('heat')),
      num('steps', 'Steps', '时间步数', this.state.steps, 10, zh ? '热传导' : 'Heat', undefined, undefined, physicsIn('heat')),
      sel(
        'theta',
        'θ scheme',
        'θ 格式',
        [
          { value: '1', label: zh ? '1.0 隐式 Euler' : '1.0 implicit Euler' },
          { value: '0.5', label: zh ? '0.5 Crank–Nicolson' : '0.5 Crank–Nicolson' },
        ],
        String(this.state.theta),
        zh ? '热传导' : 'Heat',
        physicsIn('heat'),
      ),
      num('E', "Young's modulus E", '弹性模量 E', this.state.E, 1000, zh ? '弹性' : 'Elasticity', undefined, undefined, physicsIn('elasticity')),
      num('nu', 'Poisson ratio ν', '泊松比 ν', this.state.nu, 0.01, zh ? '弹性' : 'Elasticity', undefined, undefined, physicsIn('elasticity')),
      num('sigma0', 'Traction σ₀ (right edge)', '右端拉力 σ₀', this.state.sigma0, 10, zh ? '弹性' : 'Elasticity', undefined, undefined, physicsIn('elasticity')),
      sel(
        'planeState',
        'Plane state',
        '平面假设',
        [
          { value: 'plane-stress', label: zh ? '平面应力' : 'plane stress' },
          { value: 'plane-strain', label: zh ? '平面应变' : 'plane strain' },
        ],
        this.state.planeState,
        zh ? '弹性' : 'Elasticity',
        physicsIn('elasticity'),
      ),
      {
        key: 'deformPercent',
        label: 'Deform overlay %',
        labelI18n: { 'zh-CN': '变形叠加 %', 'en-US': 'Deform overlay %' },
        type: 'range',
        min: 0,
        max: 30,
        step: 1,
        value: this.state.deformPercent,
        group: zh ? '弹性' : 'Elasticity',
        hint: zh ? '0 = 不绘制变形叠加；偏移上限为绘图区短边的 25%' : '0 = hide deformed overlay; drift capped at 25 % of the plot short side',
        visibleWhen: physicsIn('elasticity'),
      },
      actionButton('run', 'Run FEM solve', '运行有限元求解', 'primary'),
      actionButton('benchmark', 'Run analytic benchmarks', '运行解析基准'),
      actionButton('exportCsv', 'Export node CSV', '导出节点 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let physicsChanged = false;
    if (typeof params.physics === 'string' && ['poisson', 'heat', 'elasticity'].includes(params.physics)) {
      physicsChanged = params.physics !== s.physics;
      s.physics = params.physics as PhysicsKind;
    }
    if (typeof params.geometry === 'string' && ['rectangle', 'circle', 'annulus', 'lshape', 'rect-hole'].includes(params.geometry)) {
      s.geometry = params.geometry as GeometryKind;
    }
    if (typeof params.h === 'number' && Number.isFinite(params.h)) s.h = Math.min(0.25, Math.max(0.03, params.h));
    if (typeof params.f0 === 'number' && Number.isFinite(params.f0)) s.f0 = params.f0;
    if (typeof params.g0 === 'number' && Number.isFinite(params.g0)) s.g0 = params.g0;
    if (typeof params.u0 === 'number' && Number.isFinite(params.u0)) s.u0 = params.u0;
    if (typeof params.dt === 'number' && Number.isFinite(params.dt) && params.dt > 0) s.dt = params.dt;
    if (typeof params.steps === 'number' && Number.isFinite(params.steps)) s.steps = Math.min(5000, Math.max(1, Math.round(params.steps)));
    if (typeof params.theta === 'string') s.theta = params.theta === '0.5' ? 0.5 : 1;
    if (typeof params.E === 'number' && Number.isFinite(params.E) && params.E > 0) s.E = params.E;
    if (typeof params.nu === 'number' && Number.isFinite(params.nu)) s.nu = Math.min(0.49, Math.max(-0.9, params.nu));
    if (typeof params.sigma0 === 'number' && Number.isFinite(params.sigma0)) s.sigma0 = params.sigma0;
    if (typeof params.planeState === 'string') s.planeState = params.planeState === 'plane-strain' ? 'plane-strain' : 'plane-stress';
    if (typeof params.deformPercent === 'number' && Number.isFinite(params.deformPercent)) s.deformPercent = Math.max(0, Math.min(30, params.deformPercent));

    if (actionFired(params, 'run')) {
      this.solve();
      return;
    }
    if (actionFired(params, 'benchmark')) {
      this.runBenchmarks();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (physicsChanged) this.run = null; // physics switched → previous result is stale
    this.draw();
  }

  compute(): Promise<{ ok: boolean; output?: unknown; metrics?: { gpuMs?: number; bytes?: number }; error?: string }> {
    this.solve();
    return Promise.resolve({
      ok: this.run !== null,
      output: this.run ? { kind: this.run.kind, iterations: this.run.iterations, residual: this.run.residual } : undefined,
      error: this.run ? undefined : 'run failed',
    });
  }

  // ---- solving ---------------------------------------------------------------

  private ensureMesh(): PlanarMesh {
    if (!this.cachedMesh || this.lastMeshH !== this.state.h || this.lastGeometry !== this.state.geometry) {
      const domain = buildDomain(this.state.geometry);
      this.cachedMesh = dropDegenerateTriangles(meshDomain(domain, { targetSize: this.state.h }));
      this.lastMeshH = this.state.h;
      this.lastGeometry = this.state.geometry;
      this.run = null; // mesh changed → previous result is stale
    }
    return this.cachedMesh;
  }

  private cachedMesh: PlanarMesh | null = null;
  private lastMeshH = -1;
  private lastGeometry: GeometryKind | null = null;

  private solve(): void {
    const s = this.state;
    try {
      const mesh = this.ensureMesh();
      let state: RunState;
      if (s.physics === 'poisson') {
        const result = solvePoisson({
          mesh,
          k: 1,
          source: () => s.f0,
          dirichlet: { edgeTags: allEdgeTags(buildDomain(s.geometry)), value: s.g0 },
          cg: { tol: 1e-10 },
        });
        state = {
          kind: 'poisson',
          mesh,
          values: result.values,
          displacement: null,
          label: 'u',
          unit: '',
          iterations: result.iterations,
          residual: result.residual,
          extra: '',
        };
      } else if (s.physics === 'heat') {
        const domain = buildDomain(s.geometry);
        let cx = 0;
        let cy = 0;
        let span = 1;
        {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let i = 0; i < mesh.nodes.length; i += 2) {
            minX = Math.min(minX, mesh.nodes[i]!);
            maxX = Math.max(maxX, mesh.nodes[i]!);
            minY = Math.min(minY, mesh.nodes[i + 1]!);
            maxY = Math.max(maxY, mesh.nodes[i + 1]!);
          }
          cx = (minX + maxX) / 2;
          cy = (minY + maxY) / 2;
          span = Math.max(maxX - minX, maxY - minY, 1e-9);
        }
        const result = solveHeat({
          mesh,
          k: 1,
          heatCapacity: 1,
          initial: (x, y) => s.u0 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (0.05 * span * span)),
          dirichlet: { edgeTags: allEdgeTags(domain), value: 0 },
          dt: s.dt,
          steps: s.steps,
          theta: s.theta,
          cg: { tol: 1e-10 },
        });
        const e0 = result.energyHistory[0] ?? 0;
        const e1 = result.energyHistory[result.energyHistory.length - 1] ?? 0;
        state = {
          kind: 'heat',
          mesh,
          values: result.values,
          displacement: null,
          label: 'T',
          unit: '',
          iterations: result.iterations,
          residual: result.residual,
          extra: `t=${fmt(result.times[result.times.length - 1] ?? 0)}  E/E₀=${e0 !== 0 ? fmt(e1 / e0) : '—'}`,
        };
      } else {
        // Elasticity: clamp the leftmost nodes in x, pin one node in y, and
        // pull the rightmost band with a uniform traction σ₀ (geometry-agnostic).
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        for (let i = 0; i < mesh.nodes.length; i += 2) {
          minX = Math.min(minX, mesh.nodes[i]!);
          maxX = Math.max(maxX, mesh.nodes[i]!);
          minY = Math.min(minY, mesh.nodes[i + 1]!);
        }
        const eps = 1e-6 * Math.max(maxX - minX, 1);
        const leftNodes = selectNodesByPredicate(mesh, (x) => x < minX + eps);
        let pin = leftNodes[0] ?? 0;
        let pinY = Infinity;
        for (const n of leftNodes) {
          const y = mesh.nodes[n * 2 + 1]!;
          if (y < pinY) {
            pinY = y;
            pin = n;
          }
        }
        // Rightmost band carrying the uniform traction σ₀. The Delaunay mesh
        // is an inscribed polygon: boundary-edge midpoints never reach the
        // node-based max x, so a node epsilon band would select nothing and
        // leave the traction load (and hence the displacement field) at zero.
        // Measure the band on the boundary midpoints themselves instead.
        let maxMidX = -Infinity;
        for (const e of mesh.boundaryEdges) {
          const mx = (mesh.nodes[e.a * 2]! + mesh.nodes[e.b * 2]!) / 2;
          if (mx > maxMidX) maxMidX = mx;
        }
        const band = 0.03 * Math.max(maxX - minX, 1);
        const rightEdges: EdgeElement[] = mesh.boundaryEdges.filter((e) => {
          const mx = (mesh.nodes[e.a * 2]! + mesh.nodes[e.b * 2]!) / 2;
          return mx >= maxMidX - band;
        });
        const result = solveElasticity({
          mesh,
          E: s.E,
          nu: s.nu,
          state: s.planeState,
          constraints: [{ nodes: leftNodes, ux: 0 }, { nodes: [pin], uy: 0 }],
          tractions: [{ edges: rightEdges, tx: s.sigma0 }],
          cg: { tol: 1e-10 },
        });
        state = {
          kind: 'elasticity',
          mesh,
          values: result.nodalVonMises,
          displacement: result.displacement,
          label: 'σ_vM',
          unit: '',
          iterations: result.iterations,
          residual: result.residual,
          extra: `max|u|=${fmt(result.maxDisplacement)}`,
        };
      }
      this.run = state;
      const q = meshQuality(mesh);
      this.publishOutputs(q);
      notify(this.api, 'success',
        `Solved: ${q.nodeCount} nodes / ${q.elementCount} elements, CG ${state.iterations} iters`,
        `求解完成：${q.nodeCount} 节点 / ${q.elementCount} 单元，CG ${state.iterations} 次迭代`);
    } catch (err) {
      notify(this.api, 'error', `FEM failed: ${String(err)}`, `有限元求解失败：${String(err)}`);
      this.api.log('error', 'fem-lab solve failed', err);
    }
    this.draw();
  }

  private publishOutputs(q: ReturnType<typeof meshQuality>): void {
    const metrics: ScienceMetric[] = [
      { key: 'nodes', label: '节点数', value: String(q.nodeCount) },
      { key: 'elements', label: '单元数', value: String(q.elementCount) },
      { key: 'minAngle', label: '最小单元角', value: fmt(q.minAngleDeg), unit: '°', hint: 'P1 三角形最小内角（退化剔除后）' },
      { key: 'aspect', label: '最大长宽比', value: fmt(q.maxAspectRatio) },
    ];
    if (this.run) {
      metrics.push({ key: 'cg', label: 'CG 迭代', value: String(this.run.iterations) });
      metrics.push({ key: 'residual', label: '残差 ‖r‖', value: this.run.residual.toExponential(2) });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Analytic validation battery from the kernel's reference cases. */
  private runBenchmarks(): void {
    try {
      const metrics: ScienceMetric[] = [];
      // 1) Poisson sine case, structured rectangle, L2 order ≈ 2.
      const sizes = [4, 8, 16];
      const errors: number[] = [];
      for (const n of sizes) {
        const mesh = rectStructuredMesh(1, 1, n, n);
        const r = solvePoisson({
          mesh,
          k: 1,
          source: POISSON_SINE_CASE.source,
          dirichlet: { edgeTags: [1, 2, 3, 4], value: 0 },
          cg: { tol: 1e-12 },
        });
        errors.push(l2Error(mesh, r.values, POISSON_SINE_CASE.exact));
      }
      const p1 = convergenceOrder(1 / 4, errors[0]!, 1 / 8, errors[1]!);
      const p2 = convergenceOrder(1 / 8, errors[1]!, 1 / 16, errors[2]!);
      metrics.push({ key: 'poissonL2', label: 'Poisson L² 误差 (h=1/16)', value: errors[2]!.toExponential(3) });
      metrics.push({ key: 'poissonOrder', label: 'Poisson L² 收敛阶', value: fmt((p1 + p2) / 2), unit: '', hint: 'P1 三角形理论 2 阶', severity: (p1 + p2) / 2 > 1.7 ? 'ok' : 'warn' });

      // 2) Uniaxial bar exactness (plane stress, structured mesh).
      {
        const mesh = rectStructuredMesh(2, 1, 8, 4);
        const E = 200000;
        const nu = 0.3;
        const sigma0 = 100;
        const left = selectNodesByPredicate(mesh, (x) => x < 1e-9);
        let pin = left[0] ?? 0;
        let py = Infinity;
        for (const nd of left) {
          const y = mesh.nodes[nd * 2 + 1]!;
          if (y < py) {
            py = y;
            pin = nd;
          }
        }
        const rightEdges = mesh.boundaryEdges.filter((e) => (mesh.nodes[e.a * 2]! + mesh.nodes[e.b * 2]!) / 2 > 2 - 1e-9);
        const result = solveElasticity({
          mesh,
          E,
          nu,
          state: 'plane-stress',
          constraints: [{ nodes: left, ux: 0 }, { nodes: [pin], uy: 0 }],
          tractions: [{ edges: rightEdges, tx: sigma0 }],
          cg: { tol: 1e-12 },
        });
        let err = 0;
        for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
          const x = mesh.nodes[i * 2]!;
          const y = mesh.nodes[i * 2 + 1]!;
          err = Math.max(err,
            Math.abs(result.displacement[2 * i]! - (sigma0 * x) / E),
            Math.abs(result.displacement[2 * i + 1]! - (-nu * sigma0 * y) / E));
        }
        metrics.push({ key: 'uniaxial', label: '单轴拉伸最大位移误差', value: err.toExponential(2), severity: err < 1e-6 ? 'ok' : 'warn' });
      }

      // 3) Heat: analytic decay + insulated energy conservation.
      {
        const mesh = rectStructuredMesh(1, 1, 16, 16);
        const r = solveHeat({
          mesh,
          initial: HEAT_SINE_CASE.initial,
          dirichlet: { edgeTags: [1, 2, 3, 4], value: 0 },
          dt: 0.002,
          steps: 50,
          theta: 0.5,
          cg: { tol: 1e-12 },
        });
        const tFinal = r.times[r.times.length - 1] ?? 0;
        const err = l2Error(mesh, r.values, (x, y) => HEAT_SINE_CASE.exact(x, y, tFinal, 1));
        metrics.push({ key: 'heatDecay', label: '热传导 L² 误差 (t=0.1)', value: err.toExponential(2), severity: err < 0.02 ? 'ok' : 'warn' });

        const mesh2 = rectStructuredMesh(1, 1, 12, 12);
        const r2 = solveHeat({
          mesh: mesh2,
          initial: (x, y) => Math.exp(-80 * ((x - 0.5) ** 2 + (y - 0.5) ** 2)),
          dt: 0.01,
          steps: 40,
          theta: 0.5,
          cg: { tol: 1e-11 },
        });
        const e0 = totalHeatEnergy(mesh2, r2.history[0]!);
        const e1 = totalHeatEnergy(mesh2, r2.values);
        const drift = Math.abs(e1 - e0) / Math.abs(e0);
        metrics.push({ key: 'heatEnergy', label: '绝热能量漂移', value: drift.toExponential(2), hint: 'θ 格式应精确守恒 ∫u dV', severity: drift < 1e-6 ? 'ok' : 'warn' });
      }
      setScienceOutputs(this.manifest.id, metrics);
      notify(this.api, 'success', 'Benchmarks published to science outputs', '基准结果已发布到科学输出');
    } catch (err) {
      notify(this.api, 'error', `Benchmark failed: ${String(err)}`, `基准运行失败：${String(err)}`);
    }
  }

  private exportCsv(): void {
    if (!this.run) {
      notify(this.api, 'warning', 'Run a solve first', '请先运行求解');
      return;
    }
    const { mesh, values, displacement } = this.run;
    const rows: Array<Array<string | number>> = [];
    let header: Array<string | number>;
    if (displacement) {
      header = ['id', 'x', 'y', 'vonMises', 'ux', 'uy'];
      for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
        rows.push([i, mesh.nodes[i * 2]!, mesh.nodes[i * 2 + 1]!, values[i]!, displacement[2 * i]!, displacement[2 * i + 1]!]);
      }
    } else {
      header = ['id', 'x', 'y', 'value'];
      for (let i = 0; i < mesh.nodes.length / 2; i += 1) {
        rows.push([i, mesh.nodes[i * 2]!, mesh.nodes[i * 2 + 1]!, values[i]!]);
      }
    }
    exportRowsCsv(this.api, `fem-lab-${this.run.kind}.csv`, header, rows);
  }

  // ---- drawing ---------------------------------------------------------------

  /** Canvas text font following the mainstream plugin convention. */
  private fnt(px: number): string {
    return `${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.run) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'FEM Lab',
        titleZh: '有限元实验室',
        hint: 'Choose physics / geometry / mesh size, then press Run.',
        hintZh: '选择物理场 / 几何 / 网格尺寸后点击运行。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.drawField(g, canvas);
  }

  private drawField(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const run = this.run!;
    const mesh = run.mesh;
    const n = mesh.nodes.length / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      minX = Math.min(minX, mesh.nodes[i * 2]!);
      maxX = Math.max(maxX, mesh.nodes[i * 2]!);
      minY = Math.min(minY, mesh.nodes[i * 2 + 1]!);
      maxY = Math.max(maxY, mesh.nodes[i * 2 + 1]!);
    }
    const padL = 14;
    const padR = 86;
    const padY = 30;
    const w = canvas.width - padL - padR;
    const h = canvas.height - 2 * padY;
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);
    const scale = Math.min(w / spanX, h / spanY);
    const ox = padL + (w - spanX * scale) / 2;
    const oy = padY + (h - spanY * scale) / 2;
    const px = (x: number): number => ox + (x - minX) * scale;
    const py = (y: number): number => oy + (maxY - y) * scale; // flip Y for screen

    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i < n; i += 1) {
      vMin = Math.min(vMin, run.values[i]!);
      vMax = Math.max(vMax, run.values[i]!);
    }
    const vSpan = Math.max(vMax - vMin, 1e-30);

    // All field primitives are clipped to the padded plot rectangle so that
    // amplified overlays or degenerate elements can never leak over the
    // legend strip or the caption band.
    g.save();
    g.beginPath();
    g.rect(padL, padY, w, h);
    g.clip();

    // Deformation scale for the elasticity overlay. The amplification must be
    // expressed in physical units (pixel target divided by `scale`): px()/py()
    // multiply coordinates by `scale` again, so a pixel-valued factor here
    // explodes the deformed wireframe far outside the plot area.
    // The overlay is skipped entirely when the slider is at 0 % or when the
    // displacement magnitude is below the numerical-noise threshold: dividing
    // by near-zero round-off would blow up deformScale and smear a ghost
    // wireframe (clipped at the plot edge) across the canvas.
    let deformScale = 0;
    if (run.displacement && run.kind === 'elasticity') {
      let maxU = 0;
      for (let i = 0; i < n; i += 1) {
        maxU = Math.max(maxU, Math.hypot(run.displacement[2 * i]!, run.displacement[2 * i + 1]!));
      }
      // Hard cap: no node may drift further than 25 % of the shorter plot
      // side from its rest position, whatever the slider says. The largest
      // pixel offset equals scale * deformScale * maxU, so clamping the
      // pixel target clamps deformScale with it and the deformed wireframe
      // can never reach the legend strip or the caption.
      const maxOffsetPx = 0.25 * Math.min(w, h);
      const requestedPx = (this.state.deformPercent / 100) * Math.min(canvas.width, canvas.height);
      const targetPx = Math.min(requestedPx, maxOffsetPx);
      if (maxU >= 1e-14 && targetPx > 0) {
        deformScale = targetPx / (scale * maxU);
      }
    }

    // Filled triangles coloured by the mean nodal value.
    for (const el of mesh.elements) {
      const vx = [mesh.nodes[el.a * 2]!, mesh.nodes[el.b * 2]!, mesh.nodes[el.c * 2]!];
      const vy = [mesh.nodes[el.a * 2 + 1]!, mesh.nodes[el.b * 2 + 1]!, mesh.nodes[el.c * 2 + 1]!];
      const mean = (run.values[el.a]! + run.values[el.b]! + run.values[el.c]!) / 3;
      g.beginPath();
      for (let k = 0; k < 3; k += 1) {
        const X = px(vx[k]!);
        const Y = py(vy[k]!);
        if (k === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      }
      g.closePath();
      g.fillStyle = fieldColor((mean - vMin) / vSpan);
      g.fill();
    }

    // Mesh wireframe.
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 0.6;
    g.beginPath();
    for (const el of mesh.elements) {
      g.moveTo(px(mesh.nodes[el.a * 2]!), py(mesh.nodes[el.a * 2 + 1]!));
      g.lineTo(px(mesh.nodes[el.b * 2]!), py(mesh.nodes[el.b * 2 + 1]!));
      g.lineTo(px(mesh.nodes[el.c * 2]!), py(mesh.nodes[el.c * 2 + 1]!));
      g.closePath();
    }
    g.stroke();

    // Deformed mesh overlay (elasticity only): bright wires on the displaced shape.
    if (run.displacement && run.kind === 'elasticity' && deformScale > 0) {
      g.strokeStyle = 'rgba(120,220,255,0.85)';
      g.lineWidth = 1;
      g.beginPath();
      for (const el of mesh.elements) {
        const pts = [el.a, el.b, el.c].map((i) => [
          px(mesh.nodes[i * 2]! + deformScale * run.displacement![2 * i]!),
          py(mesh.nodes[i * 2 + 1]! + deformScale * run.displacement![2 * i + 1]!),
        ]);
        g.moveTo(pts[0]![0]!, pts[0]![1]!);
        g.lineTo(pts[1]![0]!, pts[1]![1]!);
        g.lineTo(pts[2]![0]!, pts[2]![1]!);
        g.closePath();
      }
      g.stroke();
      // Magnified displacement vector sample at the max-displacement node.
      let argMax = 0;
      let best = -1;
      for (let i = 0; i < n; i += 1) {
        const m = Math.hypot(run.displacement[2 * i]!, run.displacement[2 * i + 1]!);
        if (m > best) {
          best = m;
          argMax = i;
        }
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.moveTo(px(mesh.nodes[argMax * 2]!), py(mesh.nodes[argMax * 2 + 1]!));
      g.lineTo(
        px(mesh.nodes[argMax * 2]! + deformScale * run.displacement[2 * argMax]!),
        py(mesh.nodes[argMax * 2 + 1]! + deformScale * run.displacement[2 * argMax + 1]!),
      );
      g.stroke();
    }
    g.restore();

    // ---- legend ----
    const lx = canvas.width - padR + 28;
    const ly0 = padY + 6;
    const lh = h - 12;
    const grad = g.createLinearGradient(0, ly0 + lh, 0, ly0);
    for (let k = 0; k <= 10; k += 1) {
      grad.addColorStop(k / 10, fieldColor(k / 10));
    }
    g.fillStyle = grad;
    g.fillRect(lx, ly0, 14, lh);
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.strokeRect(lx, ly0, 14, lh);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = this.fnt(11);
    g.textAlign = 'left';
    g.fillText(fmt(vMax), lx + 18, ly0 + 10);
    g.fillText(fmt(vMin), lx + 18, ly0 + lh);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = this.fnt(12);
    g.fillText(`${this.zh ? '场量' : 'Field'}: ${run.label} ${run.unit}`, lx - 12, ly0 - 10);

    // ---- status line ----
    const q = meshQuality(mesh);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = this.fnt(11);
    g.fillText(
      `${this.zh ? '物理' : 'physics'}=${run.kind}  ${this.zh ? '节点' : 'nodes'}=${q.nodeCount}  ${this.zh ? '单元' : 'elems'}=${q.elementCount}  min∠=${q.minAngleDeg.toFixed(1)}°  CG=${run.iterations}  ‖r‖=${run.residual.toExponential(1)}${run.extra ? '  ' + run.extra : ''}`,
      padL,
      canvas.height - 10,
    );
  }
}

/** Factory required by the plugin loader (`mod.default()`). */
export default function createFemLabPlugin(): Plugin {
  return new FemLabPlugin();
}
