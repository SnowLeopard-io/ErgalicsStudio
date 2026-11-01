// ==========================================================================
// eng-vibration — structural vibration analysis laboratory
//
// Live workbench with five modes:
//   sdof        free decay (RK4 vs the exact closed form) + analytic
//               amplitude/phase response with half-power identification
//   mdof        spring chain / simply supported beam eigenanalysis (generalized
//               Jacobi), mode shapes + drive-point FRF via modal superposition
//   frf         frequency-response sweep in dB + phase (SDOF receptance, MDOF
//               first-mode drive point, or an imported w/mag sweep)
//   isolation   transmissibility T(r) family curves, sqrt(2) boundary, peak
//               and isolation efficiency at the operating ratio r0
//   unbalance   rotating-unbalance amplitude mX/(me*e) and phase (exact
//               1/(2*zeta) peak, exact 90 deg resonance lag) + shaft orbit
//
// Parameter edits recompute and redraw immediately; "Simulate" publishes the
// scientific outputs (fn, zeta, Q, transmissibility peak, isolation efficiency,
// resonance amplitudes ...) with analytic cross-references. compute() accepts
// CSV/JSON for the Block/Flow runtimes: a parameter table with columns
// m,k[,c] (one row = SDOF, several rows = MDOF chain) or a frequency sweep
// (w/frequency + amp/magnitude[, phase]) for half-power identification.
// No emoji, academic muted palette, bilingual UI strings.
// ==========================================================================

import type { ComputeResult, ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { emit } from '@/core/events';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
} from '@/core/research/scienceOutput';
import { engVibrationManifest } from './manifest';
import {
  type DecaySim,
  type FrfSweep,
  type HalfPowerId,
  type MdofFrf,
  type MdofModel,
  type MdofModes,
  type SdofDerived,
  type SdofParams,
  VibrationError,
  beamContinuousOmega,
  beamDiscreteOmega,
  buildBeam,
  buildChain,
  chainAnalyticOmega,
  halfPowerIdentify,
  logspace,
  mdofDriveFrf,
  rayleighAlphaBeta,
  rayleighModalZeta,
  sdofDerived,
  sdofFreeDecayRk4,
  sdofFrf,
  transmissibility,
  transmissibilityPeak,
  transmissibilitySweep,
  unbalanceOrbit,
  unbalancePoint,
  unbalanceSweep,
} from './kernel';

export { engVibrationManifest };

type VibMode = 'sdof' | 'mdof' | 'frf' | 'isolation' | 'unbalance';

interface State {
  mode: VibMode;
  // SDOF (also the SDOF source of the FRF mode)
  m: number;
  k: number;
  c: number;
  x0: number;
  v0: number;
  tEnd: number;
  F0: number;
  // MDOF
  system: 'chain' | 'beam';
  chainN: number;
  chainM: number;
  chainK: number;
  beamEI: number;
  beamRhoA: number;
  beamL: number;
  beamN: number;
  zetaM: number;
  // FRF
  frfSource: 'sdof' | 'mdof';
  // isolation
  zetaIso: number;
  r0: number;
  // unbalance
  zetaU: number;
  rOp: number;
  kappa: number;
}

interface SdofResults {
  p: SdofParams;
  derived: SdofDerived;
  decay: DecaySim;
  sweep: FrfSweep;
  id: HalfPowerId;
  /** Static deflection F0/k (m). */
  xSt: number;
  /** Resonance amplitude X_st/(2*zeta*sqrt(1-zeta^2)) (m); Infinity for zeta >= 1. */
  xRes: number;
}

interface MdofResults {
  model: MdofModel;
  modes: MdofModes;
  zetas: number[];
  /** Number of displayed modes (<= 3). */
  nShow: number;
  driveDof: number;
  frf: MdofFrf;
  /** Analytic reference spectrum (uniform chain closed form / beam discrete closed form). */
  refOmega: number[] | null;
  /** Continuous beam theory spectrum (beam only). */
  refCont: number[] | null;
  label: string;
}

interface FrfResults {
  w: number[];
  magDb: number[];
  phaseLagDeg: number[] | null;
  id: HalfPowerId;
  imported: boolean;
  label: string;
  /** True values for cross-reference when the sweep comes from the built-in SDOF/MDOF. */
  trueWn: number | null;
  trueZeta: number | null;
}

interface IsoResults {
  r: number[];
  zetaList: number[];
  curves: number[][];
  hi: { r: number[]; T: number[] };
  peak: { rPeak: number; tMax: number };
  /** Transmissibility at the operating ratio r0. */
  t0: number;
  /** |T(sqrt(2)) - 1| — zero for every zeta (algebraic identity). */
  sqrt2Check: number;
}

interface UnbResults {
  r: number[];
  ampNorm: number[];
  phaseLagDeg: number[];
  /** Exact peak 1/(2*zeta). */
  peakExact: number;
  /** Numeric peak from a dense scan of r in [0.5, 1.5]. */
  peakNum: number;
  peakR: number;
  phaseAt1: number;
  orbit: { x: number[]; y: number[] };
  orbitMax: number;
}

interface ImportedChain {
  masses: number[];
  springs: number[];
  dampings: number[] | null;
}

interface ImportedSweep {
  w: number[];
  magDb: number[];
  phaseLagDeg: number[] | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Academic muted palette (low saturation, no emoji anywhere).
const COL = {
  main: 'rgba(96,156,204,0.95)',
  ref: 'rgba(198,146,104,0.92)',
  green: 'rgba(108,166,138,0.92)',
  purple: 'rgba(148,132,180,0.9)',
  grey: 'rgba(168,180,198,0.8)',
  grid: 'rgba(255,255,255,0.06)',
  frame: 'rgba(120,140,165,0.55)',
  text: 'rgba(160,175,195,0.9)',
  bright: 'rgba(226,234,244,0.95)',
  marker: 'rgba(226,198,124,0.95)',
  warn: 'rgba(224,150,140,0.95)',
};

const FAMILY_COLORS = [
  'rgba(96,156,204,0.5)',
  'rgba(108,166,138,0.5)',
  'rgba(198,146,104,0.55)',
  'rgba(148,132,180,0.5)',
  'rgba(170,180,196,0.45)',
];

const ISO_ZETAS = [0.02, 0.05, 0.1, 0.2, 0.4];

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
function drawFrame(
  g: CanvasRenderingContext2D,
  r: Rect,
  title: string,
  xLabel: string,
  yLabel: string,
  showX: boolean,
  zh: boolean,
): void {
  g.strokeStyle = COL.frame;
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = COL.bright;
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  if (showX) {
    g.fillStyle = COL.text;
    g.textAlign = 'right';
    g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  }
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = COL.text;
  g.fillText(yLabel, 0, 0);
  g.restore();
}

// ---- CSV / JSON table parsing (Block/Flow entry) -----------------------------

interface ParsedTable {
  header: string[];
  rows: number[][];
}

function parseCsvTable(text: string): ParsedTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new VibrationError('CSV needs a header row and at least one data row');
  const header = lines[0]!
    .split(',')
    .map((h) => h.trim().toLowerCase());
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i]!.split(',').map((c) => c.trim());
    if (cells.length < header.length) continue;
    const row = header.map((_, j) => Number(cells[j]));
    if (row.some((v) => !Number.isFinite(v))) throw new VibrationError(`non-numeric cell in CSV row ${i + 1}`);
    rows.push(row);
  }
  if (rows.length === 0) throw new VibrationError('CSV has no data rows');
  return { header, rows };
}

function parseTableInput(input: unknown): ParsedTable {
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) return parseTableInput(JSON.parse(t) as unknown);
    return parseCsvTable(t);
  }
  if (Array.isArray(input)) {
    if (input.length === 0) throw new VibrationError('empty input array');
    const first = input[0] as unknown;
    if (Array.isArray(first)) {
      const rows = (input as unknown[]).map((r) => (r as unknown[]).map((v) => Number(v)));
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new VibrationError('non-numeric cell in row array');
      return { header: rows[0]!.map((_, i) => `col${i + 1}`), rows };
    }
    if (typeof first === 'object' && first !== null) {
      const keys: string[] = [];
      for (const o of input as Record<string, unknown>[]) {
        for (const key of Object.keys(o)) if (!keys.includes(key)) keys.push(key);
      }
      const rows = (input as Record<string, unknown>[]).map((o) => keys.map((k) => Number(o[k])));
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new VibrationError('non-numeric cell in object array');
      return { header: keys.map((k) => k.toLowerCase()), rows };
    }
    throw new VibrationError('unsupported array input');
  }
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.csv === 'string') return parseCsvTable(o.csv);
    if (Array.isArray(o.header) && Array.isArray(o.rows)) {
      const header = (o.header as unknown[]).map((h) => String(h).toLowerCase());
      const rows = (o.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((v) => Number(v)) : []));
      if (rows.some((r) => r.length !== header.length || r.some((v) => !Number.isFinite(v)))) {
        throw new VibrationError('rows must be numeric arrays matching the header length');
      }
      return { header, rows };
    }
    if (Array.isArray(o.columns) && o.columns.length > 0 && typeof o.columns[0] === 'object') {
      const cols = o.columns as Array<{ name?: unknown; values?: unknown }>;
      const header = cols.map((c, i) => String(c?.name ?? `col${i + 1}`).toLowerCase());
      const len = Array.isArray(cols[0]?.values) ? (cols[0]!.values as unknown[]).length : 0;
      if (len === 0) throw new VibrationError('column values must be non-empty numeric arrays');
      const rows: number[][] = [];
      for (let i = 0; i < len; i += 1) {
        rows.push(cols.map((c) => Number((c.values as unknown[])[i])));
      }
      if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) throw new VibrationError('non-numeric column value');
      return { header, rows };
    }
    if (Array.isArray(o.w) && Array.isArray(o.magDb)) {
      const w = (o.w as unknown[]).map(Number);
      const magDb = (o.magDb as unknown[]).map(Number);
      if (w.length !== magDb.length || w.length === 0) throw new VibrationError('w and magDb must be equal-length arrays');
      const rows = w.map((wi, i) => [wi, magDb[i]!]);
      return { header: ['w', 'mag_db'], rows };
    }
    if (Array.isArray(o.frequency) && Array.isArray(o.amplitude)) {
      const w = (o.frequency as unknown[]).map(Number);
      const amp = (o.amplitude as unknown[]).map(Number);
      if (w.length !== amp.length || w.length === 0) throw new VibrationError('frequency and amplitude must be equal-length arrays');
      const rows = w.map((wi, i) => [wi, amp[i]!]);
      return { header: ['frequency', 'amplitude'], rows };
    }
    if (typeof o.m === 'number' && typeof o.k === 'number') {
      const row = typeof o.c === 'number' ? [o.m, o.k, o.c] : [o.m, o.k];
      return { header: row.length === 3 ? ['m', 'k', 'c'] : ['m', 'k'], rows: [row] };
    }
  }
  throw new VibrationError(
    'unsupported input: expected CSV/JSON with columns m,k[,c] (SDOF row / MDOF chain) or w+amp/mag[, phase] (frequency sweep)',
  );
}

// ==========================================================================

export class EngVibrationPlugin implements Plugin {
  readonly manifest = engVibrationManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'sdof',
    m: 1,
    k: 400,
    c: 2,
    x0: 0.001,
    v0: 0.05,
    tEnd: 12,
    F0: 10,
    system: 'chain',
    chainN: 3,
    chainM: 1,
    chainK: 100,
    beamEI: 10000,
    beamRhoA: 200,
    beamL: 6,
    beamN: 60,
    zetaM: 0.03,
    frfSource: 'sdof',
    zetaIso: 0.08,
    r0: 3,
    zetaU: 0.06,
    rOp: 1,
    kappa: 1,
  };
  private importedChain: ImportedChain | null = null;
  private importedSweep: ImportedSweep | null = null;
  private sdofRes: SdofResults | null = null;
  private mdofRes: MdofResults | null = null;
  private frfRes: FrfResults | null = null;
  private isoRes: IsoResults | null = null;
  private unbRes: UnbResults | null = null;
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

  // ---- params ---------------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const inMode = (...modes: VibMode[]) => ({ key: 'mode', in: modes as ReadonlyArray<string> });
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '分析模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          {
            value: 'sdof',
            label: 'SDOF (m-k-c)',
            labelI18n: { 'zh-CN': '单自由度（m-k-c）', 'en-US': 'SDOF (m-k-c)' },
          },
          {
            value: 'mdof',
            label: 'MDOF chain / beam',
            labelI18n: { 'zh-CN': '多自由度链 / 梁', 'en-US': 'MDOF chain / beam' },
          },
          {
            value: 'frf',
            label: 'FRF sweep',
            labelI18n: { 'zh-CN': '频响扫频', 'en-US': 'FRF sweep' },
          },
          {
            value: 'isolation',
            label: 'Isolation T(r)',
            labelI18n: { 'zh-CN': '隔振传递率', 'en-US': 'Isolation T(r)' },
          },
          {
            value: 'unbalance',
            label: 'Unbalance',
            labelI18n: { 'zh-CN': '不平衡激励', 'en-US': 'Unbalance' },
          },
        ],
        value: s.mode,
      },
      {
        key: 'm',
        label: 'm (kg)',
        labelI18n: { 'zh-CN': '质量 m (kg)', 'en-US': 'Mass m (kg)' },
        type: 'range',
        min: 0.05,
        max: 100,
        step: 0.05,
        value: s.m,
        hint: this.zh ? 'SDOF 质量（频响模式下为 SDOF 源质量）' : 'SDOF mass (FRF SDOF source mass)',
        visibleWhen: inMode('sdof', 'frf'),
      },
      {
        key: 'k',
        label: 'k (N/m)',
        labelI18n: { 'zh-CN': '刚度 k (N/m)', 'en-US': 'Stiffness k (N/m)' },
        type: 'range',
        min: 1,
        max: 100000,
        step: 1,
        value: s.k,
        visibleWhen: inMode('sdof', 'frf'),
      },
      {
        key: 'c',
        label: 'c (N·s/m)',
        labelI18n: { 'zh-CN': '阻尼 c (N·s/m)', 'en-US': 'Damping c (N·s/m)' },
        type: 'range',
        min: 0,
        max: 5000,
        step: 0.1,
        value: s.c,
        hint: this.zh ? 'ζ = c/(2√(km))' : 'zeta = c/(2*sqrt(k*m))',
        visibleWhen: inMode('sdof', 'frf'),
      },
      {
        key: 'x0',
        label: 'x0 (m)',
        labelI18n: { 'zh-CN': '初始位移 x0 (m)', 'en-US': 'Initial displacement x0 (m)' },
        type: 'range',
        min: 0,
        max: 0.05,
        step: 0.0005,
        value: s.x0,
        visibleWhen: inMode('sdof'),
      },
      {
        key: 'v0',
        label: 'v0 (m/s)',
        labelI18n: { 'zh-CN': '初速度 v0 (m/s)', 'en-US': 'Initial velocity v0 (m/s)' },
        type: 'range',
        min: -1,
        max: 1,
        step: 0.01,
        value: s.v0,
        visibleWhen: inMode('sdof'),
      },
      {
        key: 'tEnd',
        label: 't_end (s)',
        labelI18n: { 'zh-CN': '时长 t_end (s)', 'en-US': 'Horizon t_end (s)' },
        type: 'range',
        min: 1,
        max: 60,
        step: 1,
        value: s.tEnd,
        visibleWhen: inMode('sdof'),
      },
      {
        key: 'F0',
        label: 'F0 (N)',
        labelI18n: { 'zh-CN': '力幅 F0 (N)', 'en-US': 'Force amplitude F0 (N)' },
        type: 'range',
        min: 0.1,
        max: 1000,
        step: 0.1,
        value: s.F0,
        hint: this.zh ? '静变形 X_st = F0/k' : 'static deflection X_st = F0/k',
        visibleWhen: inMode('sdof'),
      },
      {
        key: 'system',
        label: 'System',
        labelI18n: { 'zh-CN': '系统', 'en-US': 'System' },
        type: 'select',
        options: [
          {
            value: 'chain',
            label: 'Spring chain (fixed-fixed)',
            labelI18n: { 'zh-CN': '弹簧链（两端固支）', 'en-US': 'Spring chain (fixed-fixed)' },
          },
          {
            value: 'beam',
            label: 'Simply supported beam',
            labelI18n: { 'zh-CN': '简支梁', 'en-US': 'Simply supported beam' },
          },
        ],
        value: s.system,
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'chainN',
        label: 'N (DOFs)',
        labelI18n: { 'zh-CN': '自由度数 N', 'en-US': 'DOFs N' },
        type: 'range',
        min: 2,
        max: 12,
        step: 1,
        value: s.chainN,
        hint: this.zh ? '链参数仅当「系统 = 弹簧链」时生效' : 'chain knobs apply when System = chain',
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'chainM',
        label: 'm (kg)',
        labelI18n: { 'zh-CN': '质量 m (kg)', 'en-US': 'Mass m (kg)' },
        type: 'range',
        min: 0.05,
        max: 10,
        step: 0.05,
        value: s.chainM,
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'chainK',
        label: 'k (N/m)',
        labelI18n: { 'zh-CN': '刚度 k (N/m)', 'en-US': 'Stiffness k (N/m)' },
        type: 'range',
        min: 1,
        max: 10000,
        step: 1,
        value: s.chainK,
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'beamEI',
        label: 'EI (N·m²)',
        labelI18n: { 'zh-CN': '抗弯刚度 EI (N·m²)', 'en-US': 'Bending stiffness EI (N·m²)' },
        type: 'range',
        min: 100,
        max: 200000,
        step: 100,
        value: s.beamEI,
        hint: this.zh ? '梁参数仅当「系统 = 简支梁」时生效' : 'beam knobs apply when System = beam',
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'beamRhoA',
        label: 'ρA (kg/m)',
        labelI18n: { 'zh-CN': '线密度 ρA (kg/m)', 'en-US': 'Mass per length rhoA (kg/m)' },
        type: 'range',
        min: 1,
        max: 2000,
        step: 1,
        value: s.beamRhoA,
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'beamL',
        label: 'L (m)',
        labelI18n: { 'zh-CN': '跨长 L (m)', 'en-US': 'Span L (m)' },
        type: 'range',
        min: 1,
        max: 20,
        step: 0.5,
        value: s.beamL,
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'beamN',
        label: 'Nodes',
        labelI18n: { 'zh-CN': '集中节点数', 'en-US': 'Lumped nodes' },
        type: 'range',
        min: 8,
        max: 80,
        step: 2,
        value: s.beamN,
        hint: this.zh ? '集中质量/集中刚度离散节点数' : 'lumped-mass / concentrated-stiffness nodes',
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'zetaM',
        label: 'ζ target',
        labelI18n: { 'zh-CN': '目标模态阻尼 ζ', 'en-US': 'Target modal zeta' },
        type: 'range',
        min: 0,
        max: 0.2,
        step: 0.005,
        value: s.zetaM,
        hint: this.zh ? 'Rayleigh 阻尼在 ω1 与 ω3 处取该值' : 'Rayleigh damping pinned at w1 and w3',
        visibleWhen: inMode('mdof'),
      },
      {
        key: 'frfSource',
        label: 'FRF source',
        labelI18n: { 'zh-CN': '频响来源', 'en-US': 'FRF source' },
        type: 'select',
        options: [
          {
            value: 'sdof',
            label: 'SDOF receptance',
            labelI18n: { 'zh-CN': '单自由度导纳', 'en-US': 'SDOF receptance' },
          },
          {
            value: 'mdof',
            label: 'MDOF first mode (drive point)',
            labelI18n: { 'zh-CN': '多自由度首阶模态（驱动点）', 'en-US': 'MDOF first mode (drive point)' },
          },
        ],
        value: s.frfSource,
        hint: this.zh ? '导入的扫频数据优先于此选择' : 'an imported sweep takes precedence',
        visibleWhen: inMode('frf'),
      },
      {
        key: 'zetaIso',
        label: 'ζ (highlight)',
        labelI18n: { 'zh-CN': '阻尼比 ζ（高亮）', 'en-US': 'Damping ratio zeta (highlight)' },
        type: 'range',
        min: 0.01,
        max: 0.5,
        step: 0.005,
        value: s.zetaIso,
        visibleWhen: inMode('isolation'),
      },
      {
        key: 'r0',
        label: 'r0 (operating)',
        labelI18n: { 'zh-CN': '运行频率比 r0', 'en-US': 'Operating ratio r0' },
        type: 'range',
        min: 0.1,
        max: 10,
        step: 0.05,
        value: s.r0,
        hint: this.zh ? '效率 = (1−T(r0))·100%' : 'efficiency = (1-T(r0))*100%',
        visibleWhen: inMode('isolation'),
      },
      {
        key: 'zetaU',
        label: 'ζ',
        labelI18n: { 'zh-CN': '阻尼比 ζ', 'en-US': 'Damping ratio zeta' },
        type: 'range',
        min: 0.01,
        max: 0.5,
        step: 0.005,
        value: s.zetaU,
        visibleWhen: inMode('unbalance'),
      },
      {
        key: 'rOp',
        label: 'r (orbit)',
        labelI18n: { 'zh-CN': '轨迹频率比 r', 'en-US': 'Orbit ratio r' },
        type: 'range',
        min: 0.1,
        max: 5,
        step: 0.05,
        value: s.rOp,
        visibleWhen: inMode('unbalance'),
      },
      {
        key: 'kappa',
        label: 'κ = ky/kx',
        labelI18n: { 'zh-CN': '刚度各向异性 κ = ky/kx', 'en-US': 'Stiffness anisotropy kappa = ky/kx' },
        type: 'range',
        min: 0.5,
        max: 2,
        step: 0.05,
        value: s.kappa,
        visibleWhen: inMode('unbalance'),
      },
      actionButton('simulate', 'Simulate', '仿真', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (key: keyof State, lo: number, hi: number): void => {
      const v = params[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = clamp(v, lo, hi);
      if (this.state[key] !== c) {
        (this.state as unknown as Record<string, number>)[key] = c;
        changed = true;
        if (key === 'chainN' || key === 'chainM' || key === 'chainK') this.importedChain = null;
      }
    };
    num('m', 0.05, 100);
    num('k', 1, 100000);
    num('c', 0, 5000);
    num('x0', 0, 0.05);
    num('v0', -1, 1);
    num('tEnd', 1, 60);
    num('F0', 0.1, 1000);
    num('chainN', 2, 12);
    num('chainM', 0.05, 10);
    num('chainK', 1, 10000);
    num('beamEI', 100, 200000);
    num('beamRhoA', 1, 2000);
    num('beamL', 1, 20);
    num('beamN', 8, 80);
    num('zetaM', 0, 0.2);
    num('zetaIso', 0.01, 0.5);
    num('r0', 0.1, 10);
    num('zetaU', 0.01, 0.5);
    num('rOp', 0.1, 5);
    num('kappa', 0.5, 2);

    const sel = <K extends keyof State>(key: K, allowed: readonly State[K][]): void => {
      const v = params[key];
      if (typeof v !== 'string') return;
      const hit = allowed.find((a) => a === (v as unknown as State[K]));
      if (hit !== undefined && this.state[key] !== hit) {
        this.state[key] = hit;
        changed = true;
      }
    };
    sel('mode', ['sdof', 'mdof', 'frf', 'isolation', 'unbalance'] as const);
    sel('system', ['chain', 'beam'] as const);
    sel('frfSource', ['sdof', 'mdof'] as const);

    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'simulate')) this.runSimulation();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- compute (Block/Flow entry) ---------------------------------------------

  async compute(input: unknown): Promise<ComputeResult> {
    try {
      const { header, rows } = parseTableInput(input);
      const idx = (names: string[]): number => header.findIndex((h) => names.includes(h));
      const mIdx = idx(['m', 'mass']);
      const kIdx = idx(['k', 'stiffness']);
      const wIdx = idx(['w', 'omega', 'freq', 'frequency', 'f_hz', 'f']);
      const aIdx = idx(['amp', 'amplitude', 'mag', 'magnitude', 'mag_db', 'magdb', 'abs']);
      if (mIdx >= 0 && kIdx >= 0) return this.computeFromParamTable(rows, mIdx, kIdx, idx(['c', 'damping']));
      if (wIdx >= 0 && aIdx >= 0) {
        return this.computeFromSweep(header, rows, wIdx, aIdx, idx(['phase', 'phase_deg', 'phase_lag', 'lag']));
      }
      throw new VibrationError(
        'input must have columns m,k[,c] (SDOF row / MDOF chain) or w/frequency + amp/magnitude[, phase] (frequency sweep)',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  /** CSV columns m,k[,c]: one row = SDOF parameters; several rows = MDOF chain. */
  private computeFromParamTable(rows: number[][], mIdx: number, kIdx: number, cIdx: number): ComputeResult {
    const col = (i: number): number[] => rows.map((r) => r[i]!);
    if (rows.length === 1) {
      const m = rows[0]![mIdx]!;
      const k = rows[0]![kIdx]!;
      const c = cIdx >= 0 ? rows[0]![cIdx]! : 0;
      this.importedChain = null;
      this.importedSweep = null;
      this.state.m = clamp(m, 0.05, 100);
      this.state.k = clamp(k, 1, 100000);
      this.state.c = clamp(c, 0, 5000);
      this.state.mode = 'sdof';
      this.refreshAfterCompute();
      const d = sdofDerived({ m, k, c });
      return {
        ok: true,
        output: {
          kind: 'sdof',
          wn: d.wn,
          fn: d.wn / (2 * Math.PI),
          zeta: d.zeta,
          Q: d.Q,
          identified: this.sdofRes ? { zeta: this.sdofRes.id.zeta, wn: this.sdofRes.id.wn } : null,
        },
      };
    }
    const masses = col(mIdx);
    const springs = col(kIdx);
    const dampings = cIdx >= 0 ? col(cIdx) : null;
    this.importedChain = { masses, springs, dampings };
    this.importedSweep = null;
    this.state.system = 'chain';
    this.state.mode = 'mdof';
    this.refreshAfterCompute();
    const mdof = this.mdofRes;
    return {
      ok: true,
      output: {
        kind: 'mdof-chain',
        n: masses.length,
        omega: mdof ? mdof.modes.omega.slice(0, 3) : [],
        fn: mdof ? mdof.modes.omega.slice(0, 3).map((w) => w / (2 * Math.PI)) : [],
        zeta1: mdof ? mdof.zetas[0] : null,
      },
    };
  }

  /** CSV columns w/frequency + amp/magnitude[, phase]: half-power identification on the sweep. */
  private computeFromSweep(header: string[], rows: number[][], wIdx: number, aIdx: number, pIdx: number): ComputeResult {
    const isDb = /db/.test(headerName(header, aIdx));
    const pairs = rows.map((r) => ({ w: r[wIdx]!, a: r[aIdx]! }));
    if (pairs.some((p) => !(p.w > 0))) throw new VibrationError('sweep frequencies must be > 0');
    if (isDb ? pairs.some((p) => !Number.isFinite(p.a)) : pairs.some((p) => !(p.a > 0))) {
      throw new VibrationError('sweep amplitudes must be > 0 (linear) or finite (dB)');
    }
    pairs.sort((p, q) => p.w - q.w); // deterministic ordering for identification
    const w = pairs.map((p) => p.w);
    const magDb = pairs.map((p) => (isDb ? p.a : 20 * Math.log10(p.a)));
    const phase = pIdx >= 0 ? pairs.map((_, i) => rows[i]![pIdx]!) : null;
    this.importedSweep = { w, magDb, phaseLagDeg: phase };
    this.importedChain = null;
    this.state.mode = 'frf';
    this.refreshAfterCompute();
    const id = this.frfRes ? this.frfRes.id : HALF_POWER_NAN_COPY;
    return {
      ok: true,
      output: {
        kind: 'frf-sweep',
        points: w.length,
        wr: id.wr,
        zeta: id.zeta,
        wn: id.wn,
        Q: id.Q,
        peakDb: id.peakDb,
      },
    };
  }

  /** Recompute + refresh the parameter panel + redraw after a compute() mutation. */
  private refreshAfterCompute() {
    this.recompute();
    this.publishOutputs();
    emit('host:params:changed', { pluginId: this.manifest.id });
    this.draw();
  }

  /** Accept a CSV/JSON file through the host data loader. */
  async loadData(file: File): Promise<void> {
    try {
      const text = await file.text();
      const result = await this.compute(text);
      if (result.ok) {
        notify(this.api, 'success', `Imported ${file.name}.`, `已导入 ${file.name}。`);
      } else {
        notify(this.api, 'error', `Import failed: ${result.error ?? 'unknown error'}`, `导入失败：${result.error ?? '未知错误'}`);
      }
    } catch (e) {
      notify(this.api, 'error', `Import failed: ${e instanceof Error ? e.message : String(e)}`, `导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- serialization (SimPlugin-style state persistence) -----------------------

  serialize(): Record<string, unknown> {
    return { pluginId: this.manifest.id, version: 1, state: { ...this.state } };
  }

  deserialize(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const src = (data as { state?: Record<string, unknown> }).state ?? (data as Record<string, unknown>);
    const numKeys: Array<keyof State> = [
      'm', 'k', 'c', 'x0', 'v0', 'tEnd', 'F0', 'chainN', 'chainM', 'chainK',
      'beamEI', 'beamRhoA', 'beamL', 'beamN', 'zetaM', 'zetaIso', 'r0', 'zetaU', 'rOp', 'kappa',
    ];
    for (const key of numKeys) {
      const v = src[key];
      if (typeof v === 'number' && Number.isFinite(v)) (this.state as unknown as Record<string, number>)[key] = v;
    }
    if (src.mode === 'sdof' || src.mode === 'mdof' || src.mode === 'frf' || src.mode === 'isolation' || src.mode === 'unbalance') {
      this.state.mode = src.mode;
    }
    if (src.system === 'chain' || src.system === 'beam') this.state.system = src.system;
    if (src.frfSource === 'sdof' || src.frfSource === 'mdof') this.state.frfSource = src.frfSource;
    this.recompute();
    this.draw();
  }

  // ---- internals ---------------------------------------------------------------

  private computeSdof(): SdofResults {
    const s = this.state;
    const p: SdofParams = { m: s.m, k: s.k, c: s.c };
    const derived = sdofDerived(p);
    const decay = sdofFreeDecayRk4(p, s.x0, s.v0, s.tEnd, 4800);
    const sweep = sdofFrf(p, 1600);
    const id = halfPowerIdentify(sweep);
    const xSt = s.F0 / s.k;
    const xRes =
      derived.zeta > 0 && derived.zeta < 1
        ? xSt / (2 * derived.zeta * Math.sqrt(1 - derived.zeta * derived.zeta))
        : Number.POSITIVE_INFINITY;
    return { p, derived, decay, sweep, id, xSt, xRes };
  }

  private buildMdofModel(): MdofModel {
    const s = this.state;
    if (s.system === 'chain') {
      if (this.importedChain) {
        return buildChain(this.importedChain.masses, this.importedChain.springs);
      }
      const n = Math.round(s.chainN);
      return buildChain(new Array<number>(n).fill(s.chainM), new Array<number>(n + 1).fill(s.chainK));
    }
    return buildBeam(Math.round(s.beamN), s.beamEI, s.beamRhoA, s.beamL);
  }

  private computeMdof(): MdofResults {
    const s = this.state;
    const model = this.buildMdofModel();
    const modes: MdofModes = this.requireEigen(model);
    const nShow = Math.min(3, modes.n);
    const w2 = modes.omega[Math.min(2, modes.n - 1)]!;
    const { alpha, beta } = rayleighAlphaBeta(modes.omega[0]!, w2, s.zetaM);
    const zetas = rayleighModalZeta(modes.omega, alpha, beta);
    let driveDof = 0;
    let bv = 0;
    for (let j = 0; j < modes.n; j += 1) {
      const v = Math.abs(modes.shapes[j]![0]!);
      if (v > bv) {
        bv = v;
        driveDof = j;
      }
    }
    const frf = mdofDriveFrf(modes, zetas, driveDof, 0.2 * modes.omega[0]!, 30 * modes.omega[0]!, 1500);
    let refOmega: number[] | null = null;
    let refCont: number[] | null = null;
    if (s.system === 'chain' && !this.importedChain) {
      refOmega = chainAnalyticOmega(modes.n, s.chainM, s.chainK);
    } else if (s.system === 'beam') {
      refOmega = beamDiscreteOmega(modes.n, s.beamEI, s.beamRhoA, s.beamL, Math.round(s.beamN));
      refCont = beamContinuousOmega(modes.n, s.beamEI, s.beamRhoA, s.beamL);
    }
    const label =
      s.system === 'chain'
        ? this.importedChain
          ? `chain (imported, N = ${modes.n})`
          : `spring chain (N = ${modes.n})`
        : `simply supported beam (${modes.n} nodes)`;
    return { model, modes, zetas, nShow, driveDof, frf, refOmega, refCont, label };
  }

  /** generalizedEigenDiagM with a friendlier singular-matrix message. */
  private requireEigen(model: MdofModel): MdofModes {
    try {
      return generalizedEigenDiagM(model);
    } catch (e) {
      throw new VibrationError(`eigenanalysis failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private computeFrf(): FrfResults {
    if (this.importedSweep) {
      const sw = this.importedSweep;
      const id = halfPowerIdentify({ w: sw.w, magDb: sw.magDb, phaseLagDeg: sw.phaseLagDeg ?? sw.magDb.map(() => 0) });
      return {
        w: sw.w,
        magDb: sw.magDb,
        phaseLagDeg: sw.phaseLagDeg,
        id,
        imported: true,
        label: 'imported sweep',
        trueWn: null,
        trueZeta: null,
      };
    }
    if (this.state.frfSource === 'sdof') {
      const s = this.computeSdof();
      return {
        w: s.sweep.w,
        magDb: s.sweep.magDb,
        phaseLagDeg: s.sweep.phaseLagDeg,
        id: s.id,
        imported: false,
        label: 'SDOF receptance',
        trueWn: s.derived.wn,
        trueZeta: s.derived.zeta,
      };
    }
    const mdof = this.computeMdof();
    const id = halfPowerIdentify({ w: mdof.frf.w, magDb: mdof.frf.magDb, phaseLagDeg: mdof.frf.phaseLagDeg });
    return {
      w: mdof.frf.w,
      magDb: mdof.frf.magDb,
      phaseLagDeg: mdof.frf.phaseLagDeg,
      id,
      imported: false,
      label: `MDOF drive point (${mdof.label})`,
      trueWn: mdof.modes.omega[0] ?? null,
      trueZeta: mdof.zetas[0] ?? null,
    };
  }

  private computeIso(): IsoResults {
    const s = this.state;
    const { r, curves } = transmissibilitySweep(ISO_ZETAS, 0.1, 10, 500);
    const hiR = logspace(0.1, 10, 1200);
    const hi = { r: hiR, T: hiR.map((ri) => transmissibility(s.zetaIso, ri)) };
    const peak = transmissibilityPeak(s.zetaIso);
    const t0 = transmissibility(s.zetaIso, s.r0);
    const sqrt2Check = Math.abs(transmissibility(s.zetaIso, Math.SQRT2) - 1);
    return { r, zetaList: ISO_ZETAS.slice(), curves, hi, peak, t0, sqrt2Check };
  }

  private computeUnb(): UnbResults {
    const s = this.state;
    const { r, ampNorm, phaseLagDeg } = unbalanceSweep(s.zetaU, 800, 0.05, 10);
    const peakExact = 1 / (2 * s.zetaU);
    let peakNum = 0;
    let peakR = 1;
    for (let i = 0; i <= 20000; i += 1) {
      const rr = 0.5 + (i * 1) / 20000;
      const a = unbalancePoint(s.zetaU, rr).ampNorm;
      if (a > peakNum) {
        peakNum = a;
        peakR = rr;
      }
    }
    const phaseAt1 = unbalancePoint(s.zetaU, 1).phaseLagDeg;
    const orbit = unbalanceOrbit(s.zetaU, s.rOp, s.kappa, 144);
    let orbitMax = 0;
    for (let i = 0; i < orbit.x.length; i += 1) orbitMax = Math.max(orbitMax, Math.hypot(orbit.x[i]!, orbit.y[i]!));
    return { r, ampNorm, phaseLagDeg, peakExact, peakNum, peakR, phaseAt1, orbit, orbitMax };
  }

  private recompute() {
    this.errorMsg = null;
    this.sdofRes = null;
    this.mdofRes = null;
    this.frfRes = null;
    this.isoRes = null;
    this.unbRes = null;
    try {
      switch (this.state.mode) {
        case 'sdof':
          this.sdofRes = this.computeSdof();
          break;
        case 'mdof':
          this.mdofRes = this.computeMdof();
          break;
        case 'frf':
          this.frfRes = this.computeFrf();
          break;
        case 'isolation':
          this.isoRes = this.computeIso();
          break;
        case 'unbalance':
          this.unbRes = this.computeUnb();
          break;
      }
    } catch (e) {
      this.errorMsg = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
    this.reportDataScale();
  }

  /** Report the active computation's sample count to the perf panel. */
  private reportDataScale() {
    if (!this.api) return;
    let n = 0;
    if (this.sdofRes) n += this.sdofRes.decay.t.length + this.sdofRes.sweep.w.length;
    if (this.mdofRes) n += this.mdofRes.model.n * this.mdofRes.model.n + this.mdofRes.frf.w.length;
    if (this.frfRes) n += this.frfRes.w.length * (this.frfRes.phaseLagDeg ? 2 : 1);
    if (this.isoRes) n += this.isoRes.hi.r.length + this.isoRes.r.length * this.isoRes.zetaList.length;
    if (this.unbRes) n += this.unbRes.r.length * 2 + this.unbRes.orbit.x.length * 2;
    this.api.reportDataScale(n);
  }

  /** Simulate button: recompute, publish scientific outputs and announce. */
  private runSimulation() {
    this.recompute();
    if (this.errorMsg) {
      notify(
        this.api,
        'error',
        `Simulation failed: ${this.errorMsg}`,
        `仿真失败：${this.errorMsg}`,
      );
      this.draw();
      return;
    }
    this.publishOutputs();
    const summary = this.summaryLine();
    notify(this.api, 'success', summary, summary);
    this.draw();
  }

  private summaryLine(): string {
    const s = this.state;
    switch (s.mode) {
      case 'sdof': {
        const r = this.sdofRes!;
        return `fn = ${fmtMetric(r.derived.wn / (2 * Math.PI))} Hz · zeta = ${fmtMetric(r.derived.zeta)} · Q = ${fmtMetric(r.derived.Q)} · X_res = ${fmtMetric(r.xRes)} m`;
      }
      case 'mdof': {
        const r = this.mdofRes!;
        const w1 = r.modes.omega[0]!;
        return `w1 = ${fmtMetric(w1)} rad/s · w2 = ${fmtMetric(r.modes.omega[1] ?? Number.NaN)} rad/s · w3 = ${fmtMetric(r.modes.omega[2] ?? Number.NaN)} rad/s · zeta1 = ${fmtMetric(r.zetas[0]!)}`;
      }
      case 'frf': {
        const r = this.frfRes!;
        return `wr = ${fmtMetric(r.id.wr)} rad/s · zeta_id = ${fmtMetric(r.id.zeta)} · wn_id = ${fmtMetric(r.id.wn)} rad/s · Q = ${fmtMetric(r.id.Q)}`;
      }
      case 'isolation': {
        const r = this.isoRes!;
        return `T_max = ${fmtMetric(r.peak.tMax)} · r_peak = ${fmtMetric(r.peak.rPeak)} · T(r0) = ${fmtMetric(r.t0)} · efficiency = ${fmtMetric((1 - r.t0) * 100)} %`;
      }
      case 'unbalance': {
        const r = this.unbRes!;
        return `peak mX/(me*e) = ${fmtMetric(r.peakNum)} (exact 1/(2*zeta) = ${fmtMetric(r.peakExact)}) · phase(r=1) = ${fmtMetric(r.phaseAt1)} deg`;
      }
    }
  }

  // ---- scientific outputs ------------------------------------------------------

  private publishOutputs() {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    const errOk = (c: number, a: number, tol: number): boolean =>
      Number.isFinite(a) && Number.isFinite(c) && (a !== 0 ? Math.abs(c - a) / Math.abs(a) < tol : Math.abs(c - a) < tol);
    const relErrPct = (c: number, a: number): string | null =>
      Number.isFinite(a) && Number.isFinite(c) && a !== 0 ? `${fmtMetric((Math.abs(c - a) / Math.abs(a)) * 100, 3)}%` : null;
    const pushRel = (key: string, zhLabel: string, enLabel: string, c: number, a: number): void => {
      const s = relErrPct(c, a);
      if (s === null) return;
      metrics.push({
        key,
        label: zh ? zhLabel : enLabel,
        value: s,
        unit: '%',
        severity: 'info',
        hint: zh ? '统一相对误差口径 |计算−解析|/|解析|' : 'unified yardstick |computed - analytic| / |analytic|',
      });
    };

    if (this.sdofRes) {
      const r = this.sdofRes;
      const d = r.derived;
      metrics.push({
        key: 'fn',
        label: zh ? '固有频率 fn' : 'Natural frequency fn',
        value: fmtMetric(d.wn / (2 * Math.PI)),
        unit: 'Hz',
        severity: 'info',
        hint: `wn = ${fmtMetric(d.wn)} rad/s`,
      });
      metrics.push({
        key: 'zeta',
        label: zh ? '阻尼比 ζ' : 'Damping ratio zeta',
        value: fmtMetric(d.zeta),
        severity: d.zeta < 1 ? 'ok' : 'warn',
        hint: `c = ${fmtMetric(r.p.c)} N·s/m, ccrit = ${fmtMetric(d.ccrit)} N·s/m`,
      });
      metrics.push({
        key: 'Q',
        label: zh ? '品质因子 Q' : 'Quality factor Q',
        value: Number.isFinite(d.Q) ? fmtMetric(d.Q) : '∞',
        severity: 'info',
        hint: 'Q = 1/(2ζ)',
      });
      metrics.push({
        key: 'xres',
        label: zh ? '共振幅值 X_res' : 'Resonance amplitude X_res',
        value: Number.isFinite(r.xRes) ? fmtMetric(r.xRes) : '∞',
        unit: 'm',
        severity: 'info',
        hint: `X_st = F0/k = ${fmtMetric(r.xSt)} m · X_res = X_st/(2ζ√(1−ζ²))`,
      });
      metrics.push({
        key: 'rk4-dev',
        label: zh ? 'RK4 最大偏差' : 'RK4 max deviation',
        value: fmtMetric(r.decay.maxRelDev * 100, 3),
        unit: '%',
        severity: r.decay.maxRelDev < 1e-3 ? 'ok' : 'warn',
        hint: zh ? 'RK4 自由衰减对比精确闭式解（相对幅值）' : 'RK4 free decay vs exact closed form (relative to amplitude)',
      });
      if (r.id.ok) {
        metrics.push({
          key: 'zeta-id',
          label: zh ? '半功率识别 ζ_id' : 'Half-power zeta_id',
          value: fmtMetric(r.id.zeta),
          severity: errOk(r.id.zeta, d.zeta, 0.01) ? 'ok' : 'warn',
          hint: zh
            ? `解析 ${fmtMetric(d.zeta)} · 半功率法自带 O(ζ²) 偏差`
            : `analytic ${fmtMetric(d.zeta)} · the method carries an O(zeta^2) bias`,
        });
        pushRel('rel-err-zeta-id', 'ζ_id 相对误差', 'zeta_id rel err', r.id.zeta, d.zeta);
        metrics.push({
          key: 'wn-id',
          label: zh ? '半功率识别 ωn_id' : 'Half-power wn_id',
          value: fmtMetric(r.id.wn),
          unit: 'rad/s',
          severity: errOk(r.id.wn, d.wn, 0.001) ? 'ok' : 'warn',
          hint: `${zh ? '解析' : 'analytic'} ${fmtMetric(d.wn)} rad/s`,
        });
        pushRel('rel-err-wn-id', 'ωn_id 相对误差', 'wn_id rel err', r.id.wn, d.wn);
      }
    }

    if (this.mdofRes) {
      const r = this.mdofRes;
      metrics.push({
        key: 'model',
        label: zh ? '模型' : 'Model',
        value: `${r.label} · ${r.modes.n} DOF`,
        severity: 'info',
      });
      for (let i = 0; i < r.nShow; i += 1) {
        const wn = r.modes.omega[i]!;
        const fn = wn / (2 * Math.PI);
        const ref = r.refOmega ? r.refOmega[i] : null;
        const cont = r.refCont ? r.refCont[i] : null;
        const refVal = cont ?? ref;
        metrics.push({
          key: `fn${i + 1}`,
          label: zh ? `第 ${i + 1} 阶 fn` : `Mode ${i + 1} fn`,
          value: fmtMetric(fn),
          unit: 'Hz',
          severity: refVal === null || refVal === undefined ? 'info' : errOk(wn, refVal, r.refCont ? 0.005 : 5e-9) ? 'ok' : 'warn',
          hint:
            refVal === null || refVal === undefined
              ? zh
                ? '导入的非均匀链无闭式参考'
                : 'no closed-form reference for the imported non-uniform chain'
              : `${zh ? '解析' : 'analytic'} ${fmtMetric(refVal)} rad/s${r.refCont ? ` (${zh ? '连续梁理论' : 'continuous beam theory'})` : ''}`,
        });
        pushRel(`rel-err-w${i + 1}`, `ω${i + 1} 相对误差`, `w${i + 1} rel err`, wn, refVal ?? Number.NaN);
      }
      metrics.push({
        key: 'zeta1',
        label: zh ? '一阶模态阻尼 ζ1' : 'First-mode damping zeta1',
        value: fmtMetric(r.zetas[0]!),
        severity: 'info',
        hint: zh ? 'Rayleigh：ζ(ω1) = ζ(ω3) = 目标值' : 'Rayleigh: zeta(w1) = zeta(w3) = target',
      });
    }

    if (this.frfRes) {
      const r = this.frfRes;
      metrics.push({
        key: 'wr',
        label: zh ? '共振频率 wr' : 'Resonance frequency wr',
        value: fmtMetric(r.id.wr),
        unit: 'rad/s',
        severity: r.id.ok ? 'ok' : 'warn',
        hint: r.label,
      });
      if (r.id.ok) {
        metrics.push({
          key: 'zeta-id',
          label: zh ? '半功率识别 ζ_id' : 'Half-power zeta_id',
          value: fmtMetric(r.id.zeta),
          severity:
            r.trueZeta === null ? 'info' : errOk(r.id.zeta, r.trueZeta, 0.02) ? 'ok' : 'warn',
          hint:
            r.trueZeta === null
              ? zh
                ? 'MDOF 驱动点/导入数据的半功率识别（含相邻模态影响）'
                : 'half-power estimate on the MDOF drive point / imported data (neighbour-mode influence)'
              : `${zh ? '解析' : 'analytic'} ${fmtMetric(r.trueZeta)} · O(ζ²) ${zh ? '方法偏差' : 'method bias'}`,
        });
        metrics.push({
          key: 'wn-id',
          label: zh ? '识别 ωn_id' : 'Identified wn_id',
          value: fmtMetric(r.id.wn),
          unit: 'rad/s',
          severity: r.trueWn === null ? 'info' : errOk(r.id.wn, r.trueWn, 0.01) ? 'ok' : 'warn',
          hint: r.trueWn === null ? undefined : `${zh ? '解析' : 'analytic'} ${fmtMetric(r.trueWn)} rad/s`,
        });
        metrics.push({
          key: 'Q-id',
          label: zh ? '品质因子 Q' : 'Quality factor Q',
          value: fmtMetric(r.id.Q),
          severity: 'info',
          hint: 'Q = 1/(2ζ_id)',
        });
      }
      metrics.push({
        key: 'peak-db',
        label: zh ? '峰值电平' : 'Peak level',
        value: fmtMetric(r.id.peakDb),
        unit: 'dB',
        severity: 'info',
      });
    }

    if (this.isoRes) {
      const r = this.isoRes;
      const oneOver2z = 1 / (2 * this.state.zetaIso);
      metrics.push({
        key: 'tmax',
        label: zh ? '传递率峰值 T_max' : 'Transmissibility peak T_max',
        value: fmtMetric(r.peak.tMax),
        severity: errOk(r.peak.tMax, oneOver2z, this.state.zetaIso <= 0.1 ? 0.01 : 0.1) ? 'ok' : 'info',
        hint: zh
          ? `1/(2ζ) = ${fmtMetric(oneOver2z)}（小阻尼近似，精确峰含 O(ζ²) 修正）`
          : `1/(2*zeta) = ${fmtMetric(oneOver2z)} (small-damping approximation; the exact peak carries an O(zeta^2) correction)`,
      });
      pushRel('rel-err-tmax', 'T_max−1/(2ζ) 相对误差', 'T_max vs 1/(2*zeta) rel err', r.peak.tMax, oneOver2z);
      metrics.push({
        key: 'rpeak',
        label: zh ? '峰值频率比 r_peak' : 'Peak ratio r_peak',
        value: fmtMetric(r.peak.rPeak),
        severity: 'info',
        hint: 'r_peak = sqrt((sqrt(1+16ζ²+32ζ⁴)−1)/(8ζ²))',
      });
      metrics.push({
        key: 'iso-eff',
        label: zh ? '隔振效率 (r0)' : 'Isolation efficiency (r0)',
        value: fmtMetric((1 - r.t0) * 100, 3),
        unit: '%',
        severity: r.t0 < 1 ? 'ok' : 'warn',
        hint:
          r.t0 < 1
            ? `T(r0) = ${fmtMetric(r.t0)} < 1 (${zh ? '隔离区' : 'isolation region'})`
            : `T(r0) = ${fmtMetric(r.t0)} >= 1 (${zh ? '放大区，需 r0 > √2' : 'amplification region — need r0 > sqrt(2)'})`,
      });
      metrics.push({
        key: 'sqrt2-check',
        label: zh ? '√2 分界校核 |T(√2)−1|' : 'sqrt(2) boundary check |T(sqrt2)-1|',
        value: fmtMetric(r.sqrt2Check, 3),
        severity: r.sqrt2Check < 1e-12 ? 'ok' : 'warn',
        hint: zh ? 'T(√2) = 1 对一切 ζ 精确成立（代数恒等式）' : 'T(sqrt(2)) = 1 exactly for every zeta (algebraic identity)',
      });
    }

    if (this.unbRes) {
      const r = this.unbRes;
      metrics.push({
        key: 'unb-peak',
        label: zh ? '不平衡峰值 mX/(me·e)' : 'Unbalance peak mX/(me*e)',
        value: fmtMetric(r.peakNum),
        severity: errOk(r.peakNum, r.peakExact, 1e-4) ? 'ok' : 'warn',
        hint: zh
          ? `精确峰值 1/(2ζ) = ${fmtMetric(r.peakExact)}，位于 r = 1`
          : `exact peak 1/(2*zeta) = ${fmtMetric(r.peakExact)} at r = 1`,
      });
      pushRel('rel-err-unb-peak', '峰值相对误差', 'peak rel err', r.peakNum, r.peakExact);
      metrics.push({
        key: 'unb-phase',
        label: zh ? '共振相位 (r=1)' : 'Resonance phase (r=1)',
        value: fmtMetric(r.phaseAt1, 6),
        unit: '°',
        severity: Math.abs(r.phaseAt1 - 90) < 1e-9 ? 'ok' : 'warn',
        hint: zh ? '不平衡激励下共振点相位滞后恒为 90°' : 'the phase lag at resonance is exactly 90 deg under unbalance excitation',
      });
      metrics.push({
        key: 'orbit-max',
        label: zh ? '轴心轨迹最大半径' : 'Orbit max radius',
        value: fmtMetric(r.orbitMax),
        severity: 'info',
        hint: zh
          ? `归一化 mX/(me·e) 尺度，r = ${fmtMetric(this.state.rOp)}，κ = ${fmtMetric(this.state.kappa)}`
          : `normalized mX/(me*e) scale at r = ${fmtMetric(this.state.rOp)}, kappa = ${fmtMetric(this.state.kappa)}`,
      });
    }

    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export --------------------------------------------------------------

  private exportCsv() {
    const s = this.state;
    if (s.mode === 'sdof' && this.sdofRes) {
      const d = this.sdofRes.decay;
      const stride = Math.max(1, Math.ceil(d.t.length / 2000));
      const rows: Array<Array<number | string>> = [];
      for (let i = 0; i < d.t.length; i += stride) {
        rows.push([
          Number(d.t[i]!.toPrecision(8)),
          Number(d.xNum[i]!.toPrecision(8)),
          Number(d.xExact[i]!.toPrecision(8)),
        ]);
      }
      exportRowsCsv(this.api, 'vib-sdof-free-decay', ['t_s', 'x_rk4_m', 'x_exact_m'], rows);
      return;
    }
    if (s.mode === 'mdof' && this.mdofRes) {
      const r = this.mdofRes;
      const rows: Array<Array<number | string>> = r.model.positions.map((x, j) => {
        const row: Array<number | string> = [j + 1, Number(x.toPrecision(8))];
        for (let i = 0; i < r.nShow; i += 1) {
          const phiMax = Math.max(...r.modes.shapes.map((row2) => Math.abs(row2[i]!)));
          row.push(Number((r.modes.shapes[j]![i]! / (phiMax || 1)).toPrecision(8)));
        }
        return row;
      });
      exportRowsCsv(this.api, 'vib-mdof-modes', ['dof', 'position', 'mode_1', 'mode_2', 'mode_3'].slice(0, 2 + r.nShow), rows);
      return;
    }
    if (s.mode === 'frf' && this.frfRes) {
      const r = this.frfRes;
      const rows: Array<Array<number | string>> = r.w.map((w, i) => [
        Number(w.toPrecision(8)),
        Number(r.magDb[i]!.toPrecision(8)),
        r.phaseLagDeg ? Number(r.phaseLagDeg[i]!.toPrecision(8)) : '-',
      ]);
      exportRowsCsv(this.api, 'vib-frf', ['w_rad_s', 'mag_db', 'phase_lag_deg'], rows);
      return;
    }
    if (s.mode === 'isolation' && this.isoRes) {
      const r = this.isoRes;
      const rows: Array<Array<number | string>> = r.r.map((ri, i) => [
        Number(ri.toPrecision(8)),
        ...r.zetaList.map((_, c) => Number(r.curves[c]![i]!.toPrecision(8))),
        Number(transmissibility(s.zetaIso, ri).toPrecision(8)),
      ]);
      exportRowsCsv(
        this.api,
        'vib-transmissibility',
        ['r', ...r.zetaList.map((z) => `T_z${z}`), `T_z${s.zetaIso}_hilite`],
        rows,
      );
      return;
    }
    if (s.mode === 'unbalance' && this.unbRes) {
      const r = this.unbRes;
      const rows: Array<Array<number | string>> = r.r.map((ri, i) => [
        Number(ri.toPrecision(8)),
        Number(r.ampNorm[i]!.toPrecision(8)),
        Number(r.phaseLagDeg[i]!.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'vib-unbalance', ['r', 'mX_over_me_e', 'phase_lag_deg'], rows);
      return;
    }
    notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
  }

  // ---- drawing ---------------------------------------------------------------

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

    if (this.errorMsg) {
      g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = COL.warn;
      g.font = this.fnt(13);
      g.textAlign = 'center';
      g.fillText(
        this.zh ? `参数无效：${this.errorMsg}` : `Invalid parameters: ${this.errorMsg}`,
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }
    const hasResult =
      this.sdofRes || this.mdofRes || this.frfRes || this.isoRes || this.unbRes;
    if (!hasResult) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No computation yet',
        titleZh: '尚未计算',
        hint: 'Adjust the parameters and press "Simulate".',
        hintZh: '调整参数后点击「仿真」。',
      });
      return;
    }

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;
    g.textAlign = 'center';
    g.fillStyle = COL.bright;
    g.font = this.fnt(13);
    const titles: Record<VibMode, [string, string]> = {
      sdof: ['单自由度 · 自由衰减 / 频响', 'SDOF · free decay / frequency response'],
      mdof: ['多自由度 · 振型与频响', 'MDOF · mode shapes and FRF'],
      frf: ['频响函数 · 幅频 / 相频', 'FRF · magnitude / phase'],
      isolation: ['隔振传递率 T(r)', 'Isolation transmissibility T(r)'],
      unbalance: ['旋转不平衡 · 幅值 / 相位 / 轴心轨迹', 'Rotating unbalance · amplitude / phase / orbit'],
    };
    const t = titles[this.state.mode];
    g.fillText(this.zh ? t[0] : t[1], w / 2, 18);

    const left = 52;
    const top = 30;
    const width = w - left - 16;
    const bottom = h - 40;
    const avail = bottom - top;
    const gap = 12;
    switch (this.state.mode) {
      case 'sdof': {
        const h1 = (avail - 2 * gap) * 0.4;
        const h2 = (avail - 2 * gap) * 0.32;
        const h3 = (avail - 2 * gap) * 0.28;
        this.drawDecay(g, { x: left, y: top, w: width, h: h1 }, true);
        this.drawSdofAmp(g, { x: left, y: top + h1 + gap, w: width, h: h2 }, true);
        this.drawSdofPhase(g, { x: left, y: top + h1 + h2 + 2 * gap, w: width, h: h3 }, true);
        this.drawFooterSdof(g, h);
        break;
      }
      case 'mdof': {
        const h1 = (avail - gap) * 0.48;
        const h2 = avail - gap - h1;
        this.drawModeShapes(g, { x: left, y: top, w: width, h: h1 }, true);
        this.drawMdofFrf(g, { x: left, y: top + h1 + gap, w: width, h: h2 }, true);
        this.drawFooterMdof(g, h);
        break;
      }
      case 'frf': {
        const hasPhase = this.frfRes?.phaseLagDeg != null;
        const h1 = hasPhase ? (avail - gap) * 0.56 : avail;
        this.drawFrfMag(g, { x: left, y: top, w: width, h: h1 }, true);
        if (hasPhase) {
          this.drawFrfPhase(g, { x: left, y: top + h1 + gap, w: width, h: avail - gap - h1 }, true);
        }
        this.drawFooterFrf(g, h);
        break;
      }
      case 'isolation': {
        this.drawIso(g, { x: left, y: top, w: width, h: avail }, true);
        this.drawFooterIso(g, h);
        break;
      }
      case 'unbalance': {
        const ampW = width * 0.6;
        const orbitW = width - ampW - gap;
        const hTop = (avail - gap) * 0.58;
        const hBot = avail - gap - hTop;
        this.drawUnbAmp(g, { x: left, y: top, w: ampW, h: hTop }, true);
        this.drawOrbit(g, { x: left + ampW + gap, y: top, w: orbitW, h: hTop }, true);
        this.drawUnbPhase(g, { x: left, y: top + hTop + gap, w: width, h: hBot }, true);
        this.drawFooterUnb(g, h);
        break;
      }
    }
  }

  /** Free-decay panel: RK4 curve vs the exact closed form. */
  private drawDecay(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const d = this.sdofRes!.decay;
    const zh = this.zh;
    const tEnd = d.t[d.t.length - 1]!;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (let i = 0; i < d.xNum.length; i += 1) {
      yLo = Math.min(yLo, d.xNum[i]!, d.xExact[i]!);
      yHi = Math.max(yHi, d.xNum[i]!, d.xExact[i]!);
    }
    const pad = (yHi - yLo) * 0.12 || 1e-6;
    yLo -= pad;
    yHi += pad;
    const mapX = (t: number): number => r.x + (t / tEnd) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - yLo) / (yHi - yLo)) * r.h;
    drawFrame(g, r, zh ? '自由衰减：RK4 与精确解' : 'Free decay: RK4 vs exact', 't (s)', 'x (m)', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (const v of linTicks(yLo, yHi, 4)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.text;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
    if (showX) {
      g.textAlign = 'center';
      for (const tv of linTicks(0, tEnd, 6)) {
        const x = mapX(tv);
        g.beginPath();
        g.moveTo(x, r.y);
        g.lineTo(x, r.y + r.h);
        g.stroke();
        g.fillStyle = COL.text;
        g.fillText(fmtTick(tv), x, r.y + r.h + 13);
      }
    }
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // exact reference (dashed ochre)
    g.strokeStyle = COL.ref;
    g.setLineDash([6, 4]);
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i < d.xExact.length; i += 1) {
      const x = mapX(d.t[i]!);
      const y = mapY(d.xExact[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
    // RK4 (solid blue)
    g.strokeStyle = COL.main;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < d.xNum.length; i += 1) {
      const x = mapX(d.t[i]!);
      const y = mapY(d.xNum[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
    // legend
    let ly = r.y + 16;
    const lx = r.x + r.w - 118;
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.strokeStyle = COL.main;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx, ly - 3);
    g.lineTo(lx + 18, ly - 3);
    g.stroke();
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText('RK4', lx + 24, ly);
    ly += 14;
    g.strokeStyle = COL.ref;
    g.setLineDash([5, 3]);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(lx, ly - 3);
    g.lineTo(lx + 18, ly - 3);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(zh ? '精确解' : 'exact', lx + 24, ly);
  }

  /** Shared half-power marker overlay on a magnitude panel (log-w axis). */
  private drawHalfPowerMarkers(
    g: CanvasRenderingContext2D,
    r: Rect,
    w: number[],
    magDb: number[],
    id: HalfPowerId,
    mapX: (v: number) => number,
    mapY: (v: number) => number,
  ) {
    if (!id.ok) return;
    const threshold = id.peakDb - 10 * Math.log10(2);
    g.setLineDash([4, 4]);
    g.strokeStyle = COL.marker;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x, mapY(threshold));
    g.lineTo(r.x + r.w, mapY(threshold));
    g.stroke();
    for (const wc of [id.w1, id.w2]) {
      const x = mapX(wc);
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
    }
    g.setLineDash([]);
    const px = mapX(id.wr);
    const py = mapY(id.peakDb);
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(px, py, 3.5, 0, Math.PI * 2);
    g.fill();
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(220,210,180,0.95)';
    g.fillText(`zeta_id = ${fmtMetric(id.zeta)}`, clamp(px, r.x + 60, r.x + r.w - 60), py - 8);
    void w;
    void magDb;
  }

  /** SDOF receptance magnitude panel (dB, log w). */
  private drawSdofAmp(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const s = this.sdofRes!;
    const sweep = s.sweep;
    const zh = this.zh;
    const wLo = sweep.w[0]!;
    const wHi = sweep.w[sweep.w.length - 1]!;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);
    let vLo = Infinity;
    let vHi = -Infinity;
    for (const v of sweep.magDb) {
      vLo = Math.min(vLo, v);
      vHi = Math.max(vHi, v);
    }
    if (s.id.ok) {
      vHi = Math.max(vHi, s.id.peakDb);
      vLo = Math.min(vLo, s.id.peakDb - 10 * Math.log10(2));
    }
    const pad = (vHi - vLo) * 0.12 || 1;
    vLo -= pad;
    vHi += pad;
    const mapX = (wi: number): number => r.x + ((Math.log10(wi) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - vLo) / (vHi - vLo)) * r.h;
    drawFrame(g, r, zh ? '幅频 |H(jω)|（半功率识别）' : 'Magnitude |H(jw)| (half-power ID)', 'ω (rad/s, log)', '|H| (dB)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, vLo, vHi, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.strokeStyle = COL.main;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < sweep.w.length; i += 1) {
      const x = mapX(sweep.w[i]!);
      const y = mapY(sweep.magDb[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    this.drawHalfPowerMarkers(g, r, sweep.w, sweep.magDb, s.id, mapX, mapY);
    g.restore();
  }

  /** SDOF phase-lag panel (0..180 deg). */
  private drawSdofPhase(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const s = this.sdofRes!;
    const sweep = s.sweep;
    const zh = this.zh;
    const wLo = sweep.w[0]!;
    const wHi = sweep.w[sweep.w.length - 1]!;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);
    const mapX = (wi: number): number => r.x + ((Math.log10(wi) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - 0) / 200) * r.h;
    drawFrame(g, r, zh ? '相频（位移滞后力）' : 'Phase (displacement lag)', 'ω (rad/s, log)', 'lag (°)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, 0, 200, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // 90 deg reference
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(170,182,200,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x, mapY(90));
    g.lineTo(r.x + r.w, mapY(90));
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = COL.green;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < sweep.w.length; i += 1) {
      const x = mapX(sweep.w[i]!);
      const y = mapY(sweep.phaseLagDeg[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // resonance marker: exactly 90 deg at w = wn
    const px = mapX(s.derived.wn);
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(px, mapY(90), 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Decade grid + linear-y ticks shared by log-x panels. */
  private drawLogGrid(
    g: CanvasRenderingContext2D,
    r: Rect,
    logLo: number,
    logHi: number,
    vLo: number,
    vHi: number,
    mapX: (v: number) => number,
    mapY: (v: number) => number,
    showX: boolean,
  ) {
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.strokeStyle = COL.grid;
    g.textAlign = 'center';
    for (let k = Math.ceil(logLo); k <= Math.floor(logHi); k += 1) {
      const x = mapX(Math.pow(10, k));
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
      if (showX) {
        g.fillStyle = COL.text;
        g.fillText(fmtTick(Math.pow(10, k)), x, r.y + r.h + 13);
      }
    }
    g.strokeStyle = COL.grid;
    g.textAlign = 'right';
    for (const v of linTicks(vLo, vHi, 4)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.text;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
  }

  /** MDOF mode-shape panel: the first nShow mass-normalized modes, unit-scaled. */
  private drawModeShapes(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const m = this.mdofRes!;
    const zh = this.zh;
    const xLo = m.model.positions[0]!;
    const xHi = m.model.positions[m.model.positions.length - 1]!;
    const mapX = (x: number): number => r.x + ((x - xLo) / (xHi - xLo || 1)) * r.w;
    const mapY = (v: number): number => r.y + r.h / 2 - (v / 1.25) * (r.h / 2);
    const posLabel = this.state.system === 'beam' ? 'x (m)' : 'x / L';
    drawFrame(g, r, zh ? `振型（质量归一，前 ${m.nShow} 阶）` : `Mode shapes (mass-normalized, first ${m.nShow})`, posLabel, 'phi (norm.)', showX, zh);
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.text;
      g.fillText(String(v), r.x - 4, y + 3);
    }
    if (showX) {
      g.textAlign = 'center';
      for (const x of linTicks(xLo, xHi, 6)) {
        const px = mapX(x);
        g.beginPath();
        g.moveTo(px, r.y);
        g.lineTo(px, r.y + r.h);
        g.stroke();
        g.fillStyle = COL.text;
        g.fillText(fmtTick(x), px, r.y + r.h + 13);
      }
    }
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    const colors = [COL.main, COL.ref, COL.green];
    for (let i = 0; i < m.nShow; i += 1) {
      let phiMax = 0;
      for (let j = 0; j < m.modes.n; j += 1) phiMax = Math.max(phiMax, Math.abs(m.modes.shapes[j]![i]!));
      const scale = phiMax > 0 ? 1 / phiMax : 1;
      g.strokeStyle = colors[i % colors.length]!;
      g.lineWidth = 2;
      g.beginPath();
      for (let j = 0; j < m.modes.n; j += 1) {
        const x = mapX(m.model.positions[j]!);
        const y = mapY(m.modes.shapes[j]![i]! * scale);
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      // node markers
      g.fillStyle = colors[i % colors.length]!;
      for (let j = 0; j < m.modes.n; j += 1) {
        const x = mapX(m.model.positions[j]!);
        const y = mapY(m.modes.shapes[j]![i]! * scale);
        g.beginPath();
        g.arc(x, y, 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    // legend
    let ly = r.y + 18;
    const lx = r.x + r.w - 150;
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    for (let i = 0; i < m.nShow; i += 1) {
      g.strokeStyle = colors[i % colors.length]!;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 14, ly - 3);
      g.stroke();
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.fillText(`mode ${i + 1}: ${fmtMetric(m.modes.omega[i]!)} rad/s`, lx + 19, ly);
      ly += 13;
    }
  }

  /** MDOF drive-point FRF panel with the first nShow natural frequencies marked. */
  private drawMdofFrf(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const m = this.mdofRes!;
    const frf = m.frf;
    const zh = this.zh;
    const wLo = frf.w[0]!;
    const wHi = frf.w[frf.w.length - 1]!;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);
    let vLo = Infinity;
    let vHi = -Infinity;
    for (const v of frf.magDb) {
      vLo = Math.min(vLo, v);
      vHi = Math.max(vHi, v);
    }
    const pad = (vHi - vLo) * 0.1 || 1;
    vLo -= pad;
    vHi += pad;
    const mapX = (wi: number): number => r.x + ((Math.log10(wi) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - vLo) / (vHi - vLo)) * r.h;
    drawFrame(g, r, zh ? `驱动点频响（${zh ? m.label : m.label}，DOF ${m.driveDof + 1}）` : `Drive-point FRF (${m.label}, DOF ${m.driveDof + 1})`, 'ω (rad/s, log)', '|X/F| (dB)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, vLo, vHi, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // natural-frequency ticks
    g.setLineDash([3, 4]);
    g.strokeStyle = 'rgba(170,182,200,0.45)';
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    for (let i = 0; i < m.nShow; i += 1) {
      const wn = m.modes.omega[i]!;
      if (wn < wLo || wn > wHi) continue;
      const x = mapX(wn);
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
      g.fillStyle = COL.text;
      g.fillText(`w${i + 1}`, x, r.y + 12);
    }
    g.setLineDash([]);
    g.strokeStyle = COL.main;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < frf.w.length; i += 1) {
      const x = mapX(frf.w[i]!);
      const y = mapY(frf.magDb[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  /** Generic dB magnitude panel for the FRF mode. */
  private drawFrfMag(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const f = this.frfRes!;
    const zh = this.zh;
    const wLo = f.w[0]!;
    const wHi = f.w[f.w.length - 1]!;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);
    let vLo = Infinity;
    let vHi = -Infinity;
    for (const v of f.magDb) {
      vLo = Math.min(vLo, v);
      vHi = Math.max(vHi, v);
    }
    if (f.id.ok) {
      vHi = Math.max(vHi, f.id.peakDb);
      vLo = Math.min(vLo, f.id.peakDb - 10 * Math.log10(2));
    }
    const pad = (vHi - vLo) * 0.12 || 1;
    vLo -= pad;
    vHi += pad;
    const mapX = (wi: number): number => r.x + ((Math.log10(wi) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - vLo) / (vHi - vLo)) * r.h;
    drawFrame(g, r, `${zh ? '幅频' : 'Magnitude'} · ${f.label}`, 'ω (rad/s, log)', '|H| (dB)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, vLo, vHi, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.strokeStyle = f.imported ? COL.purple : COL.main;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < f.w.length; i += 1) {
      const x = mapX(f.w[i]!);
      const y = mapY(f.magDb[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    this.drawHalfPowerMarkers(g, r, f.w, f.magDb, f.id, mapX, mapY);
    g.restore();
  }

  /** Generic phase-lag panel for the FRF mode. */
  private drawFrfPhase(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const f = this.frfRes!;
    if (!f.phaseLagDeg) return;
    const zh = this.zh;
    const wLo = f.w[0]!;
    const wHi = f.w[f.w.length - 1]!;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);
    const mapX = (wi: number): number => r.x + ((Math.log10(wi) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - 0) / 360) * r.h;
    drawFrame(g, r, zh ? '相频（滞后角）' : 'Phase (lag angle)', 'ω (rad/s, log)', 'lag (°)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, 0, 360, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(170,182,200,0.5)';
    g.lineWidth = 1;
    for (const v of [90, 180]) {
      g.beginPath();
      g.moveTo(r.x, mapY(v));
      g.lineTo(r.x + r.w, mapY(v));
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = COL.green;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < f.w.length; i += 1) {
      const x = mapX(f.w[i]!);
      const y = mapY(f.phaseLagDeg[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  /** Isolation panel: family curves, highlighted zeta, sqrt(2) boundary, operating point. */
  private drawIso(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const iso = this.isoRes!;
    const zh = this.zh;
    const rLo = iso.r[0]!;
    const rHi = iso.r[iso.r.length - 1]!;
    const logLo = Math.log10(rLo);
    const logHi = Math.log10(rHi);
    const hiPeak = iso.peak.tMax;
    const yHi = Math.min(30, Math.max(2.2, hiPeak * 1.15));
    const mapX = (rv: number): number => r.x + ((Math.log10(rv) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - (v / yHi) * r.h;
    drawFrame(g, r, zh ? '传递率曲线族（虚线以上为放大区）' : 'Transmissibility family (above the dashed line = amplification)', 'r = ω/ωn (log)', 'T', showX, zh);
    // grid
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.strokeStyle = COL.grid;
    g.textAlign = 'center';
    for (let k = Math.ceil(logLo); k <= Math.floor(logHi); k += 1) {
      const x = mapX(Math.pow(10, k));
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
      if (showX) {
        g.fillStyle = COL.text;
        g.fillText(fmtTick(Math.pow(10, k)), x, r.y + r.h + 13);
      }
    }
    g.strokeStyle = COL.grid;
    g.textAlign = 'right';
    for (const v of linTicks(0, yHi, 5)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = COL.text;
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // T = 1 line and the sqrt(2) boundary
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(170,182,200,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x, mapY(1));
    g.lineTo(r.x + r.w, mapY(1));
    g.stroke();
    const xb = mapX(Math.SQRT2);
    g.strokeStyle = COL.marker;
    g.beginPath();
    g.moveTo(xb, r.y);
    g.lineTo(xb, r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(220,210,180,0.95)';
    g.textAlign = 'left';
    g.fillText('r = √2 (T = 1)', xb + 5, r.y + r.h - 8);
    // family curves
    for (let c = 0; c < iso.zetaList.length; c += 1) {
      g.strokeStyle = FAMILY_COLORS[c % FAMILY_COLORS.length]!;
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i < iso.r.length; i += 1) {
        const x = mapX(iso.r[i]!);
        const y = mapY(Math.min(iso.curves[c]![i]!, yHi));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // highlighted curve
    g.strokeStyle = COL.main;
    g.lineWidth = 2.2;
    g.beginPath();
    for (let i = 0; i < iso.hi.r.length; i += 1) {
      const x = mapX(iso.hi.r[i]!);
      const y = mapY(Math.min(iso.hi.T[i]!, yHi));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // operating point
    const xo = mapX(this.state.r0);
    const yo = mapY(Math.min(iso.t0, yHi));
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(xo, yo, 4, 0, Math.PI * 2);
    g.fill();
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(`T(r0) = ${fmtMetric(iso.t0)}`, clamp(xo, r.x + 55, r.x + r.w - 55), yo - 9);
    g.restore();
    // legend
    const lx = r.x + r.w - 92;
    let ly = r.y + 16;
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    for (let c = 0; c < iso.zetaList.length; c += 1) {
      g.strokeStyle = FAMILY_COLORS[c % FAMILY_COLORS.length]!;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 14, ly - 3);
      g.stroke();
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.fillText(`ζ = ${iso.zetaList[c]}`, lx + 19, ly);
      ly += 12;
    }
    g.strokeStyle = COL.main;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(lx, ly - 3);
    g.lineTo(lx + 14, ly - 3);
    g.stroke();
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(`ζ = ${fmtMetric(this.state.zetaIso)}`, lx + 19, ly);
  }

  /** Unbalance amplitude panel (normalized mX/(me·e), log r). */
  private drawUnbAmp(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const u = this.unbRes!;
    const zh = this.zh;
    const rLo = u.r[0]!;
    const rHi = u.r[u.r.length - 1]!;
    const logLo = Math.log10(rLo);
    const logHi = Math.log10(rHi);
    const yHi = u.peakExact * 1.3;
    const mapX = (rv: number): number => r.x + ((Math.log10(rv) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - (v / yHi) * r.h;
    drawFrame(g, r, 'm·X/(m_e·e)', 'r = ω/ωn (log)', 'mX/(me·e)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, 0, yHi, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // exact peak level 1/(2 zeta) at r = 1
    g.setLineDash([4, 4]);
    g.strokeStyle = COL.marker;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x, mapY(u.peakExact));
    g.lineTo(r.x + r.w, mapY(u.peakExact));
    g.stroke();
    const x1 = mapX(1);
    g.beginPath();
    g.moveTo(x1, r.y);
    g.lineTo(x1, r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = COL.main;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < u.r.length; i += 1) {
      const x = mapX(u.r[i]!);
      const y = mapY(u.ampNorm[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(x1, mapY(u.peakExact), 3.5, 0, Math.PI * 2);
    g.fill();
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(220,210,180,0.95)';
    g.fillText(`1/(2ζ) = ${fmtMetric(u.peakExact)}`, x1 + 6, mapY(u.peakExact) - 6);
    g.restore();
  }

  /** Shaft-orbit panel (normalized, equal aspect). */
  private drawOrbit(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const u = this.unbRes!;
    const zh = this.zh;
    const orb = u.orbit;
    let xLo = Infinity;
    let xHi = -Infinity;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (let i = 0; i < orb.x.length; i += 1) {
      xLo = Math.min(xLo, orb.x[i]!);
      xHi = Math.max(xHi, orb.x[i]!);
      yLo = Math.min(yLo, orb.y[i]!);
      yHi = Math.max(yHi, orb.y[i]!);
    }
    const span = Math.max(xHi - xLo, yHi - yLo, 1e-9) * 1.3;
    const cx = (xLo + xHi) / 2;
    const cy = (yLo + yHi) / 2;
    const side = Math.min(r.w, r.h) - 8;
    const ox = r.x + r.w / 2;
    const oy = r.y + r.h / 2;
    const mapX = (v: number): number => ox + ((v - cx) / span) * side;
    const mapY = (v: number): number => oy - ((v - cy) / span) * side;
    drawFrame(g, r, zh ? `轴心轨迹 (r = ${fmtMetric(this.state.rOp)}, κ = ${fmtMetric(this.state.kappa)})` : `Shaft orbit (r = ${fmtMetric(this.state.rOp)}, kappa = ${fmtMetric(this.state.kappa)})`, 'x', 'y', showX, zh);
    // center cross
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mapX(0), r.y);
    g.lineTo(mapX(0), r.y + r.h);
    g.moveTo(r.x, mapY(0));
    g.lineTo(r.x + r.w, mapY(0));
    g.stroke();
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.strokeStyle = COL.purple;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < orb.x.length; i += 1) {
      const x = mapX(orb.x[i]!);
      const y = mapY(orb.y[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(mapX(orb.x[0]!), mapY(orb.y[0]!), 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Unbalance phase panel with the exact 90 deg resonance marker. */
  private drawUnbPhase(g: CanvasRenderingContext2D, r: Rect, showX: boolean) {
    const u = this.unbRes!;
    const zh = this.zh;
    const rLo = u.r[0]!;
    const rHi = u.r[u.r.length - 1]!;
    const logLo = Math.log10(rLo);
    const logHi = Math.log10(rHi);
    const mapX = (rv: number): number => r.x + ((Math.log10(rv) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - 0) / 200) * r.h;
    drawFrame(g, r, zh ? '相位（滞后角，r=1 处恒为 90°）' : 'Phase (lag; exactly 90 deg at r = 1)', 'r = ω/ωn (log)', 'lag (°)', showX, zh);
    this.drawLogGrid(g, r, logLo, logHi, 0, 200, mapX, mapY, showX);
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.setLineDash([4, 4]);
    g.strokeStyle = COL.marker;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x, mapY(90));
    g.lineTo(r.x + r.w, mapY(90));
    g.stroke();
    const x1 = mapX(1);
    g.beginPath();
    g.moveTo(x1, r.y);
    g.lineTo(x1, r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = COL.green;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < u.r.length; i += 1) {
      const x = mapX(u.r[i]!);
      const y = mapY(u.phaseLagDeg[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = COL.marker;
    g.beginPath();
    g.arc(x1, mapY(90), 3.5, 0, Math.PI * 2);
    g.fill();
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(220,210,180,0.95)';
    g.fillText('90°', x1 + 6, mapY(90) - 6);
    g.restore();
  }

  // ---- footers ------------------------------------------------------------

  private drawFooterBase(g: CanvasRenderingContext2D, h: number, line1: string, line2: string) {
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = COL.text;
    g.fillText(line1, 16, h - 26);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(line2, 16, h - 10);
  }

  private drawFooterSdof(g: CanvasRenderingContext2D, h: number) {
    const r = this.sdofRes!;
    const zh = this.zh;
    const d = r.derived;
    const line1 = zh
      ? `SDOF：m = ${fmtMetric(r.p.m)} kg，k = ${fmtMetric(r.p.k)} N/m，c = ${fmtMetric(r.p.c)} N·s/m（RK4 步数 4800）`
      : `SDOF: m = ${fmtMetric(r.p.m)} kg, k = ${fmtMetric(r.p.k)} N/m, c = ${fmtMetric(r.p.c)} N*s/m (4800 RK4 steps)`;
    const zid = r.id.ok ? fmtMetric(r.id.zeta) : '—';
    const wnid = r.id.ok ? fmtMetric(r.id.wn) : '—';
    const line2 = `wn = ${fmtMetric(d.wn)} rad/s · fn = ${fmtMetric(d.wn / (2 * Math.PI))} Hz · zeta = ${fmtMetric(d.zeta)} · Q = ${Number.isFinite(d.Q) ? fmtMetric(d.Q) : '∞'} · zeta_id = ${zid} · wn_id = ${wnid} rad/s`;
    this.drawFooterBase(g, h, line1, line2);
  }

  private drawFooterMdof(g: CanvasRenderingContext2D, h: number) {
    const r = this.mdofRes!;
    const zh = this.zh;
    const line1 = zh ? `模型：${r.label} · Rayleigh 阻尼锚定 ω1/ω3，ζ = ${fmtMetric(this.state.zetaM)}` : `Model: ${r.label} · Rayleigh damping pinned at w1/w3, zeta = ${fmtMetric(this.state.zetaM)}`;
    const ws = [0, 1, 2]
      .slice(0, r.nShow)
      .map((i) => `w${i + 1} = ${fmtMetric(r.modes.omega[i]!)} rad/s`)
      .join(' · ');
    const line2 = `${ws} · zeta1 = ${fmtMetric(r.zetas[0]!)} · fn1 = ${fmtMetric(r.modes.omega[0]! / (2 * Math.PI))} Hz`;
    this.drawFooterBase(g, h, line1, line2);
  }

  private drawFooterFrf(g: CanvasRenderingContext2D, h: number) {
    const r = this.frfRes!;
    const zh = this.zh;
    const line1 = zh
      ? `来源：${r.label}${r.imported ? '（导入数据）' : ''} · 半功率点 = 峰值 −3.0103 dB`
      : `Source: ${r.label}${r.imported ? ' (imported)' : ''} · half-power = peak - 3.0103 dB`;
    const zid = r.id.ok ? fmtMetric(r.id.zeta) : '—';
    const wnid = r.id.ok ? fmtMetric(r.id.wn) : '—';
    const line2 = `wr = ${fmtMetric(r.id.wr)} rad/s · zeta_id = ${zid} · wn_id = ${wnid} rad/s · Q = ${r.id.ok ? fmtMetric(r.id.Q) : '—'}`;
    this.drawFooterBase(g, h, line1, line2);
  }

  private drawFooterIso(g: CanvasRenderingContext2D, h: number) {
    const r = this.isoRes!;
    const zh = this.zh;
    const line1 = zh
      ? `隔振：高亮 ζ = ${fmtMetric(this.state.zetaIso)} · 隔离区 r > √2（T < 1）`
      : `Isolation: highlighted zeta = ${fmtMetric(this.state.zetaIso)} · isolation region r > sqrt(2) (T < 1)`;
    const line2 = `T_max = ${fmtMetric(r.peak.tMax)} · 1/(2ζ) = ${fmtMetric(1 / (2 * this.state.zetaIso))} · r_peak = ${fmtMetric(r.peak.rPeak)} · T(r0) = ${fmtMetric(r.t0)} · eff = ${fmtMetric((1 - r.t0) * 100)} %`;
    this.drawFooterBase(g, h, line1, line2);
  }

  private drawFooterUnb(g: CanvasRenderingContext2D, h: number) {
    const r = this.unbRes!;
    const zh = this.zh;
    const line1 = zh
      ? `不平衡：F0 = me·e·ω² · 归一化幅值峰精确 1/(2ζ)（r = 1），相位恒 90°`
      : `Unbalance: F0 = me*e*w^2 · the normalized peak is exactly 1/(2*zeta) at r = 1 with exactly 90 deg phase`;
    const line2 = `peak = ${fmtMetric(r.peakNum)} (exact ${fmtMetric(r.peakExact)}) · r_peak = ${fmtMetric(r.peakR)} · phase(r=1) = ${fmtMetric(r.phaseAt1, 6)}° · orbit max = ${fmtMetric(r.orbitMax)}`;
    this.drawFooterBase(g, h, line1, line2);
  }
}

/** Local copy used when an identification result is required but unavailable. */
const HALF_POWER_NAN_COPY: HalfPowerId = {
  ok: false,
  wr: Number.NaN,
  wn: Number.NaN,
  zeta: Number.NaN,
  Q: Number.NaN,
  peakDb: Number.NaN,
  w1: Number.NaN,
  w2: Number.NaN,
};

function headerName(header: string[], idx: number): string {
  return header[idx] ?? '';
}

export function createEngVibrationPlugin(): Plugin {
  return new EngVibrationPlugin();
}

export default createEngVibrationPlugin;
