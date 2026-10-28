// ==========================================================================
// netproto — Network Protocol Simulator
//
// TCP three-way handshake / teardown, the TLS 1.3 1-RTT flight and a discrete
// Reno congestion-window trace. Scenario JSON drives the same engine used by
// Block/Flow; all times are in RTTs, not seconds.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  drawAxes,
  drawFootnote,
  drawHeader,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { netProtoFigurePanels } from './figure';
import { netProtoManifest } from './manifest';
import {
  DEFAULT_NET_SCENARIO,
  congestionTrace,
  parseScenario,
  rtoSample,
  runNetProtocolBenchmarks,
  simulateScenario,
  tcpHandshake,
  tls13Handshake,
  type CongestionTrace,
  type HandshakeResult,
  type NetScenario,
  type RtoSample,
} from './kernel';

export { netProtoManifest } from './manifest';

type ProtocolId = 'tcp' | 'tls13' | 'reno';
type ViewId = 'timeline' | 'congestion' | 'rto';

export class NetProtocolPlugin implements Plugin {
  readonly manifest = netProtoManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state = {
    protocol: DEFAULT_NET_SCENARIO.protocol as ProtocolId,
    view: 'timeline' as ViewId,
    rounds: DEFAULT_NET_SCENARIO.rounds,
    initialCwnd: DEFAULT_NET_SCENARIO.initialCwnd,
    initialSsthresh: DEFAULT_NET_SCENARIO.initialSsthresh,
    lossAt: DEFAULT_NET_SCENARIO.lossAt.join(','),
    fast: DEFAULT_NET_SCENARIO.fastRetransmit,
    rttSamples: DEFAULT_NET_SCENARIO.rttSamples.join(','),
    clientIsn: DEFAULT_NET_SCENARIO.clientIsn,
    serverIsn: DEFAULT_NET_SCENARIO.serverIsn,
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
    const s = this.state;
    return [
      {
        key: 'protocol',
        label: 'Protocol',
        labelI18n: { 'zh-CN': '协议', 'en-US': 'Protocol' },
        type: 'select',
        options: [
          { value: 'tcp', label: this.zh ? 'TCP 握手/挥手' : 'TCP handshake / teardown' },
          { value: 'tls13', label: 'TLS 1.3' },
          { value: 'reno', label: 'TCP Reno congestion control' },
        ],
        value: s.protocol,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'timeline', label: this.zh ? '报文时间线' : 'Message timeline' },
          { value: 'congestion', label: this.zh ? '拥塞窗口' : 'Congestion window' },
          { value: 'rto', label: this.zh ? 'RTT / RTO 估计' : 'RTT / RTO estimation' },
        ],
        value: s.view,
      },
      { key: 'rounds', label: 'Rounds', labelI18n: { 'zh-CN': 'RTT 轮数', 'en-US': 'Rounds' }, type: 'range', min: 2, max: 40, step: 1, value: s.rounds, visibleWhen: { key: 'protocol', in: ['reno'] } },
      { key: 'initialCwnd', label: 'Initial cwnd (MSS)', labelI18n: { 'zh-CN': '初始 cwnd（MSS）', 'en-US': 'Initial cwnd (MSS)' }, type: 'range', min: 1, max: 20, step: 1, value: s.initialCwnd, visibleWhen: { key: 'protocol', in: ['reno'] } },
      { key: 'initialSsthresh', label: 'Initial ssthresh (MSS)', labelI18n: { 'zh-CN': '初始 ssthresh（MSS）', 'en-US': 'Initial ssthresh (MSS)' }, type: 'range', min: 2, max: 64, step: 1, value: s.initialSsthresh, visibleWhen: { key: 'protocol', in: ['reno'] } },
      { key: 'lossAt', label: 'Loss RTTs (comma separated)', labelI18n: { 'zh-CN': '丢包 RTT（逗号分隔）', 'en-US': 'Loss RTTs (comma separated)' }, type: 'text', value: s.lossAt, visibleWhen: { key: 'protocol', in: ['reno'] } },
      { key: 'fast', label: 'Fast retransmit (Reno)', labelI18n: { 'zh-CN': '快速重传（Reno）', 'en-US': 'Fast retransmit (Reno)' }, type: 'checkbox', value: s.fast, visibleWhen: { key: 'protocol', in: ['reno'] } },
      { key: 'rttSamples', label: 'RTT samples (s)', labelI18n: { 'zh-CN': 'RTT 样本（秒）', 'en-US': 'RTT samples (s)' }, type: 'text', value: s.rttSamples },
      { key: 'clientIsn', label: 'Client ISN', labelI18n: { 'zh-CN': '客户端 ISN', 'en-US': 'Client ISN' }, type: 'number', step: 1, value: s.clientIsn, visibleWhen: { key: 'protocol', in: ['tcp'] } },
      { key: 'serverIsn', label: 'Server ISN', labelI18n: { 'zh-CN': '服务器 ISN', 'en-US': 'Server ISN' }, type: 'number', step: 1, value: s.serverIsn, visibleWhen: { key: 'protocol', in: ['tcp'] } },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export simulation CSV', '导出模拟 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if ((params.protocol === 'tcp' || params.protocol === 'tls13' || params.protocol === 'reno') && params.protocol !== this.state.protocol) {
      this.state.protocol = params.protocol as ProtocolId;
      this.state.view = params.protocol === 'reno' ? 'congestion' : 'timeline';
      changed = true;
    }
    if (typeof params.view === 'string' && ['timeline', 'congestion', 'rto'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      changed = true;
    }
    for (const key of ['rounds', 'initialCwnd', 'initialSsthresh', 'clientIsn', 'serverIsn'] as const) {
      if (typeof params[key] === 'number' && Number.isFinite(params[key])) {
        const v = Math.trunc(params[key] as number);
        if (v !== this.state[key]) {
          this.state[key] = v;
          changed = true;
        }
      }
    }
    if (typeof params.lossAt === 'string' && params.lossAt !== this.state.lossAt) {
      this.state.lossAt = params.lossAt;
      changed = true;
    }
    if (typeof params.rttSamples === 'string' && params.rttSamples !== this.state.rttSamples) {
      this.state.rttSamples = params.rttSamples;
      changed = true;
    }
    if (typeof params.fast === 'boolean' && params.fast !== this.state.fast) {
      this.state.fast = params.fast;
      changed = true;
    }
    if (actionFired(params, 'benchmark')) {
      this.runBenchmark();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const scenario = parseScenario(await file.text());
    this.state.protocol = scenario.protocol;
    this.state.rounds = scenario.rounds;
    this.state.initialCwnd = scenario.initialCwnd;
    this.state.initialSsthresh = scenario.initialSsthresh;
    this.state.lossAt = scenario.lossAt.join(',');
    this.state.fast = scenario.fastRetransmit;
    this.state.rttSamples = scenario.rttSamples.join(',');
    this.state.clientIsn = scenario.clientIsn;
    this.state.serverIsn = scenario.serverIsn;
    this.state.view = scenario.protocol === 'reno' ? 'congestion' : 'timeline';
    this.draw();
    notify(this.api, 'success', `Loaded a ${scenario.protocol} scenario from ${file.name}.`, `已从 ${file.name} 载入 ${scenario.protocol} 场景。`);
  }

  compute(input: unknown) {
    if (typeof input === 'string') {
      return Promise.resolve({ ok: true as const, output: simulateScenario(parseScenario(input)) });
    }
    return Promise.resolve({ ok: true as const, output: simulateScenario(this.scenario()) });
  }

  // ---- model -----------------------------------------------------------------

  private scenario(): NetScenario {
    return {
      protocol: this.state.protocol,
      clientIsn: this.state.clientIsn,
      serverIsn: this.state.serverIsn,
      rounds: this.state.rounds,
      initialCwnd: this.state.initialCwnd,
      initialSsthresh: this.state.initialSsthresh,
      lossAt: parseNumberList(this.state.lossAt),
      rttSamples: parseNumberList(this.state.rttSamples).filter((v) => v > 0),
      fastRetransmit: this.state.fast,
    };
  }

  private congestion(): CongestionTrace {
    const scenario = this.scenario();
    return congestionTrace({
      rounds: scenario.rounds,
      initialCwnd: scenario.initialCwnd,
      initialSsthresh: scenario.initialSsthresh,
      lossAt: scenario.lossAt,
      fastRetransmit: scenario.fastRetransmit,
    });
  }

  private handshake(): HandshakeResult {
    if (this.state.protocol === 'tls13') return tls13Handshake();
    return tcpHandshake(this.state.clientIsn, this.state.serverIsn);
  }

  private rto(): RtoSample[] {
    const samples = parseNumberList(this.state.rttSamples).filter((v) => v > 0);
    return rtoSample(samples.length ? samples : DEFAULT_NET_SCENARIO.rttSamples);
  }

  private runBenchmark() {
    const bench = runNetProtocolBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: `${b.measured} / ${b.expected}`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0 ? `All ${bench.length} network-protocol benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项网络协议基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    if (this.state.view === 'congestion' || this.state.protocol === 'reno') {
      const trace = this.congestion();
      exportRowsCsv(
        this.api,
        'reno-congestion',
        ['round', 'cwnd_mss', 'ssthresh_mss', 'phase', 'loss'],
        trace.steps.map((s) => [s.round, s.cwnd, s.ssthresh, s.phase, s.loss ? 1 : 0]),
      );
      return;
    }
    if (this.state.view === 'rto') {
      exportRowsCsv(
        this.api,
        'rtt-rto',
        ['sample_s', 'srtt_s', 'rttvar_s', 'rto_s'],
        this.rto().map((r) => [r.sample, Number(r.srtt.toFixed(6)), Number(r.rttvar.toFixed(6)), Number(r.rto.toFixed(6))]),
      );
      return;
    }
    const handshake = this.handshake();
    exportRowsCsv(
      this.api,
      'protocol-timeline',
      ['index', 'time_rtt', 'from', 'to', 'flag', 'seq', 'ack', 'encrypted'],
      handshake.steps.map((s) => [s.index, s.time, s.from, s.to, s.flag, s.seq ?? '', s.ack ?? '', s.encrypted ? 1 : 0]),
    );
  }

  private async sendToFigure() {
    const trace = this.congestion();
    const rto = this.rto();
    const handshake = this.handshake();
    const caption: Bilingual = {
      zh: `网络协议模拟：${this.state.protocol === 'reno' ? 'Reno' : this.state.protocol.toUpperCase()}；${handshake.steps.length} 条报文；峰值 cwnd ${trace.peak} MSS，丢包轮次 ${trace.losses.join(', ') || '无'}；最终 RTO ${(rto.at(-1)?.rto ?? 0).toFixed(3)} s。`,
      en: `Network protocol simulation: ${this.state.protocol === 'reno' ? 'Reno' : this.state.protocol.toUpperCase()}; ${handshake.steps.length} messages; peak cwnd ${trace.peak} MSS, loss rounds ${trace.losses.join(', ') || 'none'}; final RTO ${(rto.at(-1)?.rto ?? 0).toFixed(3)} s.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '网络协议模拟', en: 'Network Protocol Simulation' },
      caption,
      netProtoFigurePanels({ trace, rto, handshake }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    this.publish();
    drawHeader(
      g,
      w,
      this.zh ? '网络协议模拟器' : 'Network Protocol Simulator',
      this.state.protocol === 'reno'
        ? this.zh
          ? `Reno 拥塞控制 · ${this.state.rounds} RTT · cwnd₀=${this.state.initialCwnd} MSS`
          : `Reno congestion control · ${this.state.rounds} RTT · cwnd₀=${this.state.initialCwnd} MSS`
        : this.state.protocol === 'tls13'
          ? 'TLS 1.3 · 1-RTT handshake'
          : this.zh
            ? 'TCP 三次握手 · 报文序列'
            : 'TCP three-way handshake · message sequence',
      this.zh,
    );
    if (this.state.view === 'congestion') this.drawCongestion(g, w, h);
    else if (this.state.view === 'rto') this.drawRto(g, w, h);
    else this.drawTimeline(g, w, h);
  }

  private publish() {
    const trace = this.congestion();
    const rto = this.rto();
    const handshake = this.handshake();
    const metrics: ScienceMetric[] = [
      { key: 'messages', label: 'Messages', value: String(handshake.steps.length), unit: 'record', severity: 'info', hint: this.state.protocol.toUpperCase() },
      { key: 'completion', label: 'Completion time', value: fmtMetric(handshake.rtts), unit: 'RTT', severity: 'ok' },
      { key: 'peak-cwnd', label: 'Peak cwnd', value: String(trace.peak), unit: 'MSS', severity: 'info', hint: `initial ssthresh ${this.state.initialSsthresh}` },
      { key: 'losses', label: 'Loss events', value: String(trace.losses.length), unit: 'event', severity: trace.losses.length ? 'warn' : 'ok', hint: trace.losses.length ? `RTT ${trace.losses.join(', ')}` : 'none' },
      { key: 'rto', label: 'Final RTO', value: fmtMetric(rto.at(-1)?.rto ?? 0), unit: 's', severity: 'info', hint: 'SRTT + max(G, 4·RTTVAR)' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawTimeline(g: CanvasRenderingContext2D, w: number, h: number) {
    const handshake = this.handshake();
    const box = plotBox(w, h, 80, 86, 86, 54);
    const clientX = box.x0 + box.w * 0.2;
    const serverX = box.x0 + box.w * 0.8;
    g.strokeStyle = 'rgba(166,180,201,0.35)';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(clientX, box.y0);
    g.lineTo(clientX, box.y1);
    g.moveTo(serverX, box.y0);
    g.lineTo(serverX, box.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = CS.text;
    g.font = font(false, 11, '700');
    g.textAlign = 'center';
    g.fillText('CLIENT', clientX, box.y0 - 14);
    g.fillText('SERVER', serverX, box.y0 - 14);
    const rowH = box.h / Math.max(1, handshake.steps.length);
    handshake.steps.forEach((step, i) => {
      const y = box.y0 + rowH * (i + 0.5);
      const from = step.from === 'client' ? clientX : serverX;
      const to = step.from === 'client' ? serverX : clientX;
      const color = step.encrypted ? CS.violet : step.flag.includes('SYN') ? CS.amber : step.flag.includes('ACK') ? CS.blue : CS.cyan;
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(from, y);
      g.lineTo(to, y);
      g.stroke();
      const dir = Math.sign(to - from);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(to, y);
      g.lineTo(to - dir * 8, y - 4.5);
      g.lineTo(to - dir * 8, y + 4.5);
      g.closePath();
      g.fill();
      const labelX = (from + to) / 2;
      g.font = font(false, 9.5, '600');
      g.textAlign = 'center';
      g.fillStyle = color;
      g.fillText(`${step.encrypted ? '🔒 ' : ''}${step.flag}`, labelX, y - 5);
      g.font = font(false, 8);
      g.fillStyle = CS.faint;
      const extra = [step.seq !== undefined ? `seq=${step.seq}` : '', step.ack !== undefined ? `ack=${step.ack}` : ''].filter(Boolean).join(' ');
      if (extra) g.fillText(extra, labelX, y + 11);
      g.textAlign = 'left';
      g.fillStyle = CS.faint;
      g.font = font(false, 8);
      g.fillText(`t=${step.time.toFixed(1)} RTT`, box.x1 - 54, y + 3);
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `${this.state.protocol === 'tls13' ? '🔒 表示由握手/应用密钥保护的 TLS 记录；' : ''}时间单位为 RTT。`
        : `${this.state.protocol === 'tls13' ? '🔒 marks records protected by handshake/application keys; ' : ''}times are in RTTs.`,
      this.zh,
    );
  }

  private drawCongestion(g: CanvasRenderingContext2D, w: number, h: number) {
    const trace = this.congestion();
    const box = plotBox(w, h, 66, 72, 30, 62);
    const maxY = Math.max(4, ...trace.steps.map((s) => Math.max(s.cwnd, s.ssthresh))) * 1.1;
    const xOf = (r: number) => box.x0 + (r / Math.max(1, trace.steps.length - 1)) * box.w;
    const yOf = (v: number) => box.y1 - (v / maxY) * box.h;
    const xTicks = Array.from({ length: 6 }, (_, i) => ({ value: i / 5, label: String(Math.round((trace.steps.length - 1) * i / 5)) }));
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: i / 4, label: String(Math.round((maxY * i) / 4)) }));
    drawAxes(g, box, xTicks, yTicks, this.zh ? 'RTT 轮次' : 'RTT round', 'cwnd / ssthresh (MSS)', this.zh);
    trace.steps.forEach((step, i) => {
      if (i === trace.steps.length - 1) return;
      g.fillStyle = step.phase === 'slow start' ? 'rgba(94,230,208,0.15)' : step.phase === 'fast recovery' ? 'rgba(255,139,134,0.16)' : 'rgba(120,200,255,0.06)';
      g.fillRect(xOf(i), box.y0, Math.max(1, xOf(i + 1) - xOf(i)), box.h);
    });
    g.strokeStyle = CS.amber;
    g.lineWidth = 2.2;
    g.beginPath();
    trace.steps.forEach((s, i) => {
      if (i === 0) g.moveTo(xOf(s.round), yOf(s.cwnd));
      else g.lineTo(xOf(s.round), yOf(s.cwnd));
    });
    g.stroke();
    g.strokeStyle = 'rgba(255,139,134,0.7)';
    g.setLineDash([4, 4]);
    g.beginPath();
    trace.steps.forEach((s, i) => {
      if (i === 0) g.moveTo(xOf(s.round), yOf(s.ssthresh));
      else g.lineTo(xOf(s.round), yOf(s.ssthresh));
    });
    g.stroke();
    g.setLineDash([]);
    for (const step of trace.steps) {
      if (!step.loss) continue;
      g.strokeStyle = CS.red;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(xOf(step.round), box.y0);
      g.lineTo(xOf(step.round), box.y1);
      g.stroke();
      g.fillStyle = CS.red;
      g.font = font(false, 9, '600');
      g.textAlign = 'center';
      g.fillText(this.zh ? '丢包' : 'loss', xOf(step.round), box.y0 + 12);
    }
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5);
    g.textAlign = 'left';
    g.fillText(`${this.zh ? 'cwnd' : 'cwnd'} (${this.state.fast ? 'Reno fast retransmit' : 'timeout'})`, box.x0, box.y0 - 12);
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? '每个 RTT 步进一次：慢启动倍增 → ssthresh 后线性增长 → 丢包减半。省略延迟 ACK、SACK 与 pacing。'
        : 'One step per RTT: slow-start doubling → linear after ssthresh → loss halves the window. Delayed ACKs, SACK and pacing are omitted.',
      this.zh,
    );
  }

  private drawRto(g: CanvasRenderingContext2D, w: number, h: number) {
    const samples = this.rto();
    const box = plotBox(w, h, 70, 72, 30, 62);
    const maxY = Math.max(1e-3, ...samples.map((s) => Math.max(s.sample, s.srtt, s.rto))) * 1.15;
    const xOf = (i: number) => box.x0 + (i / Math.max(1, samples.length - 1)) * box.w;
    const yOf = (v: number) => box.y1 - (v / maxY) * box.h;
    const xTicks = Array.from({ length: Math.min(6, samples.length) }, (_, i) => ({
      value: samples.length > 1 ? i / Math.max(1, Math.min(6, samples.length) - 1) : 0,
      label: String(i + 1),
    }));
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: i / 4, label: (maxY * i / 4).toFixed(3) }));
    drawAxes(g, box, xTicks, yTicks, this.zh ? 'RTT 样本序号' : 'RTT sample', this.zh ? '秒' : 'seconds', this.zh);
    const series = [
      { label: 'sample', color: CS.blue, value: (s: RtoSample) => s.sample },
      { label: 'SRTT', color: CS.cyan, value: (s: RtoSample) => s.srtt },
      { label: 'RTO', color: CS.amber, value: (s: RtoSample) => s.rto },
    ];
    for (const line of series) {
      g.strokeStyle = line.color;
      g.lineWidth = 1.8;
      g.beginPath();
      samples.forEach((s, i) => {
        if (i === 0) g.moveTo(xOf(i), yOf(line.value(s)));
        else g.lineTo(xOf(i), yOf(line.value(s)));
      });
      g.stroke();
    }
    let cursor = box.x0;
    samples.slice(0, 4).forEach((s, i) => {
      g.fillStyle = CS.faint;
      g.font = font(false, 9);
      g.textAlign = 'left';
      g.fillText(`#${i + 1} ${s.sample.toFixed(3)} s`, cursor, box.y1 + 17);
      cursor += 110;
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? 'Jacobson/Karels：RTTVAR = 0.75·RTTVAR + 0.25·|SRTT−R|，SRTT = 0.875·SRTT + 0.125·R，RTO = SRTT + max(G, 4·RTTVAR)。'
        : 'Jacobson/Karels: RTTVAR = 0.75·RTTVAR + 0.25·|SRTT−R|, SRTT = 0.875·SRTT + 0.125·R, RTO = SRTT + max(G, 4·RTTVAR).',
      this.zh,
    );
  }
}

function parseNumberList(text: string): number[] {
  return text
    .split(/[,\s;]+/)
    .map((s) => Number(s))
    .filter((v) => Number.isFinite(v));
}

export default function createNetProtocolPlugin(): Plugin {
  return new NetProtocolPlugin();
}
