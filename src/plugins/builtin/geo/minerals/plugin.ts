// ==========================================================================
// geo-minerals — Mineral Identification Lab
//
// Views
//   identify  weighted match ranking against the property criteria
//   table     reference database with Mohs hardness and crystal system
//   mohs      scratch test between the selected mineral and a tool
//   thin      simulated thin section: interference colour + relief
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
import { mineralsManifest } from './manifest';
import { mineralFigurePanels } from './figure';
import {
  CRYSTAL_SYSTEMS,
  CRYSTAL_SYSTEM_LABELS,
  MINERALS,
  MOHS_TOOLS,
  classificationPath,
  identifyMinerals,
  interferenceColor,
  mineralById,
  opticalRelief,
  parseMineralCsv,
  retardationNm,
  runMineralBenchmarks,
  scratchTest,
  type CrystalSystem,
  type IdentifyMatch,
  type Luster,
  type Mineral,
  type ScratchResult,
} from './kernel';

export { mineralsManifest } from './manifest';

type ViewMode = 'identify' | 'table' | 'mohs' | 'thin';

const VIEWS: Array<{ value: ViewMode; en: string; zh: string }> = [
  { value: 'identify', en: 'Property identification', zh: '物性鉴定' },
  { value: 'table', en: 'Reference database', zh: '参考矿物数据库' },
  { value: 'mohs', en: 'Mohs scratch test', zh: '莫氏刻划测试' },
  { value: 'thin', en: 'Thin-section optics', zh: '薄片光学模拟' },
];

const LUSTERS: readonly Luster[] = [
  'metallic',
  'vitreous',
  'pearly',
  'silky',
  'earthy',
  'greasy',
  'adamantine',
  'resinous',
];

const LUSTER_LABEL: Record<Luster, { en: string; zh: string }> = {
  metallic: { en: 'Metallic', zh: '金属光泽' },
  vitreous: { en: 'Vitreous', zh: '玻璃光泽' },
  pearly: { en: 'Pearly', zh: '珍珠光泽' },
  silky: { en: 'Silky', zh: '丝绢光泽' },
  earthy: { en: 'Earthy', zh: '土状光泽' },
  greasy: { en: 'Greasy', zh: '油脂光泽' },
  adamantine: { en: 'Adamantine', zh: '金刚光泽' },
  resinous: { en: 'Resinous', zh: '树脂光泽' },
};

const SCRATCH_LABEL: Record<ScratchResult, { en: string; zh: string }> = {
  'mineral-scratches-tool': { en: 'the mineral scratches the tool', zh: '矿物可刻划工具' },
  'tool-scratches-mineral': { en: 'the tool scratches the mineral', zh: '工具可刻划矿物' },
  mutual: { en: 'both scratch each other (equal hardness)', zh: '互相刻划（硬度相当）' },
};

interface State {
  view: ViewMode;
  hardness: number;
  sg: number;
  luster: '' | Luster;
  cleavage: string;
  crystalSystem: '' | CrystalSystem;
  selectedId: string;
  toolId: string;
  thicknessUm: number;
}

export class MineralIdentificationPlugin implements Plugin {
  readonly manifest = mineralsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  /** Built-in 24-mineral teaching database; loading a CSV/TSV replaces it. */
  private database: readonly Mineral[] = MINERALS;
  private matches: IdentifyMatch[] = [];
  private state: State = {
    view: 'identify',
    hardness: 7,
    sg: 2.65,
    luster: 'vitreous',
    cleavage: 'none',
    crystalSystem: 'hexagonal',
    selectedId: 'quartz',
    toolId: 'steel-file',
    thicknessUm: 30,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
    this.recompute(false);
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
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: VIEWS.map((v) => ({ value: v.value, label: this.zh ? v.zh : v.en, labelI18n: { 'zh-CN': v.zh, 'en-US': v.en } })),
        value: s.view,
      },
      {
        key: 'hardness',
        label: 'Hardness (Mohs)',
        labelI18n: { 'zh-CN': '莫氏硬度', 'en-US': 'Hardness (Mohs)' },
        type: 'number',
        min: 1,
        max: 10,
        step: 0.5,
        value: s.hardness,
        visibleWhen: { key: 'view', in: ['identify', 'thin'] },
      },
      {
        key: 'sg',
        label: 'Specific gravity',
        labelI18n: { 'zh-CN': '比重', 'en-US': 'Specific gravity' },
        type: 'number',
        min: 1,
        max: 8,
        step: 0.05,
        value: s.sg,
        visibleWhen: { key: 'view', in: ['identify', 'thin'] },
      },
      {
        key: 'luster',
        label: 'Lustre',
        labelI18n: { 'zh-CN': '光泽', 'en-US': 'Lustre' },
        type: 'select',
        options: [
          { value: '', label: this.zh ? '未指定' : 'unspecified' },
          ...LUSTERS.map((l) => ({
            value: l,
            label: this.zh ? LUSTER_LABEL[l].zh : LUSTER_LABEL[l].en,
            labelI18n: { 'zh-CN': LUSTER_LABEL[l].zh, 'en-US': LUSTER_LABEL[l].en },
          })),
        ],
        value: s.luster,
        visibleWhen: { key: 'view', in: ['identify', 'thin'] },
      },
      {
        key: 'cleavage',
        label: 'Cleavage keyword',
        labelI18n: { 'zh-CN': '解理关键词', 'en-US': 'Cleavage keyword' },
        type: 'text',
        value: s.cleavage,
        placeholder: 'none / perfect / cubic / basal',
        visibleWhen: { key: 'view', in: ['identify', 'thin'] },
      },
      {
        key: 'crystalSystem',
        label: 'Crystal system',
        labelI18n: { 'zh-CN': '晶系', 'en-US': 'Crystal system' },
        type: 'select',
        options: [
          { value: '', label: this.zh ? '未指定' : 'unspecified' },
          ...CRYSTAL_SYSTEMS.map((c) => ({
            value: c,
            label: this.zh ? CRYSTAL_SYSTEM_LABELS[c].zh : CRYSTAL_SYSTEM_LABELS[c].en,
            labelI18n: { 'zh-CN': CRYSTAL_SYSTEM_LABELS[c].zh, 'en-US': CRYSTAL_SYSTEM_LABELS[c].en },
          })),
        ],
        value: s.crystalSystem,
        visibleWhen: { key: 'view', in: ['identify', 'thin'] },
      },
      {
        key: 'selectedId',
        label: 'Reference mineral',
        labelI18n: { 'zh-CN': '参考矿物', 'en-US': 'Reference mineral' },
        type: 'select',
        options: this.database.map((m) => ({
          value: m.id,
          label: this.zh ? m.nameZh : m.name,
          labelI18n: { 'zh-CN': m.nameZh, 'en-US': m.name },
        })),
        value: s.selectedId,
        visibleWhen: { key: 'view', in: ['mohs', 'thin'] },
      },
      {
        key: 'toolId',
        label: 'Mohs tool',
        labelI18n: { 'zh-CN': '刻划工具', 'en-US': 'Mohs tool' },
        type: 'select',
        options: MOHS_TOOLS.map((t) => ({
          value: t.id,
          label: `${this.zh ? t.zh : t.en} (${t.hardness})`,
          labelI18n: { 'zh-CN': `${t.zh} (${t.hardness})`, 'en-US': `${t.en} (${t.hardness})` },
        })),
        value: s.toolId,
        visibleWhen: { key: 'view', in: ['mohs'] },
      },
      {
        key: 'thicknessUm',
        label: 'Section thickness (µm)',
        labelI18n: { 'zh-CN': '薄片厚度 (µm)', 'en-US': 'Section thickness (µm)' },
        type: 'range',
        min: 10,
        max: 60,
        step: 1,
        value: s.thicknessUm,
        visibleWhen: { key: 'view', in: ['thin'] },
      },
      actionButton('identify', 'Run identification', '运行鉴定', 'primary'),
      actionButton('demo', 'Reset to built-in library', '重置为内置教学库'),
      actionButton('benchmark', 'Run mineral benchmarks', '运行矿物学基准'),
      actionButton('exportCsv', 'Export identification ranking', '导出鉴定排名 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (apply(params[k] as number)) this.draw();
      }
    };
    const sel = (k: string, apply: (s: string) => boolean): void => {
      if (typeof params[k] === 'string' && apply(params[k] as string)) this.draw();
    };

    sel('view', (v) => {
      if (!VIEWS.some((x) => x.value === v) || v === this.state.view) return false;
      this.state.view = v as ViewMode;
      this.recompute(false);
      return true;
    });
    num('hardness', (n) => {
      const v = Math.min(10, Math.max(1, Math.round(n * 2) / 2));
      if (v === this.state.hardness) return false;
      this.state.hardness = v;
      this.recompute(false);
      return true;
    });
    num('sg', (n) => {
      const v = Math.min(8, Math.max(1, Math.round(n * 100) / 100));
      if (v === this.state.sg) return false;
      this.state.sg = v;
      this.recompute(false);
      return true;
    });
    sel('luster', (v) => {
      if (v !== '' && !LUSTERS.includes(v as Luster)) return false;
      if (v === this.state.luster) return false;
      this.state.luster = v as '' | Luster;
      this.recompute(false);
      return true;
    });
    sel('cleavage', (v) => {
      if (v === this.state.cleavage) return false;
      this.state.cleavage = v;
      this.recompute(false);
      return true;
    });
    sel('crystalSystem', (v) => {
      if (v !== '' && !CRYSTAL_SYSTEMS.includes(v as CrystalSystem)) return false;
      if (v === this.state.crystalSystem) return false;
      this.state.crystalSystem = v as '' | CrystalSystem;
      this.recompute(false);
      return true;
    });
    sel('selectedId', (v) => {
      if (!this.database.some((m) => m.id === v) || v === this.state.selectedId) return false;
      this.state.selectedId = v;
      this.recompute(false);
      return true;
    });
    sel('toolId', (v) => {
      if (!MOHS_TOOLS.some((t) => t.id === v) || v === this.state.toolId) return false;
      this.state.toolId = v;
      this.draw();
      return true;
    });
    num('thicknessUm', (n) => {
      const v = Math.min(60, Math.max(10, Math.round(n)));
      if (v === this.state.thicknessUm) return false;
      this.state.thicknessUm = v;
      this.recompute(false);
      return true;
    });

    if (actionFired(params, 'identify')) {
      if (this.database.length === 0) this.notifyNeedData();
      else this.recompute(true);
    }
    if (actionFired(params, 'demo')) this.runDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(
        this.api,
        'warning',
        'Mineral databases must be CSV / TSV / TXT with name, hardness and sg columns.',
        '矿物数据库须为含 name、hardness、sg 列的 CSV / TSV / TXT。',
      );
      return;
    }
    const parsed = parseMineralCsv(await file.text());
    if (parsed.length === 0) {
      notify(
        this.api,
        'warning',
        'No valid mineral rows found (need name, hardness and sg).',
        '未找到有效矿物行（至少需要 name、hardness、sg）。',
      );
      return;
    }
    this.database = parsed;
    if (!parsed.some((m) => m.id === this.state.selectedId)) this.state.selectedId = parsed[0]!.id;
    this.recompute(false);
    notify(
      this.api,
      'success',
      `Loaded a ${parsed.length}-mineral database from ${file.name}.`,
      `已从 ${file.name} 载入 ${parsed.length} 种矿物。`,
    );
  }

  // ---- computation ---------------------------------------------------------

  private selected(): Mineral {
    return mineralById(this.state.selectedId) ?? this.database[0]!;
  }

  private notifyNeedData(): void {
    notify(
      this.api,
      'warning',
      'Load a mineral CSV first (name, hardness and sg columns at minimum).',
      '请先载入矿物 CSV（至少需要 name、hardness、sg 列）。',
    );
  }

  private criteria() {
    const s = this.state;
    return {
      hardness: s.hardness,
      cleavage: s.cleavage.trim() || undefined,
      luster: s.luster || undefined,
      sg: s.sg,
      crystalSystem: s.crystalSystem || undefined,
    };
  }

  private recompute(publish: boolean) {
    this.matches = identifyMinerals(this.criteria(), this.database);
    if (publish) this.publish();
    this.draw();
  }

  private publish() {
    const top = this.matches[0];
    if (!top) return;
    const selected = this.selected();
    const rel = opticalRelief(1.54 + selected.birefringence * 2, 1.54);
    const metrics: ScienceMetric[] = [
      {
        key: 'mineral-match',
        label: 'Best match',
        value: `${this.zh ? top.mineral.nameZh : top.mineral.name} · ${fmtMetric(top.score, 3)}%`,
        severity: top.score >= 70 ? 'ok' : top.score >= 45 ? 'info' : 'warn',
        hint: `matched: ${top.matched.join(', ') || '—'}; missed: ${top.missed.join(', ') || '—'}`,
      },
      {
        key: 'mineral-hardness',
        label: 'Hardness',
        value: fmtMetric(top.mineral.hardness, 3),
        unit: 'Mohs',
        severity: 'info',
        hint: `${this.zh ? '解理' : 'cleavage'}: ${this.zh ? top.mineral.cleavageZh : top.mineral.cleavage}`,
      },
      {
        key: 'mineral-sg',
        label: 'Specific gravity',
        value: fmtMetric(top.mineral.sg, 3),
        unit: 'g/cm³',
        severity: 'info',
        hint: `${this.zh ? '晶系' : 'system'}: ${this.zh ? CRYSTAL_SYSTEM_LABELS[top.mineral.crystalSystem].zh : CRYSTAL_SYSTEM_LABELS[top.mineral.crystalSystem].en}`,
      },
      {
        key: 'mineral-retardation',
        label: 'Retardation (selected)',
        value: fmtMetric(retardationNm(selected.birefringence, this.state.thicknessUm)),
        unit: 'nm',
        severity: 'info',
        hint: `Γ = Δn·t, Δn=${selected.birefringence}, t=${this.state.thicknessUm} µm; ${this.zh ? '干涉色' : 'colour'}: ${interferenceColor(retardationNm(selected.birefringence, this.state.thicknessUm))[this.zh ? 'nameZh' : 'name']}`,
      },
      {
        key: 'mineral-relief',
        label: 'Optical relief (selected)',
        value: this.zh ? { low: '低', moderate: '中', high: '高', 'very-high': '极高' }[rel.relief] : rel.relief,
        severity: 'info',
        hint: `n ≈ 1.54 + 2Δn; ${this.zh ? '折射率差' : 'RI contrast'} ${rel.contrast.toFixed(3)}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runDemo() {
    // Restore the bundled teaching set after a custom CSV was loaded.
    this.database = MINERALS;
    this.state.view = 'identify';
    this.state.hardness = 7;
    this.state.sg = 2.65;
    this.state.luster = 'vitreous';
    this.state.cleavage = 'none';
    this.state.crystalSystem = 'hexagonal';
    this.state.selectedId = 'quartz';
    this.recompute(true);
    notify(
      this.api,
      'success',
      `Restored the built-in ${MINERALS.length}-mineral database and quartz criteria (H=7, G=2.65, no cleavage, vitreous, hexagonal).`,
      `已恢复内置 ${MINERALS.length} 种矿物数据库与石英判据（H=7、G=2.65、无解理、玻璃光泽、六方晶系）。`,
    );
  }

  private runBenchmarks() {
    const out = runMineralBenchmarks();
    const metrics: ScienceMetric[] = out.map((b) => ({
      key: `bench-${b.id}`,
      label: `Bench · ${b.id}`,
      value: b.pass ? 'pass' : 'FAIL',
      severity: b.pass ? 'ok' : 'warn',
      hint: b.detail,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      out.every((b) => b.pass) ? 'success' : 'warning',
      `Mineral benchmarks: ${out.map((b) => `${b.id}=${b.pass ? 'pass' : 'FAIL'}`).join(', ')}`,
      `矿物学基准：${out.map((b) => `${b.id}=${b.pass ? '通过' : '未通过'}`).join('，')}`,
    );
    this.draw();
  }

  private exportCsv() {
    if (this.database.length === 0) {
      this.notifyNeedData();
      return;
    }
    const rows = this.matches.map((m) => [
      m.mineral.id,
      m.mineral.name,
      m.mineral.nameZh,
      Number(m.score.toFixed(2)),
      m.matched.join('|'),
      m.missed.join('|'),
    ]);
    exportRowsCsv(this.api, 'mineral-identification-ranking', ['id', 'name', 'name_zh', 'score_pct', 'matched', 'missed'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (this.database.length === 0) {
      this.notifyNeedData();
      return;
    }
    const selected = this.selected();
    const top = this.matches[0];
    const caption: Bilingual = {
      zh: `矿物鉴定（H=${this.state.hardness}、G=${this.state.sg}）：首选 ${top ? `${top.mineral.nameZh} ${top.score.toFixed(1)}%` : '无'}。所选参考矿物 ${selected.nameZh}（${selected.formula}），Δn=${selected.birefringence}，t=${this.state.thicknessUm} µm → Γ=${retardationNm(selected.birefringence, this.state.thicknessUm).toFixed(0)} nm。`,
      en: `Mineral identification (H=${this.state.hardness}, G=${this.state.sg}): best match ${top ? `${top.mineral.name} ${top.score.toFixed(1)}%` : 'none'}. Reference mineral ${selected.name} (${selected.formula}), Δn=${selected.birefringence}, t=${this.state.thicknessUm} µm → Γ=${retardationNm(selected.birefringence, this.state.thicknessUm).toFixed(0)} nm.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '矿物鉴定与薄片光学', en: 'Mineral Identification & Thin-Section Optics' },
      caption,
      mineralFigurePanels({ selected, matches: this.matches, thicknessUm: this.state.thicknessUm }),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 860;
    canvas.height = canvas.clientHeight || 520;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (this.database.length === 0) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No mineral database',
        titleZh: '没有矿物数据库',
        hint: 'Load a mineral CSV (name, hardness, sg, …).',
        hintZh: '请载入矿物 CSV（name、hardness、sg 等列）。',
      });
      return;
    }
    const zh = this.zh;
    this.drawHeader(g, canvas, zh);
    switch (this.state.view) {
      case 'table':
        this.drawTable(g, canvas, zh);
        break;
      case 'mohs':
        this.drawMohs(g, canvas, zh);
        break;
      case 'thin':
        this.drawThinSection(g, canvas, zh);
        break;
      default:
        this.drawIdentify(g, canvas, zh);
    }
  }

  private drawHeader(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const title = VIEWS.find((v) => v.value === this.state.view);
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(zh ? title?.zh ?? '' : title?.en ?? '', 16, 24);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'right';
    g.fillText(`${this.database.length} ${zh ? '种矿物' : 'minerals'} · ${this.state.view}`, canvas.width - 16, 24);
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.moveTo(16, 34);
    g.lineTo(canvas.width - 16, 34);
    g.stroke();
  }

  private drawIdentify(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const top = this.matches.slice(0, 10);
    const left = 16;
    const topY = 52;
    const right = canvas.width - 16;
    const criteria = zh
      ? `判据：H=${this.state.hardness} · G=${this.state.sg} · 解理「${this.state.cleavage || '未指定'}」 · 光泽 ${this.state.luster ? LUSTER_LABEL[this.state.luster].zh : '未指定'} · 晶系 ${this.state.crystalSystem ? CRYSTAL_SYSTEM_LABELS[this.state.crystalSystem].zh : '未指定'}`
      : `Criteria: H=${this.state.hardness} · G=${this.state.sg} · cleavage "${this.state.cleavage || 'any'}" · lustre ${this.state.luster || 'any'} · system ${this.state.crystalSystem || 'any'}`;
    g.fillStyle = 'rgba(190,205,220,0.95)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(criteria, left, topY);

    const rowH = Math.min(34, Math.max(22, (canvas.height - topY - 32) / Math.max(top.length, 1)));
    const barX = Math.min(360, canvas.width * 0.42);
    const barW = Math.max(80, right - barX - 180);
    top.forEach((m, k) => {
      const y = topY + 18 + k * rowH;
      const isTop = k === 0;
      g.fillStyle = isTop ? 'rgba(122,215,255,0.16)' : 'rgba(255,255,255,0.03)';
      g.fillRect(left, y, right - left, rowH - 3);
      g.fillStyle = isTop ? '#7ad7ff' : 'rgba(205,216,230,0.95)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.fillText(`${k + 1}. ${zh ? m.mineral.nameZh : m.mineral.name}`, left + 8, y + rowH * 0.62);
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.font = '10px Consolas, monospace';
      g.fillText(`${m.mineral.formula} · H ${m.mineral.hardness} · G ${m.mineral.sg}`, left + 8, y + rowH * 0.9);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(barX, y + rowH * 0.32, barW, rowH * 0.36);
      g.fillStyle = isTop ? '#ffd166' : 'rgba(122,215,255,0.75)';
      g.fillRect(barX, y + rowH * 0.32, (barW * m.score) / 100, rowH * 0.36);
      g.fillStyle = 'rgba(220,230,240,0.95)';
      g.font = '11px Consolas, monospace';
      g.textAlign = 'right';
      g.fillText(`${m.score.toFixed(1)}%`, right - 8, y + rowH * 0.62);
    });

    const sel = this.selected();
    g.fillStyle = 'rgba(170,185,205,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh
        ? `参考矿物：${sel.nameZh}（${classificationPath(sel, true).join(' → ')}）`
        : `Reference: ${sel.name} (${classificationPath(sel, false).join(' → ')})`,
      canvas.width / 2,
      canvas.height - 16,
    );
  }

  private drawTable(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const cols = zh
      ? ['矿物', '化学式', '硬度', '比重', '晶系', '解理']
      : ['Mineral', 'Formula', 'H', 'G', 'System', 'Cleavage'];
    const x0 = 16;
    const widths = [0.2, 0.24, 0.08, 0.09, 0.16, 0.23].map((f) => (canvas.width - 32) * f);
    const y0 = 58;
    const rowH = Math.min(24, (canvas.height - y0 - 26) / Math.max(this.database.length, 1));
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let x = x0;
    g.fillStyle = 'rgba(122,215,255,0.95)';
    cols.forEach((c, k) => {
      g.textAlign = 'left';
      g.fillText(c, x + 4, y0);
      x += widths[k]!;
    });
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(x0, y0 + 6);
    g.lineTo(canvas.width - 16, y0 + 6);
    g.stroke();
    this.database.forEach((m, row) => {
      const y = y0 + 10 + row * rowH;
      if (y > canvas.height - 18) return;
      if (row % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(x0, y, canvas.width - 32, rowH);
      }
      const selected = m.id === this.state.selectedId;
      const values = [
        zh ? m.nameZh : m.name,
        m.formula,
        String(m.hardness),
        String(m.sg),
        zh ? CRYSTAL_SYSTEM_LABELS[m.crystalSystem].zh : CRYSTAL_SYSTEM_LABELS[m.crystalSystem].en,
        zh ? m.cleavageZh : m.cleavage,
      ];
      x = x0;
      values.forEach((v, k) => {
        g.fillStyle = selected ? '#ffd166' : 'rgba(215,224,235,0.92)';
        g.textAlign = 'left';
        g.fillText(v, x + 4, y + rowH * 0.7, widths[k]! - 6);
        x += widths[k]!;
      });
    });
  }

  private drawMohs(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const m = this.selected();
    const tool = MOHS_TOOLS.find((t) => t.id === this.state.toolId) ?? MOHS_TOOLS[2]!;
    const result = scratchTest(m.hardness, tool.hardness);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 20;

    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1;
    const boxW = Math.min(520, canvas.width - 80);
    const boxH = 180;
    g.beginPath();
    g.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 10);
    g.fill();
    g.stroke();

    g.textAlign = 'center';
    g.fillStyle = zh ? '#ffd166' : '#ffd166';
    g.font = `15px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? m.nameZh : m.name, cx, cy - 54);
    g.fillStyle = 'rgba(190,205,220,0.9)';
    g.font = '12px Consolas, monospace';
    g.fillText(`${m.formula}  ·  H = ${m.hardness}  ·  G = ${m.sg}`, cx, cy - 32);

    // scratch line with the tool
    g.strokeStyle = result === 'tool-scratches-mineral' ? 'rgba(255,120,120,0.9)' : 'rgba(122,215,255,0.9)';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(cx - 100, cy);
    g.lineTo(cx + 100, cy);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(220,230,240,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      `${zh ? '工具' : 'tool'}: ${zh ? tool.zh : tool.en} (H=${tool.hardness})`,
      cx,
      cy + 30,
    );
    g.fillStyle = result === 'mutual' ? '#ffd166' : '#8ee6b0';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? SCRATCH_LABEL[result].zh : SCRATCH_LABEL[result].en, cx, cy + 56);

    // Mohs scale across the footer
    const x0 = 30;
    const x1 = canvas.width - 30;
    const sy = canvas.height - 52;
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.moveTo(x0, sy);
    g.lineTo(x1, sy);
    g.stroke();
    for (let h = 1; h <= 10; h += 1) {
      const x = x0 + ((h - 1) / 9) * (x1 - x0);
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.moveTo(x, sy - 4);
      g.lineTo(x, sy + 4);
      g.stroke();
      g.fillStyle = 'rgba(170,185,205,0.9)';
      g.font = '10px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(String(h), x, sy + 18);
    }
    const mx = x0 + ((m.hardness - 1) / 9) * (x1 - x0);
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(mx, sy, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(170,185,205,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '莫氏硬度标尺' : 'Mohs hardness scale', cx, sy - 14);
  }

  private drawThinSection(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const m = this.selected();
    const gamma = retardationNm(m.birefringence, this.state.thicknessUm);
    const colour = interferenceColor(gamma);
    const relief = opticalRelief(1.54 + m.birefringence * 2, 1.54);
    const x0 = 24;
    const y0 = 52;
    const w = canvas.width - 48;
    const h = canvas.height - 88;
    g.save();
    g.beginPath();
    g.roundRect(x0, y0, w, h, 8);
    g.clip();
    g.fillStyle = `rgb(${colour.r},${colour.g},${colour.b})`;
    g.fillRect(x0, y0, w, h);

    // Grain mosaic: irregular polygons, slightly different relief tint.
    const tint = relief.relief === 'very-high' || relief.relief === 'high' ? 1.12 : 0.94;
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const grainColours = [
      `rgba(${Math.min(255, colour.r * tint)},${Math.min(255, colour.g * tint)},${Math.min(255, colour.b * tint)},0.46)`,
      `rgba(${Math.max(0, colour.r * 0.78)},${Math.max(0, colour.g * 0.78)},${Math.max(0, colour.b * 0.78)},0.32)`,
      'rgba(255,255,255,0.12)',
    ];
    for (let k = 0; k < 26; k += 1) {
      const gx = x0 + rnd() * w;
      const gy = y0 + rnd() * h;
      const r = 18 + rnd() * Math.min(70, w / 6);
      const sides = 5 + Math.floor(rnd() * 3);
      g.beginPath();
      for (let s = 0; s < sides; s += 1) {
        const a = (s / sides) * Math.PI * 2 + rnd() * 0.4;
        const rr = r * (0.7 + rnd() * 0.4);
        const px = gx + Math.cos(a) * rr;
        const py = gy + Math.sin(a) * rr;
        if (s === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = grainColours[k % grainColours.length]!;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = 1;
      g.stroke();
    }
    // Cleavage traces.
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 14; k += 1) {
      const px = x0 + rnd() * w;
      const py = y0 + rnd() * h;
      const len = 34 + rnd() * 90;
      const ang = (rnd() - 0.5) * 0.7;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      g.stroke();
    }
    g.restore();

    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x0, y0, w, h, 8);
    g.stroke();

    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(15,20,28,0.88)';
    const lines = [
      `${zh ? m.nameZh : m.name}  ${m.formula}`,
      `Δn = ${m.birefringence}   t = ${this.state.thicknessUm} µm   Γ = ${gamma.toFixed(0)} nm`,
      `${zh ? '干涉色' : 'interference'}: ${zh ? colour.nameZh : colour.name}   ·   ${zh ? '突起' : 'relief'}: ${zh ? { low: '低', moderate: '中', high: '高', 'very-high': '极高' }[relief.relief] : relief.relief}`,
    ];
    const labelW = Math.min(w - 20, 440);
    g.fillStyle = 'rgba(250,252,255,0.82)';
    g.beginPath();
    g.roundRect(x0 + 10, y0 + 10, labelW, 58, 6);
    g.fill();
    g.fillStyle = 'rgba(15,20,28,0.9)';
    lines.forEach((line, k) => g.fillText(line, x0 + 20, y0 + 30 + k * 17));

    g.fillStyle = 'rgba(170,185,205,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh
        ? '正交偏光下 30 µm 标准薄片的近似米歇尔-列维干涉色（示意，非实测光谱）'
        : 'Approximate Michel-Lévy interference colour of a 30-µm section under crossed polars (schematic, not a measured spectrum)',
      canvas.width / 2,
      canvas.height - 16,
    );
  }
}

export default function createMineralPlugin(): Plugin {
  return new MineralIdentificationPlugin();
}
