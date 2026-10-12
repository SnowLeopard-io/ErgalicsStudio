// ==========================================================================
// eng-truss — plane truss finite element laboratory
//
// Define nodes / elements / constraints / loads as JSON (panel text, file
// upload or the bundled sample), press Solve, and the plugin assembles the
// global stiffness matrix, condenses the constrained DOFs and solves for
// displacements with partial-pivot Gaussian elimination. The canvas shows
// the truss geometry with members coloured by axial force (tension +
// cyan, compression − red), support and load glyphs, and the deformed
// shape overlaid with an adjustable magnification factor.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { engTrussManifest } from './manifest';
import { trussFigurePanels } from './figure';
import {
  type TrussModel,
  type TrussResult,
  parseTrussModel,
  solveTruss,
} from './kernel';

export { engTrussManifest } from './manifest';

/** Default demo: 5-node simply supported truss bridge, 50 kN at mid-span. */
const DEFAULT_MODEL_TEXT = JSON.stringify({
  E: 2.0e11,
  A: 3.0e-3,
  nodes: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 8, y: 0 },
    { x: 2, y: 3 },
    { x: 6, y: 3 },
  ],
  elements: [
    { a: 0, b: 1, name: 'bottom-L' },
    { a: 1, b: 2, name: 'bottom-R' },
    { a: 3, b: 4, name: 'top' },
    { a: 0, b: 3, name: 'endpost-L' },
    { a: 3, b: 1, name: 'diag-L' },
    { a: 1, b: 4, name: 'diag-R' },
    { a: 4, b: 2, name: 'endpost-R' },
  ],
  constraints: [
    { node: 0, dx: true, dy: true },
    { node: 2, dy: true },
  ],
  loads: [{ node: 1, fx: 0, fy: -50000 }],
});

interface State {
  modelText: string;
  deformScale: number; // 0 = auto (fit ~8 % of the canvas)
}

export class EngTrussPlugin implements Plugin {
  readonly manifest = engTrussManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { modelText: DEFAULT_MODEL_TEXT, deformScale: 0 };
  private model: TrussModel | null = null;
  private result: TrussResult | null = null;
  private usedScale = 0;

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
    return [
      {
        key: 'model',
        label: 'Model (JSON)',
        labelI18n: { 'zh-CN': '模型（JSON：节点/单元/约束/载荷）', 'en-US': 'Model (JSON: nodes/elements/constraints/loads)' },
        type: 'text',
        value: this.state.modelText,
        placeholder: '{"E":2e11,"A":3e-3,"nodes":[…],"elements":[…],"constraints":[…],"loads":[…]}',
        hint: this.zh
          ? '节点表 + 单元表（可带 E/A）+ 约束表（dx/dy）+ 载荷表（fx/fy，N）'
          : 'node table + element table (optional E/A) + constraint table (dx/dy) + load table (fx/fy, N)',
      },
      {
        key: 'deformScale',
        label: 'Deform ×',
        labelI18n: { 'zh-CN': '变形放大系数', 'en-US': 'Deform magnification' },
        type: 'range',
        min: 0,
        max: 5000,
        step: 10,
        value: this.state.deformScale,
        hint: this.zh ? '0 = 自动（放大到画布约 8%）' : '0 = auto (fit ≈ 8 % of the canvas)',
      },
      actionButton('solve', 'Solve truss', '解算桁架', 'primary'),
      actionButton('exportNodes', 'Export node CSV', '导出节点 CSV'),
      actionButton('exportMembers', 'Export member CSV', '导出单元 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    if (typeof params.model === 'string' && params.model !== this.state.modelText) {
      this.state.modelText = params.model;
      redraw = true;
    }
    if (typeof params.deformScale === 'number' && Number.isFinite(params.deformScale)) {
      const v = Math.max(0, params.deformScale);
      if (v !== this.state.deformScale) {
        this.state.deformScale = v;
        redraw = true;
      }
    }
    if (actionFired(params, 'solve')) {
      this.solve(true);
      return;
    }
    if (actionFired(params, 'exportNodes')) this.exportNodes();
    if (actionFired(params, 'exportMembers')) this.exportMembers();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (redraw) {
      // Parameter edits only affect the display until the next explicit solve.
      if (this.model && this.result) this.computeScale();
      this.draw();
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.json')) {
      notify(this.api, 'warning', 'Truss plugin accepts JSON model files.', '桁架插件接受 JSON 模型文件。');
      return;
    }
    const text = await file.text();
    this.state.modelText = JSON.stringify(JSON.parse(text));
    this.solve(true);
  }

  /** Parse + solve the current model text; publishes outputs on success. */
  private solve(announce: boolean) {
    try {
      const model = parseTrussModel(this.state.modelText);
      const result = solveTruss(model);
      this.model = model;
      this.result = result;
      this.computeScale();
      this.publishOutputs(model, result);
      if (announce) {
        notify(
          this.api,
          'success',
          `Solved ${model.nodes.length} nodes / ${model.elements.length} members; max |u| = ${fmtMetric(result.maxDisplacement * 1e3)} mm`,
          `已解算 ${model.nodes.length} 个节点 / ${model.elements.length} 个单元；最大位移 ${fmtMetric(result.maxDisplacement * 1e3)} mm`,
        );
      }
    } catch (e) {
      this.model = null;
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      const msg = e instanceof Error ? e.message : String(e);
      notify(
        this.api,
        'error',
        e instanceof Error && e.name === 'TrussError' ? `Cannot solve: ${msg}` : `Invalid model: ${msg}`,
        e instanceof Error && e.name === 'TrussError' ? `无法解算：${msg}` : `模型无效：${msg}`,
      );
    }
    this.draw();
  }

  private computeScale() {
    const model = this.model;
    const result = this.result;
    if (!model || !result) return;
    if (this.state.deformScale > 0) {
      this.usedScale = this.state.deformScale;
      return;
    }
    // Auto: map the largest displacement onto ~8 % of the smaller canvas side.
    const canvas = this.ctx?.canvas2d;
    const side = Math.min(canvas?.clientWidth || 760, canvas?.clientHeight || 420);
    this.usedScale = result.maxDisplacement > 0 ? (0.08 * side) / result.maxDisplacement : 0;
  }

  private publishOutputs(model: TrussModel, result: TrussResult) {
    const totalLoad = model.loads.reduce((s, l) => s + Math.hypot(l.fx ?? 0, l.fy ?? 0), 0);
    const metrics: ScienceMetric[] = [
      {
        key: 'max-disp',
        label: 'max |u|',
        value: fmtMetric(result.maxDisplacement * 1e3),
        unit: 'mm',
        severity: 'info',
        hint: this.zh ? '所有节点位移幅值的最大值（FEM 解）' : 'largest displacement magnitude over all nodes (FEM)',
      },
      {
        key: 'max-tension',
        label: 'σ max,+',
        value: fmtMetric(result.maxTensionStress / 1e6),
        unit: 'MPa',
        severity: 'info',
        hint: this.zh ? '最大拉应力（轴力/截面积，拉为正）' : 'max tensile stress (axial force / area, tension positive)',
      },
      {
        key: 'max-compression',
        label: 'σ max,−',
        value: fmtMetric(result.maxCompressionStress / 1e6),
        unit: 'MPa',
        severity: 'info',
        hint: this.zh ? '最大压应力（≤0）' : 'max compressive stress (≤ 0)',
      },
    ];
    for (const r of result.reactions) {
      metrics.push({
        key: `react-${r.node}-${r.dof}`,
        label: `R(${r.node},${r.dof})`,
        value: fmtMetric(r.force),
        unit: 'N',
        severity: 'info',
        hint: this.zh ? '支座反力分量（K·u − f 在约束自由度处取值）' : 'support reaction component (K·u − f at the constrained DOF)',
      });
    }
    const residualMag = Math.hypot(result.equilibriumResidual.fx, result.equilibriumResidual.fy);
    const relResidual = residualMag / Math.max(totalLoad, 1e-12);
    metrics.push({
      key: 'equilibrium',
      label: 'ΣR+ΣF',
      value: fmtMetric(residualMag),
      unit: 'N',
      severity: relResidual < 1e-8 ? 'ok' : 'warn',
      hint: this.zh
        ? '平衡自检：反力之和 + 载荷之和 ≈ 0'
        : 'equilibrium self-check: Σ reactions + Σ loads ≈ 0',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportNodes() {
    if (!this.model || !this.result) {
      notify(this.api, 'warning', 'Solve the truss first.', '请先解算桁架。');
      return;
    }
    const rows: Array<Array<number | string>> = this.model.nodes.map((n, i) => {
      const u = this.result!.displacements[i]!;
      return [
        i,
        n.x,
        n.y,
        Number(u.x.toPrecision(8)),
        Number(u.y.toPrecision(8)),
        Number((Math.hypot(u.x, u.y) * 1e3).toPrecision(8)),
      ];
    });
    exportRowsCsv(this.api, 'truss-nodes', ['node', 'x_m', 'y_m', 'ux_m', 'uy_m', 'abs_mm'], rows);
  }

  private exportMembers() {
    if (!this.result) {
      notify(this.api, 'warning', 'Solve the truss first.', '请先解算桁架。');
      return;
    }
    const rows: Array<Array<number | string>> = this.result.elements.map((el) => [
      el.index,
      el.a,
      el.b,
      Number(el.length.toPrecision(8)),
      Number(el.axialForce.toPrecision(8)),
      Number((el.stress / 1e6).toPrecision(8)),
    ]);
    exportRowsCsv(this.api, 'truss-members', ['element', 'a', 'b', 'length_m', 'axial_N', 'stress_MPa'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.model || !this.result) {
      notify(this.api, 'warning', 'No solve yet — press "Solve truss" first.', '尚未解算 — 请先点击「解算桁架」。');
      return;
    }
    const r = this.result;
    const caption: Bilingual = {
      zh: `平面桁架 FEM 分析（${this.model.elements.length} 个单元）：最大位移 ${fmtMetric(r.maxDisplacement * 1e3)} mm，最大拉应力 ${fmtMetric(r.maxTensionStress / 1e6)} MPa，最大压应力 ${fmtMetric(r.maxCompressionStress / 1e6)} MPa。`,
      en: `Plane truss FEM analysis (${this.model.elements.length} members): max displacement ${fmtMetric(r.maxDisplacement * 1e3)} mm, max tensile stress ${fmtMetric(r.maxTensionStress / 1e6)} MPa, max compressive stress ${fmtMetric(r.maxCompressionStress / 1e6)} MPa.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '平面桁架有限元分析', en: 'Plane Truss FEM Analysis' },
      caption,
      trussFigurePanels(r),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.model || !this.result) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No truss solved',
        titleZh: '尚未解算桁架',
        hint: 'Paste a JSON model (nodes/elements/constraints/loads) and press "Solve truss", or load the sample bridge.',
        hintZh: '粘贴 JSON 模型（节点/单元/约束/载荷）并点击「解算桁架」，或载入示例桥梁模型。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.drawTruss(g, canvas);
  }

  private drawTruss(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const model = this.model!;
    const result = this.result!;
    const zh = this.zh;
    const w = canvas.width;
    const h = canvas.height;
    const scale = this.usedScale;

    // World bounds over the *undeformed* nodes only; the deformed overlay is
    // drawn as a screen-space offset so magnification never rescales the view.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const push = (x: number, y: number): void => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (const n of model.nodes) push(n.x, n.y);
    const pad = 56;
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);
    const plotW = w - 2 * pad;
    const plotH = h - 2 * pad - 20;
    const k = Math.min(plotW / spanX, plotH / spanY);
    const px = (x: number): number => pad + (x - minX) * k + (plotW - spanX * k) / 2;
    const py = (y: number): number => h - pad - 20 - (y - minY) * k - (plotH - spanY * k) / 2;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '平面桁架 FEM · 轴力着色 + 变形叠加' : 'Plane truss FEM · axial-force colours + deformed overlay', w / 2, 20);

    // Deformed shape first (under the undeformed members). The displacement
    // is applied in *screen* pixels (world offset × k, y flipped) so the
    // magnified shape stays anchored to the original geometry.
    if (scale > 0) {
      g.strokeStyle = 'rgba(120,220,190,0.55)';
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      for (const el of model.elements) {
        const a = model.nodes[el.a]!;
        const b = model.nodes[el.b]!;
        const ua = result.displacements[el.a]!;
        const ub = result.displacements[el.b]!;
        g.beginPath();
        g.moveTo(px(a.x) + ua.x * scale * k, py(a.y) - ua.y * scale * k);
        g.lineTo(px(b.x) + ub.x * scale * k, py(b.y) - ub.y * scale * k);
        g.stroke();
      }
      g.setLineDash([]);
    }

    // Members coloured by axial force: tension cyan, compression red,
    // line width by |N|/max|N|.
    let maxN = 0;
    for (const el of result.elements) maxN = Math.max(maxN, Math.abs(el.axialForce));
    for (const el of result.elements) {
      const a = model.nodes[el.a]!;
      const b = model.nodes[el.b]!;
      const rel = maxN > 0 ? Math.abs(el.axialForce) / maxN : 0;
      const color =
        Math.abs(el.axialForce) < 1e-9 * Math.max(maxN, 1)
          ? 'rgba(150,165,185,0.7)'
          : el.axialForce > 0
            ? `rgba(110,200,250,${0.55 + 0.4 * rel})`
            : `rgba(250,120,110,${0.55 + 0.4 * rel})`;
      g.strokeStyle = color;
      g.lineWidth = 1.2 + 2.2 * rel;
      g.beginPath();
      g.moveTo(px(a.x), py(a.y));
      g.lineTo(px(b.x), py(b.y));
      g.stroke();
    }

    // Supports: pin = filled triangle, roller = triangle on rollers.
    for (const c of model.constraints) {
      const n = model.nodes[c.node]!;
      const sx = px(n.x);
      const sy = py(n.y) + 10;
      g.fillStyle = 'rgba(250,205,120,0.95)';
      g.beginPath();
      g.moveTo(sx, sy - 8);
      g.lineTo(sx - 7, sy + 4);
      g.lineTo(sx + 7, sy + 4);
      g.closePath();
      g.fill();
      if (!(c.dx && c.dy)) {
        // Roller: two small circles under the triangle.
        g.strokeStyle = 'rgba(250,205,120,0.95)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(sx - 3, sy + 7, 2.5, 0, Math.PI * 2);
        g.arc(sx + 3, sy + 7, 2.5, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // Loads as arrows.
    for (const load of model.loads) {
      const fx = load.fx ?? 0;
      const fy = load.fy ?? 0;
      const mag = Math.hypot(fx, fy);
      if (mag <= 0) continue;
      const n = model.nodes[load.node]!;
      const ux = fx / mag;
      const uy = -fy / mag; // screen y is flipped
      const len = 18 + 14 * Math.min(1, mag / 5e4);
      const tx = px(n.x) - ux * len;
      const ty = py(n.y) - uy * len;
      g.strokeStyle = 'rgba(255,150,90,0.95)';
      g.fillStyle = 'rgba(255,150,90,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px(n.x), py(n.y));
      g.lineTo(tx, ty);
      g.stroke();
      const ang = Math.atan2(ty - py(n.y), tx - px(n.x));
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - 7 * Math.cos(ang - 0.4), ty - 7 * Math.sin(ang - 0.4));
      g.lineTo(tx - 7 * Math.cos(ang + 0.4), ty - 7 * Math.sin(ang + 0.4));
      g.closePath();
      g.fill();
      g.font = `10px Consolas, monospace`;
      g.textAlign = 'center';
      g.fillText(`${fmtLoad(mag)} N`, tx - ux * 12, ty - uy * 12 - 2);
    }

    // Nodes on top.
    g.font = `10px Consolas, monospace`;
    for (let i = 0; i < model.nodes.length; i += 1) {
      const n = model.nodes[i]!;
      g.beginPath();
      g.arc(px(n.x), py(n.y), 4, 0, Math.PI * 2);
      g.fillStyle = 'rgba(235,240,247,0.95)';
      g.fill();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.textAlign = 'center';
      g.fillText(`N${i}`, px(n.x) + 12, py(n.y) - 8);
    }

    // Legend.
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const ly0 = canvas.height - 44;
    g.fillStyle = 'rgba(110,200,250,0.95)';
    g.fillRect(pad, ly0, 18, 3);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(zh ? '拉（N > 0）' : 'tension (N > 0)', pad + 24, ly0 + 5);
    g.fillStyle = 'rgba(250,120,110,0.95)';
    g.fillRect(pad + 130, ly0, 18, 3);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(zh ? '压（N < 0）' : 'compression (N < 0)', pad + 154, ly0 + 5);
    if (scale > 0) {
      g.strokeStyle = 'rgba(120,220,190,0.55)';
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(pad + 290, ly0 + 1);
      g.lineTo(pad + 308, ly0 + 1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(170,182,200,0.95)';
      g.fillText(zh ? `变形 ×${fmtLoad(scale)}` : `deformed ×${fmtLoad(scale)}`, pad + 314, ly0 + 5);
    }

    // Footer summary.
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `最大位移 ${fmtMetric(result.maxDisplacement * 1e3)} mm · 最大拉应力 ${fmtMetric(result.maxTensionStress / 1e6)} MPa · 最大压应力 ${fmtMetric(result.maxCompressionStress / 1e6)} MPa`
      : `max |u| ${fmtMetric(result.maxDisplacement * 1e3)} mm · max tension ${fmtMetric(result.maxTensionStress / 1e6)} MPa · max compression ${fmtMetric(result.maxCompressionStress / 1e6)} MPa`;
    g.fillText(l2, pad, canvas.height - 10);
  }
}

/** Compact force/scale formatting (50000 → "50k"). */
function fmtLoad(v: number): string {
  const a = Math.abs(v);
  const trim = (x: number): string => String(Number(x.toPrecision(3)));
  if (a === 0) return '0';
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  if (a >= 1) return trim(v);
  return trim(v);
}

export default function createEngTrussPlugin(): Plugin {
  return new EngTrussPlugin();
}
