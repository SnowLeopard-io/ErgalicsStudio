// ==========================================================================
// eng-fluid — fluid mechanics laboratory
//
// Live workbench with four modes (selected by the `mode` parameter):
//   pipe      — Darcy–Weisbach pipe flow with a Newton-iterated
//               Colebrook–White friction factor; interactive Moody chart
//               (log–log, canvas 2d) with the operating point marked.
//   bernoulli — ideal converging/diverging/venturi duct: continuity-driven
//               velocity and Bernoulli pressure along the duct with the
//               hydraulic-grade and energy-grade lines.
//   bl        — Blasius flat-plate boundary layer (δ, δ*, θ, cf vs x) from
//               the shooting solution of the similarity ODE, plus the
//               Pohlhausen quartic profile with the λ-based separation
//               indicator for adverse pressure gradients.
//   stream    — potential flow past a sphere / rotating cylinder: 3-D
//               analytic vector field integrated into streamlines and drawn
//               with a simple perspective projection on canvas 2d (no
//               WebGPU, no external dependency), with the Kutta–Joukowski /
//               Stokes drag-lift panel published to the science outputs.
// Pressing "Run" additionally publishes the scientific outputs (Re, regime,
// f, head loss / continuity residual / shooting coefficients / Cd-Cl with
// closed-form cross-references). Everything is parameter-driven and
// deterministic; compute() doubles as the headless Block/Flow entry accepting
// CSV/JSON/DataTable input with columns d, v, rho, mu, L, eps.
// ==========================================================================

import type { ContainerCapabilities, ComputeResult, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { isDataTable, createDataTable, type DataTable, type DataValue } from '@/types/datatable';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
  type ScienceSeverity,
} from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { engFluidManifest } from './manifest';
import { fluidFigurePanels, type FigurePayload } from './figure';
import {
  type AeroResult,
  type BlasiusSolution,
  type BodyKind,
  type DuctParams,
  type DuctShape,
  type DuctStation,
  type FlowRegime,
  type MoodyPoint,
  type PipeParams,
  type PipeResult,
  RE_LAMINAR_MAX,
  RE_TRANSITIONAL_MAX,
  aeroReduction,
  blasiusThicknesses,
  ductConservation,
  ductStations,
  haalandFriction,
  moodyBlasiusCurve,
  moodyLaminarLine,
  moodyTurbulentCurve,
  pipeFlow,
  pohlhausenProfile,
  pohlhausenShape,
  potentialFlowVelocity,
  solveBlasius,
  surfaceSpeedRatio,
} from './kernel';

export { engFluidManifest } from './manifest';

type FluidMode = 'pipe' | 'bernoulli' | 'bl' | 'stream';

interface State {
  mode: FluidMode;
  rho: number;
  mu: number;
  // pipe
  d: number;
  v: number;
  L: number;
  eps: number;
  // bernoulli
  shape: DuctShape;
  d1: number;
  d2: number;
  v1: number;
  p1: number;
  len: number;
  // boundary layer
  uInf: number;
  plateL: number;
  lambda: number;
  // streamlines
  body: BodyKind;
  uFree: number;
  radius: number;
  gamma: number;
  nLines: number;
}

const DEFAULT_STATE: State = {
  mode: 'pipe',
  rho: 998,
  mu: 0.001,
  d: 0.05,
  v: 1.5,
  L: 10,
  eps: 0.00015,
  shape: 'venturi',
  d1: 0.2,
  d2: 0.1,
  v1: 2,
  p1: 0,
  len: 2,
  uInf: 1,
  plateL: 0.5,
  lambda: 0,
  body: 'cylinder',
  uFree: 1,
  radius: 0.4,
  gamma: 1.5,
  nLines: 12,
};

// ---- palette (academic, low saturation — matches the engineering suite) ------

const COL = {
  axis: 'rgba(120,140,165,0.55)',
  grid: 'rgba(255,255,255,0.06)',
  gridMinor: 'rgba(255,255,255,0.03)',
  text: 'rgba(230,238,248,0.95)',
  dim: 'rgba(160,175,195,0.9)',
  blue: 'rgba(90,191,255,0.95)',
  teal: 'rgba(93,208,168,0.95)',
  amber: 'rgba(255,209,102,0.95)',
  orange: 'rgba(232,143,106,0.95)',
  red: 'rgba(224,108,117,0.95)',
  grey: 'rgba(170,182,200,0.55)',
  wall: 'rgba(140,160,185,0.8)',
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Tick values for a linear axis (nice 1/2/5 steps). */
function linTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step - 1e-9) * step;
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

/** Axes frame with in-frame title, x label (below right) and rotated y label. */
function drawFrame(g: CanvasRenderingContext2D, r: Rect, title: string, xLabel: string, yLabel: string, showX: boolean, zh: boolean): void {
  g.strokeStyle = COL.axis;
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = COL.text;
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  if (showX) {
    g.fillStyle = COL.dim;
    g.textAlign = 'right';
    g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  }
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = COL.dim;
  g.fillText(yLabel, 0, 0);
  g.restore();
}

// ---- computed-result containers ---------------------------------------------

interface PipeProducts {
  params: PipeParams;
  res: PipeResult;
  moody: { curves: Array<{ epsOverD: number; points: MoodyPoint[] }>; laminar: MoodyPoint[]; blasius: MoodyPoint[]; op: MoodyPoint };
  /** Colebrook vs Haaland relative deviation at the operating point. */
  haalandErr: number;
}

interface DuctProducts {
  params: DuctParams;
  stations: DuctStation[];
  conservation: { continuityErr: number; energyErrHead: number };
}

interface BlProducts {
  sol: BlasiusSolution;
  xs: number[];
  delta: number[];
  deltaStar: number[];
  theta: number[];
  cf: number[];
  /** Pohlhausen moments at the current λ. */
  pohl: ReturnType<typeof pohlhausenShape>;
  /** The λ the Pohlhausen moments/profiles were evaluated at. */
  lambda: number;
  eta: number[];
  blasiusProfile: number[];
  pohlhausenProfile: number[];
  nu: number;
  uInf: number;
}

interface Streamline {
  pts: Array<[number, number, number]>;
  speed: number[];
}

interface StreamProducts {
  aero: AeroResult;
  streamlines: Streamline[];
  thetaDeg: number[];
  speedRatio: number[];
  nu: number;
}

// ---- CSV / JSON / DataTable parsing (Block/Flow entry) ------------------------

interface ParsedTable {
  header: string[];
  rows: number[][];
}

function parseCsvTable(text: string): ParsedTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const header = lines[0]!
    .split(',')
    .map((h) => h.trim().toLowerCase());
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i]!.split(',').map((c) => c.trim());
    if (cells.length < header.length) continue;
    const row = header.map((_, j) => Number(cells[j]));
    if (row.some((v) => !Number.isFinite(v))) throw new Error(`non-numeric cell in CSV row ${i + 1}`);
    rows.push(row);
  }
  if (rows.length === 0) throw new Error('CSV has no data rows');
  return { header, rows };
}

function dataTableToParsed(table: DataTable): ParsedTable {
  const header = table.columnNames().map((h) => h.toLowerCase());
  const rows: number[][] = [];
  for (let i = 0; i < table.length; i += 1) {
    rows.push(header.map((h) => Number(table.getColumn(h)?.[i])));
  }
  return { header, rows };
}

function parseTableInput(input: unknown): ParsedTable {
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) return parseTableInput(JSON.parse(t) as unknown);
    return parseCsvTable(t);
  }
  const dv = input as DataValue | undefined;
  if (isDataTable(dv)) return dataTableToParsed(dv);
  if (Array.isArray(input)) {
    if (input.length === 0) throw new Error('empty input array');
    const first = input[0] as unknown;
    if (Array.isArray(first)) {
      const rows = (input as unknown[]).map((r) => (r as unknown[]).map((v) => Number(v)));
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new Error('non-numeric cell in row array');
      return { header: rows[0]!.map((_, i) => `col${i + 1}`), rows };
    }
    if (typeof first === 'object' && first !== null) {
      const keys: string[] = [];
      for (const o of input as Record<string, unknown>[]) {
        for (const key of Object.keys(o)) if (!keys.includes(key)) keys.push(key);
      }
      const rows = (input as Record<string, unknown>[]).map((o) => keys.map((k) => Number(o[k])));
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new Error('non-numeric cell in object array');
      return { header: keys.map((k) => k.toLowerCase()), rows };
    }
    throw new Error('unsupported array input');
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.csv === 'string') return parseCsvTable(o.csv);
    if (Array.isArray(o.header) && Array.isArray(o.rows)) {
      const header = (o.header as unknown[]).map((h) => String(h).toLowerCase());
      const rows = (o.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((v) => Number(v)) : []));
      if (rows.some((r) => r.length !== header.length || r.some((v) => !Number.isFinite(v)))) {
        throw new Error('rows must be numeric arrays matching the header length');
      }
      return { header, rows };
    }
    if (Array.isArray(o.columns) && o.columns.length > 0 && typeof o.columns[0] === 'object') {
      const cols = o.columns as Array<{ name?: unknown; values?: unknown }>;
      const header = cols.map((c, i) => String(c?.name ?? `col${i + 1}`).toLowerCase());
      const len = Array.isArray(cols[0]?.values) ? (cols[0]!.values as unknown[]).length : 0;
      if (len === 0) throw new Error('column values must be non-empty numeric arrays');
      const rows: number[][] = [];
      for (let i = 0; i < len; i += 1) {
        rows.push(cols.map((c) => Number((c.values as unknown[])[i])));
      }
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new Error('non-numeric cell in column object');
      return { header, rows };
    }
  }
  throw new Error('input must be CSV text, JSON table, row array or a DataTable');
}

// ---- plugin -------------------------------------------------------------------

export class EngFluidPlugin implements Plugin {
  readonly manifest = engFluidManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { ...DEFAULT_STATE };
  private products:
    | { mode: 'pipe'; data: PipeProducts }
    | { mode: 'bernoulli'; data: DuctProducts }
    | { mode: 'bl'; data: BlProducts }
    | { mode: 'stream'; data: StreamProducts }
    | null = null;
  private errorMsg: string | null = null;

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
    const s = this.state;
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'pipe', label: 'Pipe flow (Moody)', labelI18n: { 'zh-CN': '管流（Moody 图）', 'en-US': 'Pipe flow (Moody)' } },
          { value: 'bernoulli', label: 'Bernoulli duct', labelI18n: { 'zh-CN': 'Bernoulli 管道', 'en-US': 'Bernoulli duct' } },
          { value: 'bl', label: 'Boundary layer (Blasius)', labelI18n: { 'zh-CN': '边界层（Blasius）', 'en-US': 'Boundary layer (Blasius)' } },
          { value: 'stream', label: 'Streamlines (potential flow)', labelI18n: { 'zh-CN': '流线（势流绕流）', 'en-US': 'Streamlines (potential flow)' } },
        ],
        value: s.mode,
      },
      {
        key: 'rho',
        label: 'ρ (kg/m³)',
        labelI18n: { 'zh-CN': '密度 ρ (kg/m³)', 'en-US': 'Density ρ (kg/m³)' },
        type: 'range',
        min: 500,
        max: 2000,
        step: 1,
        value: s.rho,
        hint: this.zh ? '水 ≈ 998' : 'water ≈ 998',
      },
      {
        key: 'mu',
        label: 'μ (Pa·s)',
        labelI18n: { 'zh-CN': '动力黏度 μ (Pa·s)', 'en-US': 'Dynamic viscosity μ (Pa·s)' },
        type: 'range',
        min: 0.0001,
        max: 0.02,
        step: 0.0001,
        value: s.mu,
        hint: this.zh ? '理想 Bernoulli 模式不需要黏度' : 'unused by the ideal Bernoulli mode',
        visibleWhen: { key: 'mode', notIn: ['bernoulli'] },
      },
      // ---- pipe ----
      {
        key: 'd',
        label: 'd (m)',
        labelI18n: { 'zh-CN': '管径 d (m)', 'en-US': 'Diameter d (m)' },
        type: 'range',
        min: 0.01,
        max: 0.5,
        step: 0.005,
        value: s.d,
        visibleWhen: { key: 'mode', in: ['pipe'] },
      },
      {
        key: 'v',
        label: 'v (m/s)',
        labelI18n: { 'zh-CN': '平均流速 v (m/s)', 'en-US': 'Mean velocity v (m/s)' },
        type: 'range',
        min: 0.05,
        max: 10,
        step: 0.05,
        value: s.v,
        visibleWhen: { key: 'mode', in: ['pipe'] },
      },
      {
        key: 'L',
        label: 'L (m)',
        labelI18n: { 'zh-CN': '管长 L (m)', 'en-US': 'Length L (m)' },
        type: 'range',
        min: 1,
        max: 100,
        step: 1,
        value: s.L,
        visibleWhen: { key: 'mode', in: ['pipe'] },
      },
      {
        key: 'eps',
        label: 'ε (m)',
        labelI18n: { 'zh-CN': '绝对粗糙度 ε (m)', 'en-US': 'Roughness ε (m)' },
        type: 'range',
        min: 0,
        max: 0.005,
        step: 0.00005,
        value: s.eps,
        hint: this.zh ? '商品钢管 ≈ 1.5e-4 m' : 'commercial steel ≈ 1.5e-4 m',
        visibleWhen: { key: 'mode', in: ['pipe'] },
      },
      // ---- bernoulli ----
      {
        key: 'shape',
        label: 'Duct shape',
        labelI18n: { 'zh-CN': '管道形状', 'en-US': 'Duct shape' },
        type: 'select',
        options: [
          { value: 'venturi', label: 'Venturi (conv.+div.)', labelI18n: { 'zh-CN': '文丘里（收缩+扩张）', 'en-US': 'Venturi (conv.+div.)' } },
          { value: 'converging', label: 'Converging', labelI18n: { 'zh-CN': '收缩', 'en-US': 'Converging' } },
          { value: 'diverging', label: 'Diverging', labelI18n: { 'zh-CN': '扩张', 'en-US': 'Diverging' } },
        ],
        value: s.shape,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      {
        key: 'd1',
        label: 'd1 (m)',
        labelI18n: { 'zh-CN': '入口直径 d1 (m)', 'en-US': 'Inlet diameter d1 (m)' },
        type: 'range',
        min: 0.02,
        max: 0.5,
        step: 0.005,
        value: s.d1,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      {
        key: 'd2',
        label: 'd2 (m)',
        labelI18n: { 'zh-CN': '出口/喉部直径 d2 (m)', 'en-US': 'Outlet/throat diameter d2 (m)' },
        type: 'range',
        min: 0.02,
        max: 0.5,
        step: 0.005,
        value: s.d2,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      {
        key: 'v1',
        label: 'v1 (m/s)',
        labelI18n: { 'zh-CN': '入口流速 v1 (m/s)', 'en-US': 'Inlet velocity v1 (m/s)' },
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.1,
        value: s.v1,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      {
        key: 'p1',
        label: 'p1 (Pa, gauge)',
        labelI18n: { 'zh-CN': '入口表压 p1 (Pa)', 'en-US': 'Inlet gauge pressure p1 (Pa)' },
        type: 'range',
        min: -20000,
        max: 200000,
        step: 1000,
        value: s.p1,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      {
        key: 'len',
        label: 'Length (m)',
        labelI18n: { 'zh-CN': '管道长度 (m)', 'en-US': 'Duct length (m)' },
        type: 'range',
        min: 0.5,
        max: 10,
        step: 0.5,
        value: s.len,
        visibleWhen: { key: 'mode', in: ['bernoulli'] },
      },
      // ---- boundary layer ----
      {
        key: 'uInf',
        label: 'U∞ (m/s)',
        labelI18n: { 'zh-CN': '来流速度 U∞ (m/s)', 'en-US': 'Freestream U∞ (m/s)' },
        type: 'range',
        min: 0.1,
        max: 20,
        step: 0.1,
        value: s.uInf,
        visibleWhen: { key: 'mode', in: ['bl'] },
      },
      {
        key: 'plateL',
        label: 'L (m)',
        labelI18n: { 'zh-CN': '平板长度 L (m)', 'en-US': 'Plate length L (m)' },
        type: 'range',
        min: 0.1,
        max: 2,
        step: 0.05,
        value: s.plateL,
        visibleWhen: { key: 'mode', in: ['bl'] },
      },
      {
        key: 'lambda',
        label: 'λ (Pohlhausen)',
        labelI18n: { 'zh-CN': '压强梯度参数 λ', 'en-US': 'Pressure-gradient λ' },
        type: 'range',
        min: -12,
        max: 12,
        step: 0.5,
        value: s.lambda,
        hint: this.zh ? 'λ>0 顺压梯度，λ<0 逆压梯度，λ=−12 分离' : 'λ>0 favourable, λ<0 adverse, separation at λ=−12',
        visibleWhen: { key: 'mode', in: ['bl'] },
      },
      // ---- streamlines ----
      {
        key: 'body',
        label: 'Body',
        labelI18n: { 'zh-CN': '绕流物体', 'en-US': 'Body' },
        type: 'select',
        options: [
          { value: 'cylinder', label: 'Cylinder (2-D + Γ)', labelI18n: { 'zh-CN': '圆柱（二维 + 环量）', 'en-US': 'Cylinder (2-D + Γ)' } },
          { value: 'sphere', label: 'Sphere (3-D doublet)', labelI18n: { 'zh-CN': '圆球（三维偶极子）', 'en-US': 'Sphere (3-D doublet)' } },
        ],
        value: s.body,
        visibleWhen: { key: 'mode', in: ['stream'] },
      },
      {
        key: 'uFree',
        label: 'U∞ (m/s)',
        labelI18n: { 'zh-CN': '来流速度 U∞ (m/s)', 'en-US': 'Freestream U∞ (m/s)' },
        type: 'range',
        min: 0.1,
        max: 5,
        step: 0.1,
        value: s.uFree,
        visibleWhen: { key: 'mode', in: ['stream'] },
      },
      {
        key: 'radius',
        label: 'a (m)',
        labelI18n: { 'zh-CN': '半径 a (m)', 'en-US': 'Radius a (m)' },
        type: 'range',
        min: 0.1,
        max: 1,
        step: 0.05,
        value: s.radius,
        visibleWhen: { key: 'mode', in: ['stream'] },
      },
      {
        key: 'gamma',
        label: 'Γ (m²/s)',
        labelI18n: { 'zh-CN': '环量 Γ (m²/s)', 'en-US': 'Circulation Γ (m²/s)' },
        type: 'range',
        min: -5,
        max: 5,
        step: 0.1,
        value: s.gamma,
        hint: this.zh ? '仅作用于圆柱（Magnus 效应）；圆球忽略' : 'cylinder only (Magnus effect); ignored by the sphere',
        visibleWhen: { key: 'mode', in: ['stream'] },
      },
      {
        key: 'nLines',
        label: 'Streamlines',
        labelI18n: { 'zh-CN': '流线数量', 'en-US': 'Streamlines' },
        type: 'range',
        min: 4,
        max: 20,
        step: 1,
        value: s.nLines,
        visibleWhen: { key: 'mode', in: ['stream'] },
      },
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: keyof State, lo: number, hi: number): void => {
      const v = params[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = clamp(v, lo, hi);
      if (this.state[k] !== c) {
        (this.state[k] as number) = c;
        changed = true;
      }
    };
    const sel = <K extends keyof State>(k: K, allowed: readonly unknown[]): void => {
      const v = params[k];
      if (typeof v !== 'string') return;
      const hit = allowed.find((a) => a === v);
      if (hit !== undefined && this.state[k] !== hit) {
        this.state[k] = hit as State[K];
        changed = true;
      }
    };
    num('rho', 500, 2000);
    num('mu', 0.0001, 0.02);
    num('d', 0.01, 0.5);
    num('v', 0.05, 10);
    num('L', 1, 100);
    num('eps', 0, 0.005);
    num('d1', 0.02, 0.5);
    num('d2', 0.02, 0.5);
    num('v1', 0.1, 10);
    num('p1', -20000, 200000);
    num('len', 0.5, 10);
    num('uInf', 0.1, 20);
    num('plateL', 0.1, 2);
    num('lambda', -12, 12);
    num('uFree', 0.1, 5);
    num('radius', 0.1, 1);
    num('gamma', -5, 5);
    num('nLines', 4, 20);
    sel('mode', ['pipe', 'bernoulli', 'bl', 'stream'] as const);
    sel('shape', ['converging', 'diverging', 'venturi'] as const);
    sel('body', ['sphere', 'cylinder'] as const);

    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'run')) this.runSimulation();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- recompute (pure kernel calls; safe headlessly) --------------------------

  private recompute() {
    this.errorMsg = null;
    const s = this.state;
    try {
      if (s.mode === 'pipe') {
        const params: PipeParams = { d: s.d, v: s.v, rho: s.rho, mu: s.mu, L: s.L, eps: s.eps };
        const res = pipeFlow(params);
        const epsOverD = res.epsOverD;
        const curves = [
          { epsOverD, points: moodyTurbulentCurve(epsOverD) },
          { epsOverD: 0, points: moodyTurbulentCurve(0) },
        ];
        const fHaaland = res.re >= RE_TRANSITIONAL_MAX ? haalandFriction(res.re, epsOverD) : Number.NaN;
        this.products = {
          mode: 'pipe',
          data: {
            params,
            res,
            moody: { curves, laminar: moodyLaminarLine(), blasius: moodyBlasiusCurve(), op: { re: res.re, f: res.f } },
            haalandErr: Number.isFinite(fHaaland) ? Math.abs(res.f - fHaaland) / fHaaland : Number.NaN,
          },
        };
      } else if (s.mode === 'bernoulli') {
        const params: DuctParams = { shape: s.shape, d1: s.d1, d2: s.d2, v1: s.v1, p1: s.p1, len: s.len, rho: s.rho };
        this.products = {
          mode: 'bernoulli',
          data: { params, stations: ductStations(params), conservation: ductConservation(params) },
        };
      } else if (s.mode === 'bl') {
        const sol = solveBlasius();
        const nu = s.mu / s.rho;
        const n = 120;
        const xs: number[] = [];
        const delta: number[] = [];
        const deltaStar: number[] = [];
        const theta: number[] = [];
        const cf: number[] = [];
        for (let i = 1; i <= n; i += 1) {
          const x = (s.plateL * i) / n;
          const t = blasiusThicknesses(x, nu, s.uInf);
          xs.push(x);
          delta.push(t.delta);
          deltaStar.push(t.deltaStar);
          theta.push(t.theta);
          cf.push(t.cf);
        }
        const pohl = pohlhausenShape(s.lambda);
        const eta: number[] = [];
        const blasiusProfile: number[] = [];
        const pohlhausenProfileArr: number[] = [];
        for (let i = 0; i < sol.eta.length; i += 2) {
          eta.push(sol.eta[i]!);
          blasiusProfile.push(sol.fp[i]!);
          pohlhausenProfileArr.push(pohlhausenProfile(s.lambda, sol.eta[i]!));
        }
        this.products = {
          mode: 'bl',
          data: { sol, xs, delta, deltaStar, theta, cf, pohl, lambda: s.lambda, eta, blasiusProfile, pohlhausenProfile: pohlhausenProfileArr, nu, uInf: s.uInf },
        };
      } else {
        const nu = s.mu / s.rho;
        const aero = aeroReduction(s.body, s.rho, s.mu, s.uFree, s.radius, s.gamma);
        const streamlines = this.integrateStreamlines();
        const thetaDeg: number[] = [];
        const speedRatio: number[] = [];
        for (let i = 0; i <= 72; i += 1) {
          const th = (2 * Math.PI * i) / 72;
          thetaDeg.push((th * 180) / Math.PI);
          speedRatio.push(surfaceSpeedRatio(s.body, s.uFree, s.radius, s.gamma, th));
        }
        this.products = { mode: 'stream', data: { aero, streamlines, thetaDeg, speedRatio, nu } };
      }
    } catch (e) {
      this.products = null;
      this.errorMsg = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
  }

  /**
   * Integrate the normalized potential-flow field (uInf = a = 1, Γ* = Γ/(U·a))
   * into streamlines with RK4 on the unit-direction field and arc-length steps.
   * Deterministic seeds; no external state.
   */
  private integrateStreamlines(): Streamline[] {
    const s = this.state;
    const gammaStar = s.gamma / (s.uFree * s.radius);
    const body = s.body;
    const field = (x: number, y: number, z: number): [number, number, number] =>
      potentialFlowVelocity(body, 1, 1, gammaStar, x, y, z);
    const lines: Streamline[] = [];
    const n = Math.round(s.nLines);
    for (let i = 0; i < n; i += 1) {
      const y0 = -1.9 + (3.8 * (i + 0.5)) / n;
      const z0 = body === 'sphere' ? 0.55 * Math.sin(i * 2.399963 + 0.7) : 1.5 * (2 * ((i % 5) / 4) - 1);
      let px = -2.6;
      let py = y0;
      let pz = z0;
      const pts: Array<[number, number, number]> = [[px, py, pz]];
      const speed: number[] = [];
      const h = 0.02;
      for (let step = 0; step < 900; step += 1) {
        // RK4 on the normalized direction field (streamline = field line).
        const dir = (x: number, y: number, z: number): [number, number, number] => {
          const [ux, uy, uz] = field(x, y, z);
          const m = Math.hypot(ux, uy, uz);
          return m > 1e-12 ? [ux / m, uy / m, uz / m] : [0, 0, 0];
        };
        const [vx, vy, vz] = field(px, py, pz);
        const sp = Math.hypot(vx, vy, vz);
        speed.push(sp);
        if (sp < 1e-9) break; // stagnation point
        const a1 = dir(px, py, pz);
        const a2 = dir(px + (h / 2) * a1[0], py + (h / 2) * a1[1], pz + (h / 2) * a1[2]);
        const a3 = dir(px + (h / 2) * a2[0], py + (h / 2) * a2[1], pz + (h / 2) * a2[2]);
        const a4 = dir(px + h * a3[0], py + h * a3[1], pz + h * a3[2]);
        px += (h / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
        py += (h / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
        pz += (h / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
        pts.push([px, py, pz]);
        const r2 = px * px + py * py + pz * pz;
        const rInPlane = body === 'cylinder' ? Math.hypot(px, py) : 0;
        if (px > 3.2 || r2 > 25 || rInPlane > 4.5) break;
        if (r2 < 1.01 || rInPlane < 1.005) break; // reached the body surface
      }
      lines.push({ pts, speed });
    }
    return lines;
  }

  // ---- run / science outputs ----------------------------------------------------

  private runSimulation() {
    this.recompute();
    if (!this.products) {
      notify(this.api, 'error', `Computation failed: ${this.errorMsg ?? 'invalid parameters'}`, `计算失败：${this.errorMsg ?? '参数无效'}`);
      this.draw();
      return;
    }
    this.publishOutputs();
    const zh = this.zh;
    let msg: string;
    if (this.products.mode === 'pipe') {
      const r = this.products.data.res;
      msg = `Re = ${fmtMetric(r.re)} · f = ${fmtMetric(r.f)} · h_f = ${fmtMetric(r.hf)} m`;
    } else if (this.products.mode === 'bernoulli') {
      const c = this.products.data.conservation;
      msg = zh ? `连续性误差 ${c.continuityErr.toExponential(1)} · 能量误差 ${c.energyErrHead.toExponential(1)} m` : `continuity err ${c.continuityErr.toExponential(1)} · energy err ${c.energyErrHead.toExponential(1)} m`;
    } else if (this.products.mode === 'bl') {
      const sol = this.products.data.sol;
      msg = `f''(0) = ${fmtMetric(sol.fpp0, 5)} · η99 = ${fmtMetric(sol.eta99, 3)} · H = ${fmtMetric(sol.deltaStar / sol.theta, 4)}`;
    } else {
      const a = this.products.data.aero;
      msg = `Re = ${fmtMetric(a.re)} · Cd_Stokes = ${fmtMetric(a.cdStokes)} · Cl = ${fmtMetric(a.cl)}`;
    }
    notify(this.api, 'success', msg, msg);
    this.draw();
  }

  private publishOutputs() {
    const p = this.products;
    if (!p) return;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    const errOk = (c: number, a: number, tol: number): boolean =>
      Number.isFinite(a) && Number.isFinite(c) && (a !== 0 ? Math.abs(c - a) / Math.abs(a) < tol : Math.abs(c - a) < tol);
    const relErrPct = (c: number, a: number): string | null => {
      if (!Number.isFinite(a) || !Number.isFinite(c) || a === 0) return null;
      return `${fmtMetric((Math.abs(c - a) / Math.abs(a)) * 100, 3)}%`;
    };
    const pushRelErr = (key: string, labelZh: string, labelEn: string, c: number, a: number): void => {
      const s = relErrPct(c, a);
      if (s === null) return;
      metrics.push({
        key,
        label: zh ? labelZh : labelEn,
        value: s,
        unit: '%',
        severity: 'info',
        hint: zh ? '统一相对误差口径 |计算−解析|/|解析|' : 'unified yardstick |computed − analytic| / |analytic|',
      });
    };
    const regimeZh: Record<FlowRegime, string> = { laminar: '层流', transitional: '过渡流', turbulent: '湍流' };
    const regimeEn: Record<FlowRegime, string> = { laminar: 'laminar', transitional: 'transitional', turbulent: 'turbulent' };

    if (p.mode === 'pipe') {
      const r = p.data.res;
      const sev: ScienceSeverity = r.regime === 'transitional' ? 'warn' : 'ok';
      metrics.push({
        key: 're',
        label: zh ? '雷诺数 Re' : 'Reynolds number Re',
        value: fmtMetric(r.re),
        severity: sev,
        hint: zh ? `流态：${regimeZh[r.regime]}（层流 < ${RE_LAMINAR_MAX}，过渡 < ${RE_TRANSITIONAL_MAX}）` : `regime: ${regimeEn[r.regime]} (laminar < ${RE_LAMINAR_MAX}, transitional < ${RE_TRANSITIONAL_MAX})`,
      });
      metrics.push({
        key: 'f',
        label: zh ? 'Darcy 摩阻系数 f' : 'Darcy friction factor f',
        value: fmtMetric(r.f),
        severity: errOk(r.f, haalandFriction(r.re, r.epsOverD), 0.02) || r.regime !== 'turbulent' ? 'ok' : 'warn',
        hint: zh
          ? `Colebrook–White (Newton)；Haaland 参考 ${fmtMetric(haalandFriction(r.re, r.epsOverD))}`
          : `Colebrook–White (Newton); Haaland reference ${fmtMetric(haalandFriction(r.re, r.epsOverD))}`,
      });
      if (Number.isFinite(p.data.haalandErr)) {
        metrics.push({
          key: 'rel-err-f-haaland',
          label: zh ? 'f 相对 Haaland 偏差' : 'f vs Haaland rel err',
          value: `${fmtMetric(p.data.haalandErr * 100, 3)}%`,
          unit: '%',
          severity: p.data.haalandErr < 0.02 ? 'ok' : 'warn',
          hint: zh ? '统一相对误差口径 |计算−解析|/|解析|' : 'unified yardstick |computed − analytic| / |analytic|',
        });
      }
      metrics.push({ key: 'hf', label: zh ? '沿程水头损失 h_f' : 'Head loss h_f', value: fmtMetric(r.hf), unit: 'm', severity: 'info' });
      metrics.push({ key: 'dp', label: zh ? '压降 Δp = ρg·h_f' : 'Pressure drop Δp = ρg·h_f', value: fmtMetric(r.dp), unit: 'Pa', severity: 'info' });
    } else if (p.mode === 'bernoulli') {
      const d = p.data;
      const c = d.conservation;
      metrics.push({
        key: 'continuity',
        label: zh ? '连续性残差 max|A·v−Q₀|/Q₀' : 'Continuity residual max|A·v−Q₀|/Q₀',
        value: c.continuityErr.toExponential(2),
        severity: c.continuityErr < 1e-9 ? 'ok' : 'warn',
        hint: zh ? '解析应精确为 0（浮点舍入量级）' : 'exactly zero analytically (round-off level)',
      });
      metrics.push({
        key: 'energy',
        label: zh ? 'Bernoulli 漂移 max|p+½ρv²−E₀|/(ρg)' : 'Bernoulli drift max|p+½ρv²−E₀|/(ρg)',
        value: `${c.energyErrHead.toExponential(2)} m`,
        severity: c.energyErrHead < 1e-9 ? 'ok' : 'warn',
      });
      const vThroat = Math.max(...d.stations.map((s) => s.v));
      const pMin = Math.min(...d.stations.map((s) => s.p));
      metrics.push({ key: 'v-max', label: zh ? '最大流速' : 'Maximum velocity', value: fmtMetric(vThroat), unit: 'm/s', severity: 'info' });
      metrics.push({
        key: 'p-min',
        label: zh ? '最小表压 p_min' : 'Minimum gauge pressure p_min',
        value: fmtMetric(pMin),
        unit: 'Pa',
        severity: pMin < -101325 ? 'warn' : 'info',
        hint: zh ? '低于 −101.3 kPa（表压）提示汽化风险' : 'below −101.3 kPa (gauge) vaporisation is indicated',
      });
    } else if (p.mode === 'bl') {
      const b = p.data;
      const sol = b.sol;
      const H = sol.deltaStar / sol.theta;
      const cfEnd = b.cf[b.cf.length - 1]!;
      const reXEnd = (b.uInf * b.xs[b.xs.length - 1]!) / b.nu;
      metrics.push({
        key: 'fpp0',
        label: zh ? '打靶值 f″(0)' : 'Shooting value f″(0)',
        value: fmtMetric(sol.fpp0, 6),
        severity: errOk(sol.fpp0, 0.3320573362, 1e-4) ? 'ok' : 'warn',
        hint: `${zh ? '解析' : 'analytic'} 0.3320573`,
      });
      pushRelErr('rel-err-fpp0', 'f″(0) 相对误差', 'f″(0) rel err', sol.fpp0, 0.3320573362);
      metrics.push({
        key: 'eta99',
        label: zh ? 'η₉₉（δ = η₉₉√(νx/U)）' : 'η₉₉ (δ = η₉₉√(νx/U))',
        value: fmtMetric(sol.eta99, 4),
        severity: errOk(sol.eta99, 5.0, 0.02) ? 'ok' : 'warn',
        hint: `${zh ? 'Blasius δ/x = 5/√Rex 的精确来源' : 'exact origin of the Blasius δ/x = 5/√Rex rule'}`,
      });
      pushRelErr('rel-err-eta99', 'η₉₉ 相对误差 (基准 5.0)', 'η₉₉ rel err (ref 5.0)', sol.eta99, 5.0);
      metrics.push({
        key: 'H-blasius',
        label: zh ? '形状因子 H = δ*/θ' : 'Shape factor H = δ*/θ',
        value: fmtMetric(H, 5),
        severity: errOk(H, 2.5911, 1e-3) ? 'ok' : 'warn',
        hint: `${zh ? '解析' : 'analytic'} 1.7208/0.6641 = 2.5911`,
      });
      metrics.push({
        key: 'cf-end',
        label: zh ? '尾缘局部 cf' : 'Trailing-edge local cf',
        value: fmtMetric(cfEnd),
        severity: errOk(cfEnd, 0.664 / Math.sqrt(reXEnd), 0.002) ? 'ok' : 'warn',
        hint: `${zh ? '解析' : 'analytic'} 0.664/√Rex = ${fmtMetric(0.664 / Math.sqrt(reXEnd))}`,
      });
      metrics.push({
        key: 'pohlhausen',
        label: zh ? 'Pohlhausen H(λ)' : 'Pohlhausen H(λ)',
        value: fmtMetric(b.pohl.H, 4),
        severity: b.pohl.separated ? 'error' : b.lambda < -6 ? 'warn' : 'info',
        hint: b.pohl.separated
          ? zh ? `λ = ${b.lambda} ≤ −12：壁面剪切消失，边界层分离` : `λ = ${b.lambda} ≤ −12: wall shear vanishes, boundary layer separated`
          : zh ? `壁面剪切 2+λ/6 = ${fmtMetric(b.pohl.wallShear, 4)}；H(−12) = 3.5 为分离值` : `wall shear 2+λ/6 = ${fmtMetric(b.pohl.wallShear, 4)}; H = 3.5 at separation (λ = −12)`,
      });
    } else {
      const st = p.data;
      const a = st.aero;
      metrics.push({
        key: 're',
        label: zh ? '雷诺数 Re = ρU·2a/μ' : 'Reynolds number Re = ρU·2a/μ',
        value: fmtMetric(a.re),
        severity: 'info',
      });
      metrics.push({
        key: 'cd-potential',
        label: zh ? '势流阻力 Cd（d\'Alembert）' : 'Potential-flow Cd (d\'Alembert)',
        value: '0',
        severity: 'info',
        hint: zh ? '无黏无旋绕流阻力恒为零（达朗贝尔佯谬）' : 'inviscid irrotational drag vanishes identically',
      });
      metrics.push({
        key: 'cd-stokes',
        label: zh ? 'Stokes 阻力系数 Cd = 24/Re' : 'Stokes drag Cd = 24/Re',
        value: fmtMetric(a.cdStokes),
        severity: 'ok',
        hint: zh
          ? `闭式验证 F = ½ρU²·Cd·πa² = 6πμaU = ${fmtMetric(6 * Math.PI * this.state.mu * this.state.radius * this.state.uFree, 6)} N`
          : `closed-form check F = ½ρU²·Cd·πa² = 6πμaU = ${fmtMetric(6 * Math.PI * this.state.mu * this.state.radius * this.state.uFree, 6)} N`,
      });
      if (Number.isFinite(a.cdSchillerNaumann)) {
        metrics.push({
          key: 'cd-sn',
          label: zh ? 'Schiller–Naumann Cd' : 'Schiller–Naumann Cd',
          value: fmtMetric(a.cdSchillerNaumann),
          severity: 'info',
          hint: zh ? '有限 Re 修正 (24/Re)(1+0.15Re^0.687)，Re ≤ 1000' : 'finite-Re correction (24/Re)(1+0.15Re^0.687), Re ≤ 1000',
        });
      }
      if (this.state.body === 'cylinder') {
        metrics.push({
          key: 'cl',
          label: zh ? 'Kutta–Joukowski 升力系数 Cl = Γ/(U·a)' : 'Kutta–Joukowski lift Cl = Γ/(U·a)',
          value: fmtMetric(a.cl),
          severity: 'ok',
          hint: zh ? `升力（单位展长）ρUΓ = ${fmtMetric(a.liftPerSpan, 6)} N/m` : `lift per span ρUΓ = ${fmtMetric(a.liftPerSpan, 6)} N/m`,
        });
        metrics.push({
          key: 'stagnation',
          label: zh ? '表面驻点' : 'Surface stagnation points',
          value: a.stagnation
            ? `θ = ${fmtMetric((a.stagnation[0]! * 180) / Math.PI, 3)}°, ${fmtMetric((a.stagnation[1]! * 180) / Math.PI, 3)}°`
            : zh ? '脱离表面' : 'detached',
          severity: a.stagnation ? 'ok' : 'warn',
          hint: zh ? '解析 sinθ = Γ/(4πUa)；|Γ| ≥ 4πUa 时驻点离面' : 'analytic sinθ = Γ/(4πUa); detached when |Γ| ≥ 4πUa',
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export -------------------------------------------------------------------

  private exportCsv() {
    const p = this.products;
    if (!p) {
      notify(this.api, 'warning', 'Run a computation first.', '请先运行计算。');
      return;
    }
    if (p.mode === 'pipe') {
      const rows: Array<Array<number | string>> = [];
      for (const c of p.data.moody.curves) {
        for (const pt of c.points) rows.push([c.epsOverD === 0 ? 0 : Number(c.epsOverD.toPrecision(6)), Number(pt.re.toPrecision(8)), Number(pt.f.toPrecision(8))]);
      }
      for (const pt of p.data.moody.laminar) rows.push(['laminar', Number(pt.re.toPrecision(8)), Number(pt.f.toPrecision(8))]);
      rows.push(['operating', Number(p.data.res.re.toPrecision(8)), Number(p.data.res.f.toPrecision(8))]);
      exportRowsCsv(this.api, 'fluid-moody', ['eps_over_d', 're', 'f'], rows);
    } else if (p.mode === 'bernoulli') {
      const rows: Array<Array<number | string>> = p.data.stations.map((s) => [
        Number(s.x.toPrecision(8)),
        Number(s.d.toPrecision(8)),
        Number(s.v.toPrecision(8)),
        Number(s.p.toPrecision(8)),
        Number(s.hgl.toPrecision(8)),
        Number(s.egl.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'fluid-duct', ['x_m', 'd_m', 'v_m_s', 'p_gauge_pa', 'hgl_m', 'egl_m'], rows);
    } else if (p.mode === 'bl') {
      const rows: Array<Array<number | string>> = p.data.xs.map((x, i) => [
        Number(x.toPrecision(8)),
        Number(p.data.delta[i]!.toPrecision(8)),
        Number(p.data.deltaStar[i]!.toPrecision(8)),
        Number(p.data.theta[i]!.toPrecision(8)),
        Number(p.data.cf[i]!.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'fluid-blasius', ['x_m', 'delta99_m', 'delta_star_m', 'theta_m', 'cf'], rows);
    } else {
      const rows: Array<Array<number | string>> = [];
      for (let li = 0; li < p.data.streamlines.length; li += 1) {
        const line = p.data.streamlines[li]!;
        const stride = Math.max(1, Math.ceil(line.pts.length / 400));
        for (let i = 0; i < line.pts.length; i += stride) {
          const [x, y, z] = line.pts[i]!;
          rows.push([li, Number(x.toPrecision(6)), Number(y.toPrecision(6)), Number(z.toPrecision(6)), Number(line.speed[i]!.toPrecision(6))]);
        }
      }
      exportRowsCsv(this.api, 'fluid-streamlines', ['line_id', 'x', 'y', 'z', 'speed_over_u_inf'], rows);
    }
  }

  private async sendToFigure(): Promise<void> {
    if (!this.products) this.recompute();
    const p = this.products;
    if (!p) {
      notify(this.api, 'warning', 'No computation yet — press "Run" first.', '尚未计算 — 请先点击「运行」。');
      return;
    }
    const payload: FigurePayload = {};
    let title: Bilingual;
    let caption: Bilingual;
    if (p.mode === 'pipe') {
      payload.moody = { curves: p.data.moody.curves, laminar: p.data.moody.laminar, blasius: p.data.moody.blasius, op: p.data.moody.op };
      title = { zh: '管流 Moody 图分析', en: 'Pipe Flow Moody Chart Analysis' };
      caption = {
        zh: `Re = ${fmtMetric(p.data.res.re)}（${p.data.res.regime === 'laminar' ? '层流' : p.data.res.regime === 'transitional' ? '过渡流' : '湍流'}），f = ${fmtMetric(p.data.res.f)}，h_f = ${fmtMetric(p.data.res.hf)} m。`,
        en: `Re = ${fmtMetric(p.data.res.re)} (${p.data.res.regime}), f = ${fmtMetric(p.data.res.f)}, h_f = ${fmtMetric(p.data.res.hf)} m.`,
      };
    } else if (p.mode === 'bernoulli') {
      payload.duct = { params: p.data.params, stations: p.data.stations };
      title = { zh: '理想管道 Bernoulli 分析', en: 'Ideal Duct Bernoulli Analysis' };
      caption = {
        zh: `连续性残差 ${p.data.conservation.continuityErr.toExponential(1)}，最大流速 ${fmtMetric(Math.max(...p.data.stations.map((s) => s.v)))} m/s。`,
        en: `Continuity residual ${p.data.conservation.continuityErr.toExponential(1)}, max velocity ${fmtMetric(Math.max(...p.data.stations.map((s) => s.v)))} m/s.`,
      };
    } else if (p.mode === 'bl') {
      payload.bl = {
        xs: p.data.xs,
        delta: p.data.delta,
        deltaStar: p.data.deltaStar,
        theta: p.data.theta,
        cf: p.data.cf,
        eta: p.data.eta,
        blasiusProfile: p.data.blasiusProfile,
        pohlhausenProfile: p.data.pohlhausenProfile,
        lambda: this.state.lambda,
        separated: p.data.pohl.separated,
      };
      title = { zh: 'Blasius 平板边界层分析', en: 'Blasius Flat-Plate Boundary Layer' };
      caption = {
        zh: `f″(0) = ${fmtMetric(p.data.sol.fpp0, 5)}，η₉₉ = ${fmtMetric(p.data.sol.eta99, 3)}，δ/x = ${fmtMetric(p.data.sol.eta99 / Math.sqrt((p.data.uInf * p.data.xs[p.data.xs.length - 1]!) / p.data.nu), 4)}/√Rex。`,
        en: `f″(0) = ${fmtMetric(p.data.sol.fpp0, 5)}, η₉₉ = ${fmtMetric(p.data.sol.eta99, 3)}, δ/x = η₉₉/√Rex with η₉₉ = ${fmtMetric(p.data.sol.eta99, 3)}.`,
      };
    } else {
      payload.stream = { body: this.state.body, thetaDeg: p.data.thetaDeg, speedRatio: p.data.speedRatio, cl: p.data.aero.cl };
      title = { zh: '势流绕流流线分析', en: 'Potential-Flow Streamline Analysis' };
      caption = {
        zh: `${this.state.body === 'sphere' ? '圆球' : '圆柱'}绕流：Re = ${fmtMetric(p.data.aero.re)}，Cd_Stokes = ${fmtMetric(p.data.aero.cdStokes)}，Cl = ${fmtMetric(p.data.aero.cl)}。`,
        en: `${this.state.body} flow: Re = ${fmtMetric(p.data.aero.re)}, Cd_Stokes = ${fmtMetric(p.data.aero.cdStokes)}, Cl = ${fmtMetric(p.data.aero.cl)}.`,
      };
    }
    const panels = fluidFigurePanels(p.mode, payload);
    if (panels.length === 0) {
      notify(this.api, 'warning', 'No plottable panels for the current mode.', '当前模式没有可发送的图面。');
      return;
    }
    await pushPanelsToFigure(this.api, title, caption, panels);
  }

  // ---- compute (Block / Flow headless entry) -------------------------------------

  async compute(input: unknown): Promise<ComputeResult> {
    try {
      if (input === null || input === undefined) {
        // No input: serialize the current mode's reduction as a DataTable.
        if (!this.products) this.recompute();
        return { ok: true, output: this.currentModeTable() };
      }
      const { header, rows } = parseTableInput(input);
      const idx = (names: string[]): number => header.findIndex((h) => names.includes(h));
      const dI = idx(['d', 'diameter']);
      const vI = idx(['v', 'velocity']);
      if (dI < 0 || vI < 0) {
        throw new Error('pipe-table input requires columns d (diameter) and v (velocity); optional rho, mu, L, eps');
      }
      const rhoI = idx(['rho', 'density']);
      const muI = idx(['mu', 'viscosity']);
      const lI = idx(['l', 'length']);
      const eI = idx(['eps', 'roughness']);
      const s = this.state;
      const results = rows.map((r) =>
        pipeFlow({
          d: r[dI]!,
          v: r[vI]!,
          rho: rhoI >= 0 ? r[rhoI]! : s.rho,
          mu: muI >= 0 ? r[muI]! : s.mu,
          L: lI >= 0 ? r[lI]! : s.L,
          eps: eI >= 0 ? r[eI]! : s.eps,
        }),
      );
      // Reflect the first row back into the workbench (pipe mode) like the
      // other engineering plugins do.
      const first = results[0]!;
      const row0 = rows[0]!;
      s.mode = 'pipe';
      s.d = clamp(row0[dI]!, 0.01, 0.5);
      s.v = clamp(row0[vI]!, 0.05, 10);
      if (rhoI >= 0) s.rho = clamp(row0[rhoI]!, 500, 2000);
      if (muI >= 0) s.mu = clamp(row0[muI]!, 0.0001, 0.02);
      if (lI >= 0) s.L = clamp(row0[lI]!, 1, 100);
      if (eI >= 0) s.eps = clamp(row0[eI]!, 0, 0.005);
      this.recompute();
      const regimeCount = (reg: FlowRegime): number => results.filter((r) => r.regime === reg).length;
      return {
        ok: true,
        output: {
          table: pipeResultTable(results),
          metrics: {
            count: results.length,
            re: first.re,
            f: first.f,
            hf: first.hf,
            regime: first.regime,
            laminar: regimeCount('laminar'),
            transitional: regimeCount('transitional'),
            turbulent: regimeCount('turbulent'),
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Current-mode reduction as a DataTable + metrics (headless default path). */
  private currentModeTable(): { table: DataTable; metrics: Record<string, number | string> } {
    const p = this.products;
    if (!p) throw new Error(this.errorMsg ?? 'no computation available');
    if (p.mode === 'pipe') {
      const r = p.data.res;
      return {
        table: pipeResultTable([r]),
        metrics: { mode: 'pipe', re: r.re, f: r.f, regime: r.regime, hf: r.hf, dp: r.dp, haalandRelErr: p.data.haalandErr },
      };
    }
    if (p.mode === 'bernoulli') {
      const st = p.data.stations;
      const n = st.length;
      const table = createDataTable('eng-fluid-duct', [
        { name: 'x', type: 'f64', data: Float64Array.from(st.map((s) => s.x)), unit: 'm' },
        { name: 'd', type: 'f64', data: Float64Array.from(st.map((s) => s.d)), unit: 'm' },
        { name: 'v', type: 'f64', data: Float64Array.from(st.map((s) => s.v)), unit: 'm/s' },
        { name: 'p', type: 'f64', data: Float64Array.from(st.map((s) => s.p)), unit: 'Pa' },
        { name: 'hgl', type: 'f64', data: Float64Array.from(st.map((s) => s.hgl)), unit: 'm' },
        { name: 'egl', type: 'f64', data: Float64Array.from(st.map((s) => s.egl)), unit: 'm' },
      ], { tags: ['fluid', 'bernoulli'], provenance: 'eng-fluid ductStations' });
      return {
        table,
        metrics: {
          mode: 'bernoulli',
          continuityErr: p.data.conservation.continuityErr,
          energyErrHead: p.data.conservation.energyErrHead,
          vMax: Math.max(...st.map((s) => s.v)),
          pMin: Math.min(...st.map((s) => s.p)),
          stations: n,
        },
      };
    }
    if (p.mode === 'bl') {
      const b = p.data;
      const table = createDataTable('eng-fluid-blasius', [
        { name: 'x', type: 'f64', data: Float64Array.from(b.xs), unit: 'm' },
        { name: 'delta99', type: 'f64', data: Float64Array.from(b.delta), unit: 'm' },
        { name: 'delta_star', type: 'f64', data: Float64Array.from(b.deltaStar), unit: 'm' },
        { name: 'theta', type: 'f64', data: Float64Array.from(b.theta), unit: 'm' },
        { name: 'cf', type: 'f64', data: Float64Array.from(b.cf) },
      ], { tags: ['fluid', 'blasius'], provenance: 'eng-fluid blasiusThicknesses' });
      const sol = b.sol;
      return {
        table,
        metrics: {
          mode: 'bl',
          fpp0: sol.fpp0,
          eta99: sol.eta99,
          H: sol.deltaStar / sol.theta,
          pohlhausenH: b.pohl.H,
          separated: b.pohl.separated ? 1 : 0,
        },
      };
    }
    const st = p.data;
    const table = createDataTable('eng-fluid-stream', [
      { name: 'theta_deg', type: 'f64', data: Float64Array.from(st.thetaDeg), unit: 'deg' },
      { name: 'speed_ratio', type: 'f64', data: Float64Array.from(st.speedRatio) },
    ], { tags: ['fluid', 'potential-flow'], provenance: 'eng-fluid surfaceSpeedRatio' });
    return {
      table,
      metrics: {
        mode: 'stream',
        re: st.aero.re,
        cdPotential: st.aero.cdPotential,
        cdStokes: st.aero.cdStokes,
        cdSchillerNaumann: st.aero.cdSchillerNaumann,
        fdStokes: st.aero.fdStokes,
        cl: st.aero.cl,
      },
    };
  }

  // ---- drawing -------------------------------------------------------------------

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
    if (!this.products) this.recompute();

    if (!this.products) {
      if (this.errorMsg) {
        g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = 'rgba(255,140,140,0.95)';
        g.font = this.fnt(13);
        g.textAlign = 'center';
        g.fillText(this.zh ? `参数无效：${this.errorMsg}` : `Invalid parameters: ${this.errorMsg}`, canvas.width / 2, canvas.height / 2);
      } else {
        drawEmptyCanvas(this.api, canvas, {
          title: 'No computation yet',
          titleZh: '尚未计算',
          hint: 'Adjust the parameters and press "Run".',
          hintZh: '调整参数后点击「运行」。',
        });
      }
      return;
    }

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const w = canvas.width;
    const h = canvas.height;

    g.textAlign = 'center';
    g.fillStyle = COL.text;
    g.font = this.fnt(13);
    const titles: Record<FluidMode, [string, string]> = {
      pipe: ['管流 · Moody 图（Colebrook–White）', 'Pipe flow · Moody chart (Colebrook–White)'],
      bernoulli: ['理想管道 · 连续性 + Bernoulli', 'Ideal duct · continuity + Bernoulli'],
      bl: ['平板边界层 · Blasius + Pohlhausen', 'Flat-plate boundary layer · Blasius + Pohlhausen'],
      stream: ['势流绕流 · 投影流线', 'Potential flow · projected streamlines'],
    };
    const t = titles[this.state.mode];
    g.fillText(zh ? t[0] : t[1], w / 2, 18);

    const left = 52;
    const top = 30;
    const width = w - left - 16;
    const bottom = h - 40;
    const avail = bottom - top;
    const gap = 12;

    if (this.products.mode === 'pipe') {
      this.drawMoody(g, { x: left, y: top, w: width, h: avail });
    } else if (this.products.mode === 'bernoulli') {
      const h1 = (avail - gap) * 0.48;
      const h2 = avail - gap - h1;
      this.drawDuctGeometry(g, { x: left, y: top, w: width, h: h1 }, true);
      this.drawDuctHeads(g, { x: left, y: top + h1 + gap, w: width, h: h2 }, true);
    } else if (this.products.mode === 'bl') {
      const h1 = (avail - 2 * gap) * 0.4;
      const h2 = (avail - 2 * gap) * 0.24;
      const h3 = avail - 2 * gap - h1 - h2;
      this.drawBlGrowth(g, { x: left, y: top, w: width, h: h1 }, false);
      this.drawBlCf(g, { x: left, y: top + h1 + gap, w: width, h: h2 }, true);
      this.drawBlProfiles(g, { x: left, y: top + h1 + h2 + 2 * gap, w: width, h: h3 }, true);
    } else {
      this.drawStream(g, { x: left, y: top, w: width, h: avail });
    }
    this.drawFooter(g, h);
  }

  /** Moody chart: log–log axes, laminar branch, Colebrook curves, operating point. */
  private drawMoody(g: CanvasRenderingContext2D, r: Rect) {
    const p = this.products as { mode: 'pipe'; data: PipeProducts };
    const zh = this.zh;
    const logReLo = Math.log10(500);
    const logReHi = 8;
    const fLo = 0.008;
    const fHi = 0.1;
    const mapX = (re: number): number => r.x + ((Math.log10(re) - logReLo) / (logReHi - logReLo)) * r.w;
    const mapY = (f: number): number => r.y + r.h - ((Math.log10(f) - Math.log10(fLo)) / (Math.log10(fHi) - Math.log10(fLo))) * r.h;

    drawFrame(g, r, zh ? 'Moody 图 — Darcy 摩阻系数' : 'Moody chart — Darcy friction factor', 'Re', 'f', true, zh);

    // Decade + minor log gridlines.
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    for (let k = Math.ceil(logReLo); k <= Math.floor(logReHi); k += 1) {
      for (let m = 1; m < 10; m += 1) {
        const re = m * Math.pow(10, k);
        if (re < 500 || re > 1e8) continue;
        const x = mapX(re);
        g.strokeStyle = m === 1 ? COL.grid : COL.gridMinor;
        g.beginPath();
        g.moveTo(x, r.y);
        g.lineTo(x, r.y + r.h);
        g.stroke();
        if (m === 1) {
          g.fillStyle = COL.dim;
          g.fillText(fmtTick(re), x, r.y + r.h + 13);
        }
      }
    }
    g.textAlign = 'right';
    for (let k = Math.log10(fLo); k <= Math.log10(fHi); k += 1) {
      for (let m = 1; m < 10; m += 1) {
        const f = m * Math.pow(10, k);
        if (f < fLo || f > fHi) continue;
        const y = mapY(f);
        g.strokeStyle = m === 1 ? COL.grid : COL.gridMinor;
        g.beginPath();
        g.moveTo(r.x, y);
        g.lineTo(r.x + r.w, y);
        g.stroke();
        if (m === 1 || m === 2 || m === 5) {
          g.fillStyle = COL.dim;
          g.fillText(fmtTick(f), r.x - 4, y + 3);
        }
      }
    }

    // Transitional band shading (2300 ≤ Re < 4000).
    g.fillStyle = 'rgba(255,209,102,0.07)';
    g.fillRect(mapX(RE_LAMINAR_MAX), r.y, mapX(RE_TRANSITIONAL_MAX) - mapX(RE_LAMINAR_MAX), r.h);

    const drawCurve = (pts: MoodyPoint[], style: string, dash: number[], lw: number): void => {
      g.strokeStyle = style;
      g.setLineDash(dash);
      g.lineWidth = lw;
      g.beginPath();
      let pen = false;
      for (const pt of pts) {
        if (pt.re < 500 || pt.f < fLo || pt.f > fHi) {
          pen = false;
          continue;
        }
        const x = mapX(pt.re);
        const y = mapY(pt.f);
        if (!pen) {
          g.moveTo(x, y);
          pen = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    };

    // Laminar branch + Colebrook curves + Blasius reference.
    drawCurve(p.data.moody.laminar, COL.teal, [], 1.6);
    const [current, smooth] = p.data.moody.curves;
    if (current && current.epsOverD > 0) drawCurve(current.points, COL.blue, [], 2);
    if (smooth) drawCurve(smooth.points, 'rgba(90,191,255,0.45)', [5, 4], 1.4);
    drawCurve(p.data.moody.blasius, COL.amber, [2, 3], 1.4);

    // Operating point crosshair.
    const op = p.data.moody.op;
    const ox = mapX(op.re);
    const oy = mapY(op.f);
    g.strokeStyle = COL.orange;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(r.x, oy);
    g.lineTo(r.x + r.w, oy);
    g.moveTo(ox, r.y);
    g.lineTo(ox, r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = COL.orange;
    g.beginPath();
    g.arc(ox, oy, 4, 0, Math.PI * 2);
    g.fill();

    // Legend.
    let ly = r.y + 16;
    const lx = r.x + r.w - 150;
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const legend: Array<[string, string, number[], string]> = [
      [zh ? '当前 ε/d（Colebrook）' : `current ε/d (Colebrook)`, COL.blue, [], '—'],
      [zh ? '光滑管 ε/d = 0' : 'smooth ε/d = 0', 'rgba(90,191,255,0.45)', [5, 4], '—'],
      ['laminar 64/Re', COL.teal, [], '—'],
      ['Blasius 0.3164/Re^0.25', COL.amber, [2, 3], '—'],
      [zh ? '工作点' : 'operating point', COL.orange, [], '—'],
    ];
    for (const [name, color, dash] of legend) {
      g.strokeStyle = color;
      g.setLineDash(dash);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 18, ly - 3);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.fillText(name, lx + 24, ly);
      ly += 14;
    }
  }

  /** Bernoulli duct: silhouette + velocity profile along x. */
  private drawDuctGeometry(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const p = this.products as { mode: 'bernoulli'; data: DuctProducts };
    const zh = this.zh;
    const st = p.data.stations;
    const dMax = Math.max(...st.map((s) => s.d));
    const vMax = Math.max(...st.map((s) => s.v));
    const xMax = st[st.length - 1]!.x;
    const mapX = (x: number): number => r.x + (x / xMax) * r.w;
    const centerY = r.y + r.h * 0.42;
    const dScale = (r.h * 0.36) / dMax;
    const mapD = (d: number): number => centerY - (d / 2) * dScale;
    const mapV = (v: number): number => r.y + r.h - (v / (vMax * 1.15)) * (r.h * 0.5) - r.h * 0.02;

    drawFrame(g, r, zh ? '管道轮廓与流速 v(x)（连续性）' : 'Duct silhouette and velocity v(x) (continuity)', 'x (m)', 'd, v', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.textAlign = 'center';
    g.fillStyle = COL.dim;
    for (const x of linTicks(0, xMax, 6)) {
      const px = mapX(x);
      g.beginPath();
      g.moveTo(px, r.y);
      g.lineTo(px, r.y + r.h);
      g.stroke();
      if (showX) g.fillText(fmtTick(x), px, r.y + r.h + 13);
    }

    // Duct walls (upper and lower silhouette about the centreline).
    g.strokeStyle = COL.wall;
    g.lineWidth = 2;
    g.beginPath();
    st.forEach((s, i) => (i === 0 ? g.moveTo(mapX(s.x), mapD(s.d)) : g.lineTo(mapX(s.x), mapD(s.d))));
    g.stroke();
    g.beginPath();
    st.forEach((s, i) => (i === 0 ? g.moveTo(mapX(s.x), centerY + (s.d / 2) * dScale) : g.lineTo(mapX(s.x), centerY + (s.d / 2) * dScale)));
    g.stroke();

    // Velocity curve (its own scale, overlaid).
    g.strokeStyle = COL.blue;
    g.lineWidth = 2;
    g.beginPath();
    st.forEach((s, i) => (i === 0 ? g.moveTo(mapX(s.x), mapV(s.v)) : g.lineTo(mapX(s.x), mapV(s.v))));
    g.stroke();

    // Inlet reference line + labels.
    g.strokeStyle = COL.grey;
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mapX(0), mapV(st[0]!.v));
    g.lineTo(mapX(xMax), mapV(st[0]!.v));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillText(`d1 = ${fmtTick(p.data.params.d1)} m`, r.x + 6, mapD(p.data.params.d1) - 4);
    g.fillText(`v1 = ${fmtTick(p.data.params.v1)} m/s`, r.x + 6, mapV(st[0]!.v) - 4);
  }

  /** Bernoulli head lines: HGL p/(ρg) and EGL (constant). */
  private drawDuctHeads(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const p = this.products as { mode: 'bernoulli'; data: DuctProducts };
    const zh = this.zh;
    const st = p.data.stations;
    const xMax = st[st.length - 1]!.x;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of st) {
      lo = Math.min(lo, s.hgl, s.egl);
      hi = Math.max(hi, s.hgl, s.egl);
    }
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad;
    hi += pad;
    const mapX = (x: number): number => r.x + (x / xMax) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - lo) / (hi - lo)) * r.h;

    drawFrame(g, r, zh ? '水头线：HGL 与 EGL（理想流 EGL 为常数）' : 'Head lines: HGL and EGL (EGL constant for ideal flow)', 'x (m)', 'head (m)', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.textAlign = 'center';
    for (const x of linTicks(0, xMax, 6)) {
      const px = mapX(x);
      g.beginPath();
      g.moveTo(px, r.y);
      g.lineTo(px, r.y + r.h);
      g.stroke();
      if (showX) {
        g.fillStyle = COL.dim;
        g.fillText(fmtTick(x), px, r.y + r.h + 13);
      }
    }
    g.textAlign = 'right';
    for (const v of linTicks(lo, hi, 4)) {
      const y = mapY(v);
      g.strokeStyle = COL.grid;
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.dim;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // HGL p/(ρg).
    g.strokeStyle = COL.teal;
    g.lineWidth = 2;
    g.beginPath();
    st.forEach((s, i) => (i === 0 ? g.moveTo(mapX(s.x), mapY(s.hgl)) : g.lineTo(mapX(s.x), mapY(s.hgl))));
    g.stroke();
    // EGL (constant).
    g.strokeStyle = COL.amber;
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(r.x, mapY(st[0]!.egl));
    g.lineTo(r.x + r.w, mapY(st[0]!.egl));
    g.stroke();
    g.setLineDash([]);
    g.restore();

    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(zh ? 'HGL = p/(ρg)' : 'HGL = p/(ρg)', r.x + r.w - 110, mapY(st[0]!.hgl) - 6);
    g.fillText('EGL', r.x + r.w - 40, mapY(st[0]!.egl) - 6);
  }

  /** Boundary-layer thickness growth δ(x), δ*(x), θ(x). */
  private drawBlGrowth(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const p = this.products as { mode: 'bl'; data: BlProducts };
    const zh = this.zh;
    const b = p.data;
    const xMax = b.xs[b.xs.length - 1]!;
    const yMax = Math.max(...b.delta) * 1.12;
    const mapX = (x: number): number => r.x + (x / xMax) * r.w;
    const mapY = (v: number): number => r.y + r.h - (v / yMax) * r.h;

    drawFrame(g, r, zh ? '边界层厚度增长（Blasius 打靶解）' : 'Boundary-layer growth (Blasius shooting)', 'x (m)', 'δ, δ*, θ (m)', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.textAlign = 'center';
    for (const x of linTicks(0, xMax, 5)) {
      const px = mapX(x);
      g.beginPath();
      g.moveTo(px, r.y);
      g.lineTo(px, r.y + r.h);
      g.stroke();
      if (showX) {
        g.fillStyle = COL.dim;
        g.fillText(fmtTick(x), px, r.y + r.h + 13);
      }
    }
    g.textAlign = 'right';
    for (const v of linTicks(0, yMax, 4)) {
      const y = mapY(v);
      g.strokeStyle = COL.grid;
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.dim;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
    const line = (ys: number[], style: string, dash: number[]): void => {
      g.strokeStyle = style;
      g.setLineDash(dash);
      g.lineWidth = 2;
      g.beginPath();
      ys.forEach((v, i) => (i === 0 ? g.moveTo(mapX(b.xs[i]!), mapY(v)) : g.lineTo(mapX(b.xs[i]!), mapY(v))));
      g.stroke();
      g.setLineDash([]);
    };
    line(b.delta, COL.blue, []);
    line(b.deltaStar, COL.teal, [4, 3]);
    line(b.theta, COL.amber, [2, 3]);
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText('δ99', r.x + r.w - 96, mapY(b.delta[b.delta.length - 1]!) - 4);
    g.fillText('δ*', r.x + r.w - 40, mapY(b.deltaStar[b.deltaStar.length - 1]!) - 4);
    g.fillText('θ', r.x + r.w - 20, mapY(b.theta[b.theta.length - 1]!) - 4);
  }

  /** Local skin-friction coefficient cf(x) = 2f''(0)/√Rex. */
  private drawBlCf(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const p = this.products as { mode: 'bl'; data: BlProducts };
    const zh = this.zh;
    const b = p.data;
    const xMax = b.xs[b.xs.length - 1]!;
    const cfMax = Math.max(...b.cf) * 1.15;
    const mapX = (x: number): number => r.x + (x / xMax) * r.w;
    const mapY = (v: number): number => r.y + r.h - (v / cfMax) * r.h;
    drawFrame(g, r, zh ? '局部摩擦系数 cf = 2f″(0)/√Rex' : 'Local skin friction cf = 2f″(0)/√Rex', 'x (m)', 'cf', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.textAlign = 'right';
    for (const v of linTicks(0, cfMax, 3)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.dim;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
    g.strokeStyle = COL.orange;
    g.lineWidth = 2;
    g.beginPath();
    b.cf.forEach((v, i) => (i === 0 ? g.moveTo(mapX(b.xs[i]!), mapY(v)) : g.lineTo(mapX(b.xs[i]!), mapY(v))));
    g.stroke();
    if (showX) {
      g.textAlign = 'center';
      g.fillStyle = COL.dim;
      for (const x of linTicks(0, xMax, 5)) g.fillText(fmtTick(x), mapX(x), r.y + r.h + 13);
    }
  }

  /** Similarity profiles: Blasius f'(η) and Pohlhausen u/U(η; λ) + separation. */
  private drawBlProfiles(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const p = this.products as { mode: 'bl'; data: BlProducts };
    const zh = this.zh;
    const b = p.data;
    const etaMax = b.eta[b.eta.length - 1]!;
    const uMax = Math.max(1.2, ...b.pohlhausenProfile.filter((v) => Number.isFinite(v))) * 1.08;
    const mapX = (u: number): number => r.x + (Math.max(-0.2, u) + 0.2) / (uMax + 0.2) * r.w;
    const mapY = (eta: number): number => r.y + r.h - (eta / etaMax) * r.h;
    const lam = b.lambda;
    drawFrame(
      g,
      r,
      b.pohl.separated
        ? zh ? `相似速度剖面 — λ = ${fmtMetric(lam, 3)}：已分离` : `Similarity profiles — λ = ${fmtMetric(lam, 3)}: separated`
        : zh ? `相似速度剖面 — λ = ${fmtMetric(lam, 3)}（逆压梯度指示）` : `Similarity profiles — λ = ${fmtMetric(lam, 3)} (adverse-gradient indicator)`,
      'u/U',
      'η',
      showX,
      zh,
    );
    // Axes: u = 0 and u = 1 reference lines.
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mapX(0), r.y);
    g.lineTo(mapX(0), r.y + r.h);
    g.stroke();
    g.setLineDash([3, 3]);
    g.strokeStyle = COL.grey;
    g.beginPath();
    g.moveTo(mapX(1), r.y);
    g.lineTo(mapX(1), r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    // Profiles.
    const line = (us: number[], style: string, dash: number[]): void => {
      g.strokeStyle = style;
      g.setLineDash(dash);
      g.lineWidth = 2;
      g.beginPath();
      us.forEach((u, i) => (i === 0 ? g.moveTo(mapX(u), mapY(b.eta[i]!)) : g.lineTo(mapX(u), mapY(b.eta[i]!))));
      g.stroke();
      g.setLineDash([]);
    };
    line(b.blasiusProfile, COL.blue, []);
    line(b.pohlhausenProfile, COL.teal, [4, 3]);
    // Separation / adverse-gradient annotation.
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    if (b.pohl.separated) {
      g.fillStyle = COL.red;
      g.fillText(zh ? '壁面剪切 ≤ 0（λ ≤ −12）：分离' : 'wall shear ≤ 0 (λ ≤ −12): separated', r.x + 8, r.y + r.h - 8);
    } else {
      g.fillStyle = COL.dim;
      g.fillText(
        zh ? `壁面剪切 2+λ/6 = ${fmtMetric(b.pohl.wallShear, 4)} · H = ${fmtMetric(b.pohl.H, 4)}` : `wall shear 2+λ/6 = ${fmtMetric(b.pohl.wallShear, 4)} · H = ${fmtMetric(b.pohl.H, 4)}`,
        r.x + 8,
        r.y + r.h - 8,
      );
    }
    // Inflection-point hint for adverse gradients (qualitative).
    if (lam < 0 && !b.pohl.separated) {
      g.fillStyle = COL.amber;
      g.fillText(zh ? '剖面出现拐点（不稳定趋势）' : 'inflectional profile (instability trend)', r.x + 8, r.y + 16);
    }
  }

  // ---- 3-D streamline viewer (simple perspective projection, dependency-free) ----

  /** Perspective projection of an a-normalized world point. */
  private project(x: number, y: number, z: number, scale: number, cx: number, cy: number): [number, number] {
    const YAW = 0.52;
    const PITCH = 0.42;
    const DIST = 7;
    const x1 = x * Math.cos(YAW) - y * Math.sin(YAW);
    const y1 = x * Math.sin(YAW) + y * Math.cos(YAW);
    const z1 = z;
    const y2 = y1 * Math.cos(PITCH) - z1 * Math.sin(PITCH);
    const z2 = y1 * Math.sin(PITCH) + z1 * Math.cos(PITCH);
    const s = DIST / (DIST - z2);
    return [cx + x1 * scale * s, cy - y2 * scale * s];
  }

  /** Muted speed→colour ramp for streamlines (low saturation). */
  private speedColor(t: number): string {
    const c = clamp(t, 0, 1);
    const lo = [96, 132, 168];
    const hi = [112, 205, 185];
    const r = Math.round(lo[0]! + c * (hi[0]! - lo[0]!));
    const gg = Math.round(lo[1]! + c * (hi[1]! - lo[1]!));
    const b = Math.round(lo[2]! + c * (hi[2]! - lo[2]!));
    return `rgba(${r},${gg},${b},0.9)`;
  }

  /** Streamline view: body outline, axes, streamlines, stagnation markers. */
  private drawStream(g: CanvasRenderingContext2D, r: Rect) {
    const p = this.products as { mode: 'stream'; data: StreamProducts };
    const zh = this.zh;
    const s = this.state;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const scale = Math.min(r.w, r.h) / 7.2;

    drawFrame(g, r, zh ? '势流绕流流线（透视投影，Γ 仅作用于圆柱）' : 'Potential-flow streamlines (perspective, Γ acts on the cylinder only)', 'x', '', false, zh);

    // Faint axes.
    g.strokeStyle = COL.gridMinor;
    g.lineWidth = 1;
    for (const [a, b2] of [
      [[-3, 0, 0], [3, 0, 0]],
      [[0, -2.4, 0], [0, 2.4, 0]],
      [[0, 0, -2.4], [0, 0, 2.4]],
    ] as Array<[[number, number, number], [number, number, number]]>) {
      const [ax, ay] = this.project(a[0], a[1], a[2], scale, cx, cy);
      const [bx, by] = this.project(b2[0], b2[1], b2[2], scale, cx, cy);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
    }
    g.fillStyle = COL.dim;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    const [lx, ly] = this.project(3.15, 0, 0, scale, cx, cy);
    g.fillText('x', lx, ly + 3);

    // Body outline.
    if (s.body === 'sphere') {
      const [ox, oy] = this.project(0, 0, 0, scale, cx, cy);
      g.strokeStyle = COL.wall;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(ox, oy, s.radius * scale, 0, Math.PI * 2);
      g.stroke();
      // Equator hint (front half of the x-z great circle).
      g.strokeStyle = 'rgba(140,160,185,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 60; i += 1) {
        const th = Math.PI * (i / 60);
        const [ex, ey] = this.project(s.radius * Math.cos(th), 0, s.radius * Math.sin(th), scale, cx, cy);
        if (i === 0) g.moveTo(ex, ey);
        else g.lineTo(ex, ey);
      }
      g.stroke();
    } else {
      // Cylinder along z ∈ [−1.5, 1.5]: two end rims + silhouette lines.
      for (const z of [-1.5, 1.5]) {
        g.strokeStyle = COL.wall;
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i <= 60; i += 1) {
          const th = (2 * Math.PI * i) / 60;
          const [ex, ey] = this.project(s.radius * Math.cos(th), s.radius * Math.sin(th), z, scale, cx, cy);
          if (i === 0) g.moveTo(ex, ey);
          else g.lineTo(ex, ey);
        }
        g.stroke();
      }
      g.strokeStyle = 'rgba(140,160,185,0.35)';
      g.lineWidth = 1;
      for (const th of [Math.PI / 2, -Math.PI / 2]) {
        const [ax, ay] = this.project(s.radius * Math.cos(th), s.radius * Math.sin(th), -1.5, scale, cx, cy);
        const [bx, by] = this.project(s.radius * Math.cos(th), s.radius * Math.sin(th), 1.5, scale, cx, cy);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }

    // Streamlines coloured by local speed.
    g.lineWidth = 1.5;
    for (const line of p.data.streamlines) {
      for (let i = 1; i < line.pts.length; i += 1) {
        const [ax, ay] = this.project(line.pts[i - 1]![0], line.pts[i - 1]![1], line.pts[i - 1]![2], scale, cx, cy);
        const [bx, by] = this.project(line.pts[i]![0], line.pts[i]![1], line.pts[i]![2], scale, cx, cy);
        g.strokeStyle = this.speedColor(line.speed[i]! / 1.5);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      // Arrowhead every ~40 samples.
      for (let i = 40; i < line.pts.length; i += 40) {
        const [ax, ay] = this.project(line.pts[i - 1]![0], line.pts[i - 1]![1], line.pts[i - 1]![2], scale, cx, cy);
        const [bx, by] = this.project(line.pts[i]![0], line.pts[i]![1], line.pts[i]![2], scale, cx, cy);
        const dx = bx - ax;
        const dy = by - ay;
        const m = Math.hypot(dx, dy);
        if (m < 1e-6) continue;
        const ux = dx / m;
        const uy = dy / m;
        g.fillStyle = this.speedColor(line.speed[i]! / 1.5);
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx - ux * 7 - uy * 3, by - uy * 7 + ux * 3);
        g.lineTo(bx - ux * 7 + uy * 3, by - uy * 7 - ux * 3);
        g.closePath();
        g.fill();
      }
    }

    // Stagnation markers.
    g.fillStyle = COL.red;
    const marks: Array<[number, number, number]> = [];
    if (s.body === 'sphere') {
      marks.push([s.radius, 0, 0], [-s.radius, 0, 0]);
    } else {
      const st = p.data.aero.stagnation;
      if (st) {
        for (const th of st) marks.push([s.radius * Math.cos(th), s.radius * Math.sin(th), 0]);
      }
    }
    for (const m of marks) {
      const [mx, my] = this.project(m[0], m[1], m[2], scale, cx, cy);
      g.beginPath();
      g.arc(mx, my, 3.2, 0, Math.PI * 2);
      g.fill();
    }

    // Legend / annotations.
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const gammaStar = s.gamma / (s.uFree * s.radius);
    g.fillText(`${zh ? '物体' : 'body'}: ${s.body === 'sphere' ? (zh ? '圆球（势流偶极子）' : 'sphere (potential doublet)') : zh ? '圆柱（+ 环量）' : 'cylinder (+ circulation)'}`, r.x + 8, r.y + 16);
    g.fillText(`Γ* = Γ/(U·a) = ${fmtMetric(gammaStar, 4)} · Cl = Γ* = ${fmtMetric(p.data.aero.cl, 4)}`, r.x + 8, r.y + 30);
    if (s.body === 'cylinder' && !p.data.aero.stagnation) {
      g.fillStyle = COL.amber;
      g.fillText(zh ? '|Γ| ≥ 4πUa：驻点脱离表面' : '|Γ| ≥ 4πUa: stagnation points detached', r.x + 8, r.y + 44);
    }
    // Colour legend.
    const lgx = r.x + r.w - 130;
    const lgy = r.y + r.h - 16;
    for (let i = 0; i <= 60; i += 1) {
      g.strokeStyle = this.speedColor(i / 60);
      g.beginPath();
      g.moveTo(lgx + (i / 60) * 90, lgy);
      g.lineTo(lgx + (i / 60) * 90 + 1.6, lgy);
      g.stroke();
    }
    g.fillStyle = COL.dim;
    g.fillText(zh ? '慢' : 'slow', lgx - 22, lgy + 3);
    g.fillText(zh ? '快 1.5U' : 'fast 1.5U', lgx + 96, lgy + 3);
  }

  /** Footer: mode-specific one-line result summary. */
  private drawFooter(g: CanvasRenderingContext2D, h: number) {
    const zh = this.zh;
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    let line = '';
    const p = this.products;
    if (!p) return;
    if (p.mode === 'pipe') {
      const r = p.data.res;
      const regZh = r.regime === 'laminar' ? '层流' : r.regime === 'transitional' ? '过渡流' : '湍流';
      line = `Re = ${fmtMetric(r.re)} · ${zh ? regZh : r.regime} · f = ${fmtMetric(r.f)} · h_f = ${fmtMetric(r.hf)} m · Δp = ${fmtMetric(r.dp)} Pa`;
    } else if (p.mode === 'bernoulli') {
      const st = p.data.stations;
      const c = p.data.conservation;
      line = `Q = ${fmtMetric((Math.PI * p.data.params.d1 * p.data.params.d1) / 4 * p.data.params.v1, 5)} m³/s · v_max = ${fmtMetric(Math.max(...st.map((s) => s.v)))} m/s · p_min = ${fmtMetric(Math.min(...st.map((s) => s.p)))} Pa · ${zh ? '连续性残差' : 'continuity err'} ${c.continuityErr.toExponential(1)}`;
    } else if (p.mode === 'bl') {
      const b = p.data;
      const xEnd = b.xs[b.xs.length - 1]!;
      const reXEnd = (b.uInf * xEnd) / b.nu;
      line = `Rex(L) = ${fmtMetric(reXEnd)} · δ(L) = ${fmtMetric(b.delta[b.delta.length - 1]!)} m · cf(L) = ${fmtMetric(b.cf[b.cf.length - 1]!)} · H_Pohl = ${fmtMetric(b.pohl.H, 4)}${b.pohl.separated ? (zh ? ' · 已分离' : ' · separated') : ''}`;
    } else {
      const a = p.data.aero;
      line = `Re = ${fmtMetric(a.re)} · Cd_potential = 0 · Cd_Stokes = ${fmtMetric(a.cdStokes)}${Number.isFinite(a.cdSchillerNaumann) ? ` · Cd_SN = ${fmtMetric(a.cdSchillerNaumann)}` : ''} · Cl = ${fmtMetric(a.cl)}`;
    }
    g.fillText(line, 16, h - 12);
  }
}

/** DataTable builder for one or more pipe-flow results. */
function pipeResultTable(results: PipeResult[]): DataTable {
  return createDataTable('eng-fluid-pipe', [
    { name: 're', type: 'f64', data: Float64Array.from(results.map((r) => r.re)) },
    { name: 'f', type: 'f64', data: Float64Array.from(results.map((r) => r.f)) },
    { name: 'regime', type: 'string', data: results.map((r) => r.regime) },
    { name: 'eps_over_d', type: 'f64', data: Float64Array.from(results.map((r) => r.epsOverD)) },
    { name: 'hf', type: 'f64', data: Float64Array.from(results.map((r) => r.hf)), unit: 'm' },
    { name: 'dp', type: 'f64', data: Float64Array.from(results.map((r) => r.dp)), unit: 'Pa' },
  ], { tags: ['fluid', 'pipe'], provenance: 'eng-fluid pipeFlow' });
}

export default function createEngFluidPlugin(): Plugin {
  return new EngFluidPlugin();
}
