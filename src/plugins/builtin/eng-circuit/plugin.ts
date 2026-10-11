// ==========================================================================
// eng-circuit — DC circuit node analysis laboratory
//
// Paste (or upload) a JSON netlist of resistors and independent voltage /
// current sources, press Solve, and the plugin assembles the Modified Nodal
// Analysis system, solves it with partial-pivot Gaussian elimination and
// draws the node-branch topology graph annotated with the computed node
// voltages. The node-voltage table, source currents and power diagnostics
// export to CSV in one click; scientific outputs publish every node voltage,
// the total dissipated power and the Tellegen power-balance residual.
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
import { engCircuitManifest } from './manifest';
import {
  CircuitError,
  type MnaResult,
  type Netlist,
  parseNetlist,
  solveMna,
} from './kernel';

export { engCircuitManifest } from './manifest';

/** Default demo: 12 V source, R1 = 1 kΩ, R2 = R3 = 2 kΩ T-type ladder (v_mid = v_out = 8 V). */
const DEFAULT_NETLIST_TEXT = JSON.stringify({
  nodes: ['gnd', 'vcc', 'mid', 'out'],
  elements: [
    { type: 'V', from: 'vcc', to: 'gnd', value: 12, name: 'Vs' },
    { type: 'R', from: 'vcc', to: 'mid', value: 1000, name: 'R1' },
    { type: 'R', from: 'mid', to: 'gnd', value: 2000, name: 'R2' },
    { type: 'R', from: 'mid', to: 'out', value: 2000, name: 'R3' },
  ],
});

const ELEMENT_COLORS: Record<string, string> = {
  R: 'rgba(150,170,195,0.9)',
  V: 'rgba(250,205,120,0.95)',
  I: 'rgba(120,220,190,0.95)',
};

/** Compact engineering formatting for element values (1000 → "1k"). */
function fmtEng(v: number): string {
  const a = Math.abs(v);
  const trim = (x: number): string => String(Number(x.toPrecision(4)));
  if (a === 0) return '0';
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  if (a >= 1) return trim(v);
  if (a >= 1e-3) return `${trim(v * 1e3)}m`;
  return `${trim(v * 1e6)}µ`;
}

interface State {
  netlistText: string;
}

export class EngCircuitPlugin implements Plugin {
  readonly manifest = engCircuitManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { netlistText: DEFAULT_NETLIST_TEXT };
  private netlist: Netlist | null = null;
  private result: MnaResult | null = null;

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
        key: 'netlist',
        label: 'Netlist (JSON)',
        labelI18n: { 'zh-CN': '网表（JSON，可粘贴）', 'en-US': 'Netlist (JSON, paste here)' },
        type: 'text',
        value: this.state.netlistText,
        placeholder: '{"nodes":["gnd","a"],"elements":[{"type":"V","from":"a","to":"gnd","value":5}]}',
        hint: this.zh
          ? '节点数组 + R/V/I 元件数组；名为 gnd / 0 的节点为参考地'
          : 'nodes array + R/V/I element array; a node named gnd / 0 is the reference',
      },
      actionButton('solve', 'Solve circuit', '解算电路', 'primary'),
      actionButton('exportCsv', 'Export node CSV', '导出节点 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.netlist === 'string' && params.netlist !== this.state.netlistText) {
      this.state.netlistText = params.netlist;
    }
    if (actionFired(params, 'solve')) this.solve(true);
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.json')) {
      notify(this.api, 'warning', 'Circuit plugin accepts JSON netlists.', '电路插件接受 JSON 网表文件。');
      return;
    }
    const text = await file.text();
    this.state.netlistText = JSON.stringify(JSON.parse(text));
    this.solve(true);
  }

  /** Parse + solve the current netlist text; publishes outputs on success. */
  private solve(announce: boolean) {
    try {
      const netlist = parseNetlist(this.state.netlistText);
      const result = solveMna(netlist);
      this.netlist = netlist;
      this.result = result;
      this.publishOutputs(result);
      if (announce) {
        notify(
          this.api,
          'success',
          `Solved ${netlist.nodes.length} nodes, ${netlist.elements.length} elements; P dissip = ${fmtMetric(result.totalDissipatedPower)} W`,
          `已解算 ${netlist.nodes.length} 个节点、${netlist.elements.length} 个元件；耗散功率 ${fmtMetric(result.totalDissipatedPower)} W`,
        );
      }
    } catch (e) {
      this.netlist = null;
      this.result = null;
      clearScienceOutputs(this.manifest.id);
      const msg = e instanceof Error ? e.message : String(e);
      notify(
        this.api,
        'error',
        e instanceof CircuitError ? `Cannot solve: ${msg}` : `Invalid netlist: ${msg}`,
        e instanceof CircuitError ? `无法解算：${msg}` : `网表无效：${msg}`,
      );
    }
    this.draw();
  }

  private publishOutputs(result: MnaResult) {
    const metrics: ScienceMetric[] = result.nodeVoltages.map((nv) => ({
      key: `v-${nv.node}`,
      label: `V(${nv.node})`,
      value: fmtMetric(nv.voltage),
      unit: 'V',
      severity: 'info',
      hint: this.zh ? '改进节点法（MNA）解得的直流节点电压' : 'DC node voltage from Modified Nodal Analysis',
    }));
    for (const sc of result.sourceCurrents) {
      metrics.push({
        key: `i-${sc.name}`,
        label: `I(${sc.name})`,
        value: fmtMetric(sc.current),
        unit: 'A',
        severity: 'info',
        hint: this.zh ? '电压源支路电流（MNA 附加未知量，正=流入 + 端）' : 'V-source branch current (MNA auxiliary, positive = into the + terminal)',
      });
    }
    metrics.push({
      key: 'power-diss',
      label: 'P dissip',
      value: fmtMetric(result.totalDissipatedPower),
      unit: 'W',
      severity: 'info',
      hint: this.zh ? 'Σ (Δv)²/R，电阻总耗散功率' : 'Σ (Δv)²/R, total resistor dissipation',
    });
    const relBalance =
      result.totalDissipatedPower > 0
        ? Math.abs(result.powerBalance) / result.totalDissipatedPower
        : Math.abs(result.powerBalance);
    metrics.push({
      key: 'power-balance',
      label: 'P balance',
      value: fmtMetric(result.powerBalance),
      unit: 'W',
      severity: relBalance < 1e-8 ? 'ok' : 'warn',
      hint: this.zh
        ? 'Tellegen 定理残差：源产生 − 电阻耗散，应≈0（自检诊断）'
        : 'Tellegen residual: generated − dissipated, should be ≈ 0 (self-check)',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv() {
    if (!this.result) {
      notify(this.api, 'warning', 'Solve the circuit first.', '请先解算电路。');
      return;
    }
    const rows: Array<Array<number | string>> = this.result.nodeVoltages.map((nv) => [
      'node',
      nv.node,
      Number(nv.voltage.toPrecision(8)),
      'V',
    ]);
    for (const sc of this.result.sourceCurrents) {
      rows.push(['vsource-current', sc.name, Number(sc.current.toPrecision(8)), 'A']);
    }
    rows.push(['total-dissipated-power', '—', Number(this.result.totalDissipatedPower.toPrecision(8)), 'W']);
    rows.push(['power-balance-residual', '—', Number(this.result.powerBalance.toPrecision(8)), 'W']);
    exportRowsCsv(this.api, 'circuit-node-voltages', ['kind', 'name', 'value', 'unit'], rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.netlist || !this.result) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No circuit solved',
        titleZh: '尚未解算电路',
        hint: 'Paste a JSON netlist (nodes + R/V/I elements) and press "Solve circuit", or load the sample netlist.',
        hintZh: '粘贴 JSON 网表（节点 + R/V/I 元件）并点击「解算电路」，或载入示例网表。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    this.drawTopology(g, canvas);
  }

  /** Node-branch topology graph: circles for nodes, annotated edges, voltage labels. */
  private drawTopology(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const netlist = this.netlist!;
    const result = this.result!;
    const zh = this.zh;
    const w = canvas.width;
    const h = canvas.height;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '直流电路 · 节点电压拓扑' : 'DC circuit · node-voltage topology', w / 2, 20);

    const cx = w / 2;
    const cy = h / 2 + 8;
    const radius = Math.min(w, h) * 0.34;

    // Circular node layout in netlist order (ground included, drawn last).
    const positions = netlist.nodes.map((_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / netlist.nodes.length;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
    const posOf = new Map<string, { x: number; y: number }>();
    netlist.nodes.forEach((name, i) => posOf.set(name, positions[i]!));

    // Edges with element labels at midpoints.
    g.font = `11px Consolas, monospace`;
    for (const el of netlist.elements) {
      const pa = posOf.get(el.from)!;
      const pb = posOf.get(el.to)!;
      g.strokeStyle = ELEMENT_COLORS[el.type] ?? 'rgba(150,170,195,0.9)';
      g.lineWidth = el.type === 'R' ? 1.5 : 2;
      g.beginPath();
      g.moveTo(pa.x, pa.y);
      g.lineTo(pb.x, pb.y);
      g.stroke();
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const unit = el.type === 'R' ? 'Ω' : el.type === 'V' ? 'V' : 'A';
      g.fillStyle = ELEMENT_COLORS[el.type] ?? 'rgba(200,210,225,0.9)';
      g.textAlign = 'center';
      g.fillText(`${el.name} ${fmtEng(el.value)}${unit}`, mx, my - 4);
    }

    // Nodes with voltage annotations.
    const voltageOfNode = (name: string): number => {
      if (name.toLowerCase() === 'gnd' || name === '0') return 0;
      return result.nodeVoltages.find((nv) => nv.node === name)?.voltage ?? 0;
    };
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    netlist.nodes.forEach((name, i) => {
      const p = positions[i]!;
      const isGnd = name.toLowerCase() === 'gnd' || name === '0';
      const v = voltageOfNode(name);
      // Outward direction for the label.
      const dx = p.x - cx;
      const dy = p.y - cy;
      const norm = Math.hypot(dx, dy) || 1;
      const lx = p.x + (dx / norm) * 30;
      const ly = p.y + (dy / norm) * 30;

      g.beginPath();
      g.arc(p.x, p.y, isGnd ? 5 : 7, 0, Math.PI * 2);
      g.fillStyle = isGnd ? 'rgba(120,130,145,0.95)' : 'rgba(120,200,250,0.95)';
      g.fill();
      if (isGnd) {
        g.strokeStyle = 'rgba(120,130,145,0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p.x - 9, p.y + 10);
        g.lineTo(p.x + 9, p.y + 10);
        g.moveTo(p.x - 5, p.y + 14);
        g.lineTo(p.x + 5, p.y + 14);
        g.stroke();
      }
      g.fillStyle = isGnd ? 'rgba(170,182,200,0.95)' : 'rgba(230,238,248,0.95)';
      g.textAlign = 'center';
      g.fillText(isGnd ? `${name} = 0 V` : `${name} = ${fmtMetric(v)} V`, lx, ly);
    });

    // Footer summary.
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `MNA：${netlist.nodes.length - 1} 个节点电压 + ${result.sourceCurrents.length} 个源支路电流；总耗散 P = ${fmtMetric(result.totalDissipatedPower)} W`
      : `MNA: ${netlist.nodes.length - 1} node voltages + ${result.sourceCurrents.length} branch currents; total P = ${fmtMetric(result.totalDissipatedPower)} W`;
    g.fillText(l1, 16, h - 26);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `Tellegen 功率平衡残差 = ${fmtMetric(result.powerBalance)} W（≈0 为一致解）`
      : `Tellegen power-balance residual = ${fmtMetric(result.powerBalance)} W (≈ 0 for a consistent solve)`;
    g.fillText(l2, 16, h - 10);
  }
}

export default function createEngCircuitPlugin(): Plugin {
  return new EngCircuitPlugin();
}
