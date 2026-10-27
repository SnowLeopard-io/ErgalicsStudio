// ==========================================================================
// math-linalg — Linear Algebra Lab
//
// Four interactive 2×2 views over the current matrix A:
//   1. matrix action — the canonical unit grid drawn before and after A with
//      the unit square highlighted, plus |det| checked against the measured
//      area ratio (shoelace) of the transformed square;
//   2. eigen geometry — eigendirections and their stretched images λ·v for a
//      real pair, or the image ellipse of the unit circle for a complex one;
//   3. SVD chain — the unit circle pushed through Vᵀ, Σ and U step by step
//      until it becomes the image ellipse A·circle;
//   4. span & projection — a 2D/3D query vector projected onto the span of
//      the supplied basis vectors with its orthogonal residual.
//
// Numerics (LU determinant, closed-form eigenpairs, Jacobi SVD, MGS
// projection) live in kernel.ts; every view publishes its conclusions on the
// science output bus, and the panels can be pushed into Figure Studio.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { linalgFigurePanels } from './figure';
import { mathLinalgManifest } from './manifest';
import {
  determinant,
  determinant2x2,
  eigenvalues2x2,
  eigenvector2x2,
  frobeniusNorm,
  projectOntoSpan,
  runLinalgBenchmarks,
  SAMPLE_MATRICES,
  selectSample,
  svdJacobi,
  type ComplexNum,
  type Matrix,
} from './kernel';

export { mathLinalgManifest } from './manifest';

/** The four visualization modes of the lab. */
type Mode = 'transform' | 'eigen' | 'svd' | 'subspace';

interface State {
  mode: Mode;
  /** Selected SAMPLE_MATRICES id, or 'custom'. */
  sample: string;
  m11: number;
  m12: number;
  m21: number;
  m22: number;
  /** Basis vector u₁ (comma-separated components). */
  vec1: string;
  /** Optional basis vector u₂ — empty spans a line instead of a plane. */
  vec2: string;
  /** Query vector w projected onto the span. */
  query: string;
}

const MODE_META: Record<Mode, { en: string; zh: string }> = {
  transform: { en: 'Matrix transform & area', zh: '矩阵变换与面积' },
  eigen: { en: 'Eigen geometry', zh: '特征几何' },
  svd: { en: 'SVD chain', zh: 'SVD 分解链' },
  subspace: { en: 'Span & projection', zh: '张成与投影' },
};

// ---- small pure helpers (module scope, no DOM) --------------------------------

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Projector {
  p(x: number, y: number): [number, number];
  /** Visible data half-span along x / y inside the frame. */
  halfX: number;
  halfY: number;
}

/** Data → pixel mapping with square pixels centred in the frame. */
function makeProjector(frame: Frame, half: number): Projector {
  const s = Math.min(frame.w, frame.h) / (2 * Math.max(half, 1e-6));
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return {
    p: (x, y) => [cx + x * s, cy - y * s],
    halfX: frame.w / (2 * s),
    halfY: frame.h / (2 * s),
  };
}

/** A = [[a, b], [c, d]] acting on a point. */
function applyA(m: Matrix, x: number, y: number): [number, number] {
  return [m[0]![0]! * x + m[0]![1]! * y, m[1]![0]! * x + m[1]![1]! * y];
}

/** Parse a 2- or 3-component vector from a comma/space separated string. */
function parseVec(text: string): number[] | null {
  const parts = text.split(/[,，;；\s]+/).filter((t) => t.length > 0);
  if (parts.length < 2 || parts.length > 3) return null;
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Relative closeness test |a − b| ≤ tol·max(1, |b|). */
function near(a: number, b: number, tol = 1e-12): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

/** Format a possibly complex scalar as `a`, `bi` or `a ± bi`. */
function fmtComplex(l: ComplexNum): string {
  const re = Math.abs(l.re) < 1e-12 ? 0 : l.re;
  const im = Math.abs(l.im) < 1e-12 ? 0 : l.im;
  if (im === 0) return fmtMetric(re);
  if (re === 0) return `${fmtMetric(im)}i`;
  return `${fmtMetric(re)} ${im < 0 ? '−' : '+'} ${fmtMetric(Math.abs(im))}i`;
}

/** Normalized eigen defect ‖A·v − λ·v‖₂ / (‖A‖_F·‖v‖₂) for a 2×2 pair. */
function eigenResidualNorm(m: Matrix, lam: ComplexNum, v: ComplexNum[]): number {
  let rn2 = 0;
  let vn2 = 0;
  for (let i = 0; i < 2; i += 1) {
    const vr = v[i]!;
    vn2 += vr.re * vr.re + vr.im * vr.im;
    let rr = 0;
    let ri = 0;
    for (let j = 0; j < 2; j += 1) {
      const a = m[i]![j]!;
      const vj = v[j]!;
      rr += a * vj.re;
      ri += a * vj.im;
    }
    rr -= lam.re * vr.re - lam.im * vr.im;
    ri -= lam.re * vr.im + lam.im * vr.re;
    rn2 += rr * rr + ri * ri;
  }
  return Math.sqrt(rn2) / (frobeniusNorm(m) * Math.sqrt(vn2));
}

/** ‖MᵀM − I‖_F — orthogonality defect of a row-major factor matrix. */
function orthoDefect(m: Matrix): number {
  const n = m.length;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let d = i === j ? 1 : 0;
      for (let k = 0; k < n; k += 1) d -= m[k]![i]! * m[k]![j]!;
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

/** Isometric embedding of a 3D vector for the projection panel. */
function isoPt(v: number[]): [number, number] {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  return [(x - y) * 0.866, (x + y) * 0.5 - z];
}

// ---- canvas helpers -------------------------------------------------------------

function drawFrame(g: CanvasRenderingContext2D, frame: Frame): void {
  g.fillStyle = 'rgba(255,255,255,0.03)';
  g.fillRect(frame.x, frame.y, frame.w, frame.h);
  g.strokeStyle = 'rgba(150,165,190,0.28)';
  g.lineWidth = 1;
  g.strokeRect(frame.x + 0.5, frame.y + 0.5, frame.w - 1, frame.h - 1);
}

/** Clip subsequent drawing to a frame; call the returned fn to restore. */
function clipTo(g: CanvasRenderingContext2D, frame: Frame): () => void {
  g.save();
  g.beginPath();
  g.rect(frame.x, frame.y, frame.w, frame.h);
  g.clip();
  return () => g.restore();
}

/** Faint integer lattice plus origin axes, adaptive step for wide views. */
function drawGrid(g: CanvasRenderingContext2D, pr: Projector, half: number): void {
  const step = Math.max(1, Math.ceil(half / 5));
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(120,140,170,0.16)';
  g.beginPath();
  const xEnd = Math.floor(pr.halfX / step) * step;
  for (let k = -xEnd; k <= xEnd + 1e-9; k += step) {
    const [x0, y0] = pr.p(k, -pr.halfY);
    const [x1, y1] = pr.p(k, pr.halfY);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  const yEnd = Math.floor(pr.halfY / step) * step;
  for (let k = -yEnd; k <= yEnd + 1e-9; k += step) {
    const [x0, y0] = pr.p(-pr.halfX, k);
    const [x1, y1] = pr.p(pr.halfX, k);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  g.stroke();
  g.strokeStyle = 'rgba(170,185,210,0.45)';
  g.beginPath();
  const [ax0, ay0] = pr.p(-pr.halfX, 0);
  const [ax1, ay1] = pr.p(pr.halfX, 0);
  g.moveTo(ax0, ay0);
  g.lineTo(ax1, ay1);
  const [bx0, by0] = pr.p(0, -pr.halfY);
  const [bx1, by1] = pr.p(0, pr.halfY);
  g.moveTo(bx0, by0);
  g.lineTo(bx1, by1);
  g.stroke();
}

/** Faint axes with orange arrowheads at the positive ends (SVD stages). */
function drawAxisArrows(g: CanvasRenderingContext2D, pr: Projector): void {
  g.strokeStyle = 'rgba(170,185,210,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  const [lx0, ly0] = pr.p(-pr.halfX, 0);
  const [lx1, ly1] = pr.p(pr.halfX, 0);
  g.moveTo(lx0, ly0);
  g.lineTo(lx1, ly1);
  const [vx0, vy0] = pr.p(0, -pr.halfY);
  const [vx1, vy1] = pr.p(0, pr.halfY);
  g.moveTo(vx0, vy0);
  g.lineTo(vx1, vy1);
  g.stroke();
  const [cx, cy] = pr.p(0, 0);
  const [ax, ay] = pr.p(pr.halfX * 0.97, 0);
  const [bx, by] = pr.p(0, pr.halfY * 0.97);
  arrow(g, cx, cy, ax, ay, 'rgba(245,166,35,0.9)', 1.5);
  arrow(g, cx, cy, bx, by, 'rgba(245,166,35,0.9)', 1.5);
}

function strokePoly(
  g: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  color: string,
  width = 1.5,
  dash?: number[],
): void {
  if (pts.length === 0) return;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash(dash ?? []);
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
  g.restore();
}

function fillPoly(g: CanvasRenderingContext2D, pts: Array<[number, number]>, color: string): void {
  if (pts.length === 0) return;
  g.fillStyle = color;
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fill();
}

/** Straight arrow from (x0, y0) to (x1, y1) with a two-barb head. */
function arrow(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(10, len * 0.35);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.moveTo(x1, y1);
  g.lineTo(x1 - (ux * 0.9 - uy * 0.45) * head, y1 - (uy * 0.9 + ux * 0.45) * head);
  g.moveTo(x1, y1);
  g.lineTo(x1 - (ux * 0.9 + uy * 0.45) * head, y1 - (uy * 0.9 - ux * 0.45) * head);
  g.stroke();
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 11): void {
  g.fillStyle = color;
  g.font = `${size}px 'Microsoft YaHei', Consolas, monospace`;
  g.textAlign = 'left';
  g.fillText(text, x, y);
}

/** Closed unit square (5 points, back to the start). */
const SQUARE: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

// ---- plugin ---------------------------------------------------------------------

export class MathLinalgPlugin implements Plugin {
  readonly manifest = mathLinalgManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'transform',
    sample: SAMPLE_MATRICES[0]!.id,
    m11: SAMPLE_MATRICES[0]!.matrix[0]![0]!,
    m12: SAMPLE_MATRICES[0]!.matrix[0]![1]!,
    m21: SAMPLE_MATRICES[0]!.matrix[1]![0]!,
    m22: SAMPLE_MATRICES[0]!.matrix[1]![1]!,
    vec1: '1,1',
    vec2: '',
    query: '3,2',
  };

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
    const modeOptions = (Object.keys(MODE_META) as Mode[]).map((k) => ({
      value: k,
      label: this.zh ? MODE_META[k].zh : MODE_META[k].en,
      labelI18n: { 'zh-CN': MODE_META[k].zh, 'en-US': MODE_META[k].en },
    }));
    const sampleOptions = [
      ...SAMPLE_MATRICES.map((s) => ({
        value: s.id,
        label: this.zh ? s.labelZh : s.labelEn,
        labelI18n: { 'zh-CN': s.labelZh, 'en-US': s.labelEn },
      })),
      {
        value: 'custom',
        label: this.zh ? '自定义（编辑下方元素）' : 'Custom (edit entries below)',
        labelI18n: { 'zh-CN': '自定义（编辑下方元素）', 'en-US': 'Custom (edit entries below)' },
      },
    ];
    const entry = (key: 'm11' | 'm12' | 'm21' | 'm22', en: string, zh: string): ParamDefinition => ({
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'number',
      min: -10,
      max: 10,
      step: 0.01,
      value: this.state[key],
      hint: this.zh
        ? '矩阵 A = [[a₁₁, a₁₂], [a₂₁, a₂₂]]；修改任一元素即切换为自定义样本'
        : 'matrix A = [[a₁₁, a₁₂], [a₂₁, a₂₂]]; editing any entry switches to the custom sample',
    });
    return [
      {
        key: 'mode',
        label: 'View mode',
        labelI18n: { 'zh-CN': '视图模式', 'en-US': 'View mode' },
        type: 'select',
        options: modeOptions,
        value: this.state.mode,
      },
      {
        key: 'sample',
        label: 'Sample matrix',
        labelI18n: { 'zh-CN': '样本矩阵', 'en-US': 'Sample matrix' },
        type: 'select',
        options: sampleOptions,
        value: this.state.sample,
      },
      entry('m11', 'a₁₁ (row 1, col 1)', 'a₁₁（第 1 行 第 1 列）'),
      entry('m12', 'a₁₂ (row 1, col 2)', 'a₁₂（第 1 行 第 2 列）'),
      entry('m21', 'a₂₁ (row 2, col 1)', 'a₂₁（第 2 行 第 1 列）'),
      entry('m22', 'a₂₂ (row 2, col 2)', 'a₂₂（第 2 行 第 2 列）'),
      {
        key: 'vec1',
        label: 'Basis vector u₁',
        labelI18n: { 'zh-CN': '基向量 u₁', 'en-US': 'Basis vector u₁' },
        type: 'text',
        value: this.state.vec1,
        placeholder: '1,1  or  1,2,3',
        hint: this.zh
          ? '逗号分隔 2 或 3 个分量；3 分量按等轴测 3D 绘制'
          : '2 or 3 comma-separated components; 3 components draw isometrically',
      },
      {
        key: 'vec2',
        label: 'Basis vector u₂ (empty = line)',
        labelI18n: { 'zh-CN': '基向量 u₂（留空为直线）', 'en-US': 'Basis vector u₂ (empty = line)' },
        type: 'text',
        value: this.state.vec2,
        placeholder: '0,1',
        hint: this.zh ? '留空则由 u₁ 张成一条直线而非平面' : 'leave empty to span a line instead of a plane',
      },
      {
        key: 'query',
        label: 'Query vector w',
        labelI18n: { 'zh-CN': '查询向量 w', 'en-US': 'Query vector w' },
        type: 'text',
        value: this.state.query,
        placeholder: '3,2',
        hint: this.zh
          ? '被投影到 span(u₁, u₂) 上的向量；分量数须与 u₁ 一致'
          : 'vector projected onto span(u₁, u₂); component count must match u₁',
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;

    // numeric entries first: any real edit switches the sample to custom
    const numKeys: Array<'m11' | 'm12' | 'm21' | 'm22'> = ['m11', 'm12', 'm21', 'm22'];
    for (const key of numKeys) {
      const v = params[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const x = Math.min(10, Math.max(-10, v));
      if (x === s[key]) continue;
      s[key] = x;
      s.sample = 'custom';
      changed = true;
    }

    // vector strings
    for (const key of ['vec1', 'vec2', 'query'] as const) {
      const v = params[key];
      if (typeof v === 'string' && v !== s[key]) {
        s[key] = v;
        changed = true;
      }
    }

    // sample select (applied after numbers so a preset always wins on restore)
    if (typeof params.sample === 'string' && params.sample !== s.sample) {
      const preset = params.sample === 'custom' ? null : selectSample(params.sample);
      if (params.sample === 'custom' || preset) {
        s.sample = params.sample;
        if (preset) {
          s.m11 = preset.matrix[0]![0]!;
          s.m12 = preset.matrix[0]![1]!;
          s.m21 = preset.matrix[1]![0]!;
          s.m22 = preset.matrix[1]![1]!;
        }
        changed = true;
      }
    }

    if (typeof params.mode === 'string' && params.mode in MODE_META && params.mode !== s.mode) {
      s.mode = params.mode as Mode;
      changed = true;
    }

    if (changed) this.draw();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions -------------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runLinalgBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} linear-algebra benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项线性代数基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Push the four publication-grade panels into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const parsed = this.parseSubspace();
    if (!parsed.ok) {
      notify(
        this.api,
        'warning',
        'Vector input invalid — u₁/w need 2 or 3 matching comma-separated components.',
        '向量输入无效——u₁/w 需为逗号分隔且维度一致的 2 或 3 个分量。',
      );
      return;
    }
    const m = this.matrix();
    const det = determinant(m);
    const { sigma } = svdJacobi(m);
    const res = norm(parsed.proj.residual);
    const caption: Bilingual = {
      zh: `线性代数面板：A = [[${fmtMetric(m[0]![0]!)}, ${fmtMetric(m[0]![1]!)}], [${fmtMetric(m[1]![0]!)}, ${fmtMetric(m[1]![1]!)}]]，det = ${fmtMetric(det)}，σ = [${fmtMetric(sigma[0] ?? 0)}, ${fmtMetric(sigma[1] ?? 0)}]，span 维度 ${parsed.proj.dimension}，‖w − p‖ = ${fmtMetric(res)}。`,
      en: `Linear algebra panels: A = [[${fmtMetric(m[0]![0]!)}, ${fmtMetric(m[0]![1]!)}], [${fmtMetric(m[1]![0]!)}, ${fmtMetric(m[1]![1]!)}]], det = ${fmtMetric(det)}, σ = [${fmtMetric(sigma[0] ?? 0)}, ${fmtMetric(sigma[1] ?? 0)}], span dimension ${parsed.proj.dimension}, ‖w − p‖ = ${fmtMetric(res)}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '线性代数可视化', en: 'Linear Algebra Panels' },
      caption,
      linalgFigurePanels({ matrix: m, basis: parsed.basis, query: parsed.query }),
    );
  }

  // ---- input parsing ---------------------------------------------------------------

  private matrix(): Matrix {
    const s = this.state;
    return [
      [s.m11, s.m12],
      [s.m21, s.m22],
    ];
  }

  /** Parse query + basis vectors and run the MGS projection, or report why not. */
  private parseSubspace():
    | { ok: true; query: number[]; basis: number[][]; proj: ReturnType<typeof projectOntoSpan> }
    | { ok: false } {
    const q = parseVec(this.state.query);
    const b1 = parseVec(this.state.vec1);
    const raw2 = this.state.vec2.trim();
    const b2 = raw2.length > 0 ? parseVec(raw2) : null;
    if (!q || !b1 || q.length < 2 || q.length > 3) return { ok: false };
    if (b1.length !== q.length) return { ok: false };
    if (raw2.length > 0 && (!b2 || b2.length !== q.length)) return { ok: false };
    const basis = b2 ? [b1, b2] : [b1];
    return { ok: true, query: q, basis, proj: projectOntoSpan(q, basis) };
  }

  // ---- drawing -----------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const m = this.matrix();
    let footer: string;
    switch (this.state.mode) {
      case 'eigen':
        footer = this.renderEigen(g, canvas, m, zh);
        break;
      case 'svd':
        footer = this.renderSvd(g, canvas, m, zh);
        break;
      case 'subspace':
        footer = this.renderSubspace(g, canvas, zh);
        break;
      default:
        footer = this.renderTransform(g, canvas, m, zh);
        break;
    }

    // bilingual title + footer
    const meta = MODE_META[this.state.mode];
    const A = `[[${fmtMetric(m[0]![0]!)}, ${fmtMetric(m[0]![1]!)}], [${fmtMetric(m[1]![0]!)}, ${fmtMetric(m[1]![1]!)}]]`;
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(`${zh ? '线性代数实验室' : 'Linear Algebra Lab'} · ${zh ? meta.zh : meta.en} · A = ${A}`, canvas.width / 2, 18);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(footer, 20, canvas.height - 14);
  }

  /** ① grid before/after A + ⑤ |det| as the area scaling factor. */
  private renderTransform(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, m: Matrix, zh: boolean): string {
    const gap = 40;
    const panelW = Math.max(240, (canvas.width - 48 - gap) / 2);
    const panelH = Math.max(200, canvas.height - 100);
    const frameL: Frame = { x: 24, y: 44, w: panelW, h: panelH };
    const frameR: Frame = { x: 24 + panelW + gap, y: 44, w: panelW, h: panelH };
    const half = 2.6;

    // canonical grid window −2..2 plus the closed unit square
    const grid: Array<Array<[number, number]>> = [];
    for (let k = -2; k <= 2; k += 1) {
      grid.push([
        [-2, k],
        [2, k],
      ]);
      grid.push([
        [k, -2],
        [k, 2],
      ]);
    }

    // left: the grid before the action of A
    drawFrame(g, frameL);
    const endL = clipTo(g, frameL);
    const prL = makeProjector(frameL, half);
    drawGrid(g, prL, half);
    for (const line of grid) strokePoly(g, line.map(([x, y]) => prL.p(x, y)), 'rgba(109,180,255,0.5)', 1);
    fillPoly(g, SQUARE.map(([x, y]) => prL.p(x, y)), 'rgba(75,225,195,0.16)');
    strokePoly(g, SQUARE.map(([x, y]) => prL.p(x, y)), '#4be1c3', 2);
    label(g, zh ? '变换前 · 单位网格' : 'before A · unit grid', frameL.x + 10, frameL.y + 18, 'rgba(235,240,247,0.92)', 12);
    endL();

    // right: the same grid pushed through A
    drawFrame(g, frameR);
    const endR = clipTo(g, frameR);
    const prR = makeProjector(frameR, half);
    drawGrid(g, prR, half);
    const img = (p: [number, number]): [number, number] => {
      const [x, y] = applyA(m, p[0], p[1]);
      return prR.p(x, y);
    };
    for (const line of grid) strokePoly(g, line.map(img), 'rgba(255,178,80,0.55)', 1);
    fillPoly(g, SQUARE.map(img), 'rgba(255,122,122,0.18)');
    strokePoly(g, SQUARE.map(img), '#ff7a7a', 2);
    label(g, zh ? '变换后 · A 作用' : 'after A · image', frameR.x + 10, frameR.y + 18, 'rgba(235,240,247,0.92)', 12);
    endR();

    // ⑤ determinant vs the measured area ratio of the transformed square
    const detLU = determinant(m);
    const detCF = determinant2x2(m[0]![0]!, m[0]![1]!, m[1]![0]!, m[1]![1]!);
    let area2 = 0;
    const mapped = SQUARE.slice(0, 4).map(([x, y]) => applyA(m, x, y));
    for (let i = 0; i < 4; i += 1) {
      const [x0, y0] = mapped[i]!;
      const [x1, y1] = mapped[(i + 1) % 4]!;
      area2 += x0 * y1 - x1 * y0;
    }
    const ratio = Math.abs(area2) / 2;
    const metrics: ScienceMetric[] = [
      {
        key: 'determinant',
        label: zh ? 'det(A)（LU 部分主元）' : 'det(A) (LU pivoting)',
        value: fmtMetric(detLU),
        severity: near(detLU, detCF) ? 'ok' : 'error',
        hint: zh
          ? `闭式 ad − bc = ${fmtMetric(detCF)}；与 LU 值的相对差 ${fmtMetric(Math.abs(detLU - detCF) / Math.max(1, Math.abs(detCF)))}`
          : `closed form ad − bc = ${fmtMetric(detCF)}; relative gap to LU value ${fmtMetric(Math.abs(detLU - detCF) / Math.max(1, Math.abs(detCF)))}`,
      },
      {
        key: 'area-ratio',
        label: zh ? '实测面积比 vs |det|' : 'Measured area ratio vs |det|',
        value: `${fmtMetric(ratio)} / ${fmtMetric(Math.abs(detLU))}`,
        severity: near(ratio, Math.abs(detLU)) ? 'ok' : 'error',
        hint: zh
          ? '单位方块经 A 变换前后的鞋带面积比，理论值为 |det A|'
          : 'shoelace area ratio of the unit square before/after A; theory gives |det A|',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);

    const preset = selectSample(this.state.sample);
    const sampleTxt = preset
      ? zh
        ? `（样本：${preset.labelZh}）`
        : ` (sample: ${preset.labelEn})`
      : zh
        ? '（自定义矩阵）'
        : ' (custom matrix)';
    return zh
      ? `单位方块（青）→ A·方块（红）；面积比 ${fmtMetric(ratio)} ≈ |det| = ${fmtMetric(Math.abs(detLU))}${sampleTxt}`
      : `unit square (teal) → A·square (red); area ratio ${fmtMetric(ratio)} ≈ |det| = ${fmtMetric(Math.abs(detLU))}${sampleTxt}`;
  }

  /** ② eigendirections and the stretch factors λ. */
  private renderEigen(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, m: Matrix, zh: boolean): string {
    const infoW = Math.min(260, Math.max(190, Math.round(canvas.width * 0.3)));
    const panelH = Math.max(200, canvas.height - 100);
    const frame: Frame = { x: 24, y: 44, w: canvas.width - 48 - infoW - 16, h: panelH };
    const infoX = frame.x + frame.w + 16;

    const [l1, l2] = eigenvalues2x2(m[0]![0]!, m[0]![1]!, m[1]![0]!, m[1]![1]!);
    const v1 = eigenvector2x2(m[0]![0]!, m[0]![1]!, m[1]![0]!, m[1]![1]!, l1);
    const v2 = eigenvector2x2(m[0]![0]!, m[0]![1]!, m[1]![0]!, m[1]![1]!, l2);
    const real = Math.abs(l1.im) < 1e-12 && Math.abs(l2.im) < 1e-12;

    // view span covering the unit-square image and the eigen-arrows
    let half = 2;
    for (const [x, y] of SQUARE) {
      const [ax, ay] = applyA(m, x, y);
      half = Math.max(half, Math.abs(ax), Math.abs(ay));
    }
    if (real) {
      for (const [lam, v] of [
        [l1, v1],
        [l2, v2],
      ] as Array<[ComplexNum, [ComplexNum, ComplexNum]]>) {
        half = Math.max(half, Math.abs(lam.re * v[0].re), Math.abs(lam.re * v[1].re));
      }
    }
    half = Math.min(half * 1.3, 60);

    drawFrame(g, frame);
    const end = clipTo(g, frame);
    const pr = makeProjector(frame, half);
    drawGrid(g, pr, half);

    // image of the unit square under A
    fillPoly(g, SQUARE.map(([x, y]) => pr.p(...applyA(m, x, y))), 'rgba(109,180,255,0.10)');
    strokePoly(g, SQUARE.map(([x, y]) => pr.p(...applyA(m, x, y))), 'rgba(109,180,255,0.85)', 1.6);

    if (real) {
      const pairs: Array<[ComplexNum, [ComplexNum, ComplexNum], string, string, string]> = [
        [l1, v1, '#6db4ff', '#ff7a7a', '₁'],
        [l2, v2, '#4be1c3', '#f5a623', '₂'],
      ];
      const [ox, oy] = pr.p(0, 0);
      for (const [lam, v, dirColor, imgColor, tag] of pairs) {
        const [vx0, vy0] = pr.p(v[0].re, v[1].re);
        arrow(g, ox, oy, vx0, vy0, dirColor, 2);
        const [ix0, iy0] = pr.p(lam.re * v[0].re, lam.re * v[1].re);
        arrow(g, ox, oy, ix0, iy0, imgColor, 2.4);
        label(
          g,
          zh ? `v${tag} → λ${tag}·v${tag}（λ = ${fmtMetric(lam.re)}）` : `v${tag} → λ${tag}·v${tag} (λ = ${fmtMetric(lam.re)})`,
          Math.min(ix0 + 8, frame.x + frame.w - 150),
          Math.max(iy0 - 6, frame.y + 34),
          imgColor,
          11,
        );
      }
    } else {
      // no real eigendirections: the unit circle maps onto an ellipse
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 96; k += 1) {
        const t = (2 * Math.PI * k) / 96;
        pts.push(pr.p(...applyA(m, Math.cos(t), Math.sin(t))));
      }
      strokePoly(g, pts, '#ff7a7a', 2);
      label(g, zh ? '单位圆的像 · 椭圆' : 'image of unit circle · ellipse', frame.x + 10, frame.y + 34, '#ff7a7a', 11);
    }
    end();

    // right-hand info column (clipped so long lines never spill)
    const infoFrame: Frame = { x: infoX - 10, y: 44, w: canvas.width - infoX + 4, h: panelH };
    const endInfo = clipTo(g, infoFrame);
    let iy = 66;
    const line = (text: string, color: string, size = 12): void => {
      label(g, text, infoX, iy, color, size);
      iy += 19;
    };
    line(zh ? '特征值与特征方向' : 'Eigenpairs', 'rgba(240,244,250,0.95)', 13);
    line(`λ₁ = ${fmtComplex(l1)}`, '#6db4ff');
    if (real) line(`v₁ = (${fmtMetric(v1[0].re)}, ${fmtMetric(v1[1].re)})`, 'rgba(205,215,232,0.95)');
    line(`λ₂ = ${fmtComplex(l2)}`, '#4be1c3');
    if (real) line(`v₂ = (${fmtMetric(v2[0].re)}, ${fmtMetric(v2[1].re)})`, 'rgba(205,215,232,0.95)');
    if (!real) line(zh ? '共轭复对 · 无实特征方向' : 'complex pair · no real direction', '#ffb250');
    const res = Math.max(
      eigenResidualNorm(m, l1, v1),
      eigenResidualNorm(m, l2, v2),
    );
    line(
      zh ? `残差 = ${fmtMetric(res)}` : `residual = ${fmtMetric(res)}`,
      res <= 1e-12 ? '#4be1c3' : '#ff7a7a',
    );
    line(zh ? '（‖Av − λv‖/‖A‖‖v‖）' : '(‖Av − λv‖/‖A‖‖v‖)', 'rgba(150,165,190,0.9)', 11);
    endInfo();

    setScienceOutputs(this.manifest.id, [
      {
        key: 'lambda-1',
        label: 'λ₁',
        value: fmtComplex(l1),
        severity: 'ok',
        hint: real
          ? zh
            ? `单位特征向量 v₁ = (${fmtMetric(v1[0].re)}, ${fmtMetric(v1[1].re)})；拉伸因子 λ₁`
            : `unit eigenvector v₁ = (${fmtMetric(v1[0].re)}, ${fmtMetric(v1[1].re)}); stretch factor λ₁`
          : zh
            ? '共轭复特征值，实平面上没有特征方向'
            : 'complex conjugate eigenvalue; no eigendirection in the real plane',
      },
      {
        key: 'lambda-2',
        label: 'λ₂',
        value: fmtComplex(l2),
        severity: 'ok',
        hint: real
          ? zh
            ? `单位特征向量 v₂ = (${fmtMetric(v2[0].re)}, ${fmtMetric(v2[1].re)})；拉伸因子 λ₂`
            : `unit eigenvector v₂ = (${fmtMetric(v2[0].re)}, ${fmtMetric(v2[1].re)}); stretch factor λ₂`
          : zh
            ? '与 λ₁ 构成共轭对'
            : 'conjugate partner of λ₁',
      },
      {
        key: 'eigen-residual',
        label: zh ? '特征残差 ‖Av − λv‖/(‖A‖·‖v‖)' : 'Eigen residual ‖Av − λv‖/(‖A‖·‖v‖)',
        value: fmtMetric(res),
        severity: res <= 1e-12 ? 'ok' : 'error',
        hint: zh ? '闭式 2×2 特征对的相对残差，应低于 1e-12' : 'relative residual of the closed-form 2×2 eigenpairs, should stay below 1e-12',
      },
    ]);

    if (real) {
      return zh
        ? '青/绿箭头为单位特征方向 v₁/v₂，红/橙为像 λ·v（长度 = 拉伸因子）'
        : 'teal/green = unit eigendirections v₁/v₂, red/orange = images λ·v (length = stretch factor)';
    }
    return zh ? 'A 无实特征方向：单位圆的像为椭圆（红）' : 'no real eigendirection: the unit circle maps onto an ellipse (red)';
  }

  /** ③ the three-step map A = U·Σ·Vᵀ applied to the unit circle. */
  private renderSvd(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, m: Matrix, zh: boolean): string {
    const { U, sigma, V } = svdJacobi(m);
    const s1 = sigma[0] ?? 0;
    const s2 = sigma[1] ?? 0;
    const half = Math.max(1, s1) * 1.35;

    const circle: Array<[number, number]> = [];
    const stage2: Array<[number, number]> = [];
    const stage3: Array<[number, number]> = [];
    const stage4: Array<[number, number]> = [];
    for (let k = 0; k <= 96; k += 1) {
      const t = (2 * Math.PI * k) / 96;
      const c = Math.cos(t);
      const s = Math.sin(t);
      circle.push([c, s]);
      const rx = V[0]![0]! * c + V[1]![0]! * s;
      const ry = V[0]![1]! * c + V[1]![1]! * s;
      stage2.push([rx, ry]);
      const sx = s1 * rx;
      const sy = s2 * ry;
      stage3.push([sx, sy]);
      stage4.push([U[0]![0]! * sx + U[0]![1]! * sy, U[1]![0]! * sx + U[1]![1]! * sy]);
    }
    const stages: Array<{ pts: Array<[number, number]>; color: string; zh: string; en: string }> = [
      { pts: circle, color: '#4be1c3', zh: '1 单位圆', en: '1 unit circle' },
      { pts: stage2, color: '#6db4ff', zh: '2 经 Vᵀ 旋转', en: '2 after Vᵀ' },
      { pts: stage3, color: '#ffb250', zh: '3 经 Σ 拉伸', en: '3 after Σ' },
      { pts: stage4, color: '#ff7a7a', zh: '4 经 U = A·圆', en: '4 after U = A·circle' },
    ];

    const gap = 12;
    const panelW = Math.max(120, (canvas.width - 32 - gap * 3) / 4);
    const panelH = Math.max(180, canvas.height - 110);
    stages.forEach((st, i) => {
      const frame: Frame = { x: 16 + i * (panelW + gap), y: 50, w: panelW, h: panelH };
      drawFrame(g, frame);
      const end = clipTo(g, frame);
      const pr = makeProjector(frame, half);
      drawAxisArrows(g, pr);
      strokePoly(g, st.pts.map(([x, y]) => pr.p(x, y)), st.color, 2);
      label(g, zh ? st.zh : st.en, frame.x + 8, frame.y + 18, 'rgba(235,240,247,0.92)', 11);
      end();
    });

    const defect = Math.max(orthoDefect(U), orthoDefect(V));
    const cond = s2 > 0 ? s1 / s2 : Infinity;
    const condTxt = s2 > 0 ? fmtMetric(cond) : zh ? '∞（奇异）' : '∞ (singular)';
    setScienceOutputs(this.manifest.id, [
      {
        key: 'sigma',
        label: zh ? '奇异值 σ₁ ≥ σ₂' : 'Singular values σ₁ ≥ σ₂',
        value: `${fmtMetric(s1)}, ${fmtMetric(s2)}`,
        severity: 'ok',
        hint: zh ? 'Jacobi SVD，按降序排列；σ₁ 为最大拉伸，σ₂ 为最小拉伸' : 'Jacobi SVD in descending order; σ₁ is the maximal, σ₂ the minimal stretch',
      },
      {
        key: 'cond',
        label: zh ? '条件数 cond(A) = σ₁/σ₂' : 'Condition number cond(A) = σ₁/σ₂',
        value: condTxt,
        severity: s2 > 0 && cond < 1e12 ? 'ok' : 'info',
        hint: zh ? 'σ₂ = 0 时矩阵奇异，条件数发散' : 'the matrix is singular and the condition number diverges when σ₂ = 0',
      },
      {
        key: 'svd-ortho',
        label: zh ? '正交误差 max(‖UᵀU−I‖, ‖VVᵀ−I‖)' : 'Orthogonality max(‖UᵀU−I‖, ‖VVᵀ−I‖)',
        value: fmtMetric(defect),
        severity: defect <= 1e-12 ? 'ok' : 'error',
        hint: zh ? 'Jacobi 旋转保持正交性，应低于 1e-12' : 'Jacobi rotations preserve orthogonality; should stay below 1e-12',
      },
    ]);

    return zh
      ? `A = U·Σ·Vᵀ：单位圆 → Vᵀ → Σ → U；σ 降序 = [${fmtMetric(s1)}, ${fmtMetric(s2)}]`
      : `A = U·Σ·Vᵀ: unit circle → Vᵀ → Σ → U; σ descending = [${fmtMetric(s1)}, ${fmtMetric(s2)}]`;
  }

  /** ④ span of the basis vectors plus the orthogonal projection of w. */
  private renderSubspace(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): string {
    const parsed = this.parseSubspace();
    if (!parsed.ok) {
      clearScienceOutputs(this.manifest.id);
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh
          ? '向量无法解析：u₁ / u₂ / w 需为逗号分隔的 2 或 3 个分量，且维度一致'
          : 'Cannot parse vectors: u₁ / u₂ / w need 2 or 3 comma-separated components with matching dimensions',
        canvas.width / 2,
        canvas.height / 2,
      );
      return zh ? '等待有效的向量输入' : 'awaiting valid vector input';
    }
    const { query, basis, proj } = parsed;
    const threeD = query.length === 3;
    const toData = threeD ? isoPt : (v: number[]): [number, number] => [v[0] ?? 0, v[1] ?? 0];

    const infoW = Math.min(260, Math.max(190, Math.round(canvas.width * 0.3)));
    const panelH = Math.max(200, canvas.height - 100);
    const frame: Frame = { x: 24, y: 44, w: canvas.width - 48 - infoW - 16, h: panelH };
    const infoX = frame.x + frame.w + 16;

    // view span over the query, projection and basis vectors
    let half = 2;
    const track = (v: number[]): void => {
      const [x, y] = toData(v);
      half = Math.max(half, Math.abs(x), Math.abs(y));
    };
    track(query);
    track(proj.projection);
    for (const b of basis) track(b);

    // span shapes scaled to fill the view, then re-measured
    const ts = basis.map((b) => (half * 0.85) / Math.max(norm(b), 1e-9));
    const spanPts: Array<Array<[number, number]>> = [];
    if (proj.dimension >= 2 && basis.length >= 2 && basis[0] && basis[1]) {
      const u1 = basis[0].map((x) => x * ts[0]!);
      const u2 = basis[1].map((x) => x * ts[1]!);
      const corners: number[][] = [];
      for (const c1 of [-1, 1]) {
        for (const c2 of [-1, 1]) {
          corners.push([0, 1, 2].map((k) => c1 * (u1[k] ?? 0) + c2 * (u2[k] ?? 0)));
        }
      }
      const closed = [...corners, corners[0]!];
      spanPts.push(closed.map(toData));
      for (const c of corners) track(c);
    } else if (basis[0]) {
      const len = Math.max(norm(basis[0]), 1e-9);
      const tip = basis[0].map((x) => (x * half * 0.9) / len);
      spanPts.push([toData(tip.map((x) => -x)), toData(tip)]);
      track(tip);
    }
    half = Math.min(half * 1.3, 40);

    drawFrame(g, frame);
    const end = clipTo(g, frame);
    const pr = makeProjector(frame, half);
    drawGrid(g, pr, half);

    // span (line or plane) first, so every arrow sits on top of it
    for (const pts of spanPts) {
      fillPoly(g, pts.map(([x, y]) => pr.p(x, y)), 'rgba(75,225,195,0.10)');
      strokePoly(g, pts.map(([x, y]) => pr.p(x, y)), '#4be1c3', 1.6);
    }
    const [ox, oy] = pr.p(0, 0);
    const seg = (v: number[]): [number, number] => {
      const [x, y] = toData(v);
      return pr.p(x, y);
    };
    const [u1x, u1y] = seg(basis[0]!);
    arrow(g, ox, oy, u1x, u1y, '#6db4ff', 2);
    if (basis[1] && proj.dimension >= 2) {
      const [u2x, u2y] = seg(basis[1]);
      arrow(g, ox, oy, u2x, u2y, '#ffb250', 2);
    }
    const [wx, wy] = seg(query);
    arrow(g, ox, oy, wx, wy, '#f5a623', 2.4);
    const [pxy, pyy] = seg(proj.projection);
    arrow(g, ox, oy, pxy, pyy, '#ff7a7a', 2.4);
    strokePoly(
      g,
      [seg(proj.projection), seg(query)],
      '#ff7a7a',
      2,
      [4, 3],
    );
    label(
      g,
      threeD ? (zh ? '等轴测 3D 视图' : 'isometric 3D view') : zh ? '二维平面视图' : '2D plane view',
      frame.x + 10,
      frame.y + 34,
      'rgba(150,165,190,0.95)',
      11,
    );
    end();

    const nw = norm(query);
    const np = norm(proj.projection);
    const nr = norm(proj.residual);
    // <p, w − p>: projection dotted with the orthogonal residual (theory: 0)
    let ip = 0;
    for (let i = 0; i < query.length; i += 1) ip += proj.projection[i]! * proj.residual[i]!;

    // right-hand info column
    const infoFrame: Frame = { x: infoX - 10, y: 44, w: canvas.width - infoX + 4, h: panelH };
    const endInfo = clipTo(g, infoFrame);
    let iy = 66;
    const line = (text: string, color: string, size = 12): void => {
      label(g, text, infoX, iy, color, size);
      iy += 19;
    };
    line(zh ? '子空间与投影' : 'Span & projection', 'rgba(240,244,250,0.95)', 13);
    line(zh ? `张成维度 = ${proj.dimension}` : `span dimension = ${proj.dimension}`, '#4be1c3');
    line(`w = (${query.map((x) => fmtMetric(x)).join(', ')})`, '#f5a623');
    line(`p = (${proj.projection.map((x) => fmtMetric(x)).join(', ')})`, '#ff7a7a');
    line(`‖w‖ = ${fmtMetric(nw)}`, 'rgba(205,215,232,0.95)');
    line(`‖p‖ = ${fmtMetric(np)}`, 'rgba(205,215,232,0.95)');
    line(`‖w − p‖ = ${fmtMetric(nr)}`, '#ff7a7a');
    line(`⟨p, w−p⟩ = ${fmtMetric(ip)}`, Math.abs(ip) <= 1e-10 * Math.max(1, nw * nw) ? '#4be1c3' : '#ff7a7a');
    if (proj.coordinates.length > 0) {
      line(`坐标 = [${proj.coordinates.map((x) => fmtMetric(x)).join(', ')}]`, 'rgba(150,165,190,0.95)', 11);
    }
    endInfo();

    setScienceOutputs(this.manifest.id, [
      {
        key: 'span-dim',
        label: zh ? '张成维度 dim(span)' : 'Span dimension dim(span)',
        value: String(proj.dimension),
        severity: 'ok',
        hint: zh
          ? '基向量经修正 Gram–Schmidt 正交化后保留的独立方向数（相关方向被丢弃）'
          : 'independent directions kept after modified Gram–Schmidt orthonormalization (dependent directions dropped)',
      },
      {
        key: 'proj-norm',
        label: zh ? '‖p‖（投影长度）' : '‖p‖ (projection length)',
        value: fmtMetric(np),
        severity: 'ok',
        hint: zh ? 'w 在子空间上的正交投影 p 的欧氏范数' : 'Euclidean norm of the projection p of w onto the subspace',
      },
      {
        key: 'residual-norm',
        label: zh ? '‖w − p‖（正交残差）' : '‖w − p‖ (orthogonal residual)',
        value: fmtMetric(nr),
        severity: 'ok',
        hint: zh ? '垂直于子空间的分量；‖w‖² = ‖p‖² + ‖w − p‖²' : 'component perpendicular to the subspace; ‖w‖² = ‖p‖² + ‖w − p‖²',
      },
      {
        key: 'orthogonality',
        label: zh ? '⟨p, w − p⟩（正交性）' : '⟨p, w − p⟩ (orthogonality)',
        value: fmtMetric(Math.abs(ip)),
        severity: Math.abs(ip) <= 1e-10 * Math.max(1, nw * nw) ? 'ok' : 'error',
        hint: zh ? '投影与残差的内积，理论上为 0' : 'inner product of projection and residual; theoretically zero',
      },
    ]);

    if (threeD) {
      return zh
        ? `等轴测 3D：span 维度 ${proj.dimension}；红实线 = p，红虚线 = 正交残差 w − p`
        : `isometric 3D: span dimension ${proj.dimension}; solid red = p, dashed red = residual w − p`;
    }
    return proj.dimension >= 2
      ? zh
        ? `span 为平面（维度 2）；红实线 = 投影 p，红虚线 = 正交残差 w − p`
        : 'span is a plane (dimension 2); solid red = projection p, dashed red = residual w − p'
      : zh
        ? `span 为直线（维度 1）；红实线 = 投影 p，红虚线 = 正交残差 w − p`
        : 'span is a line (dimension 1); solid red = projection p, dashed red = residual w − p';
  }
}

export default function createMathLinalgPlugin(): Plugin {
  return new MathLinalgPlugin();
}
