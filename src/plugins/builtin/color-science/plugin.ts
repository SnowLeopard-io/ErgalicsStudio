// ==========================================================================
// color-science — Color Science Lab
//
// One canvas with five views: chromaticity, colour-space table, harmony
// swatches, imported palette and dichromacy simulation. CSV palettes are the
// Block/Flow entry point; every numeric result is also exported to the
// science strip and Figure Studio.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { colorFigurePanels } from './figure';
import { colorScienceManifest } from './manifest';
import {
  HARMONY_RULES,
  contrastRatio,
  deltaE2000,
  deltaE76,
  harmony,
  hexToRgb,
  labToLch,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToLab,
  rgbToXyz,
  spectralLocus,
  simulateCvd,
  wcagLevel,
  xyzToUv,
  xyzToXy,
  runColorBenchmarks,
  parsePaletteCsv,
  type CvdType,
  type HarmonyRule,
  type PaletteEntry,
  type RGB,
} from './kernel';

export { colorScienceManifest } from './manifest';

type ViewId = 'chromaticity' | 'spaces' | 'harmony' | 'palette' | 'vision';

const DEFAULT_PALETTE: PaletteEntry[] = ([
  ['Ink', '#111827'],
  ['Cobalt', '#2563EB'],
  ['Cyan', '#06B6D4'],
  ['Teal', '#10B981'],
  ['Amber', '#F59E0B'],
  ['Vermilion', '#EF4444'],
  ['Magenta', '#D946EF'],
  ['Paper', '#F8FAFC'],
] as Array<[string, string]>).map(([name, hex]) => {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  return { name, rgb, hex: rgbToHex(rgb) };
});

interface State {
  baseHex: string;
  compareHex: string;
  view: ViewId;
  rule: HarmonyRule;
  cvd: CvdType;
  uv: boolean;
}

export class ColorSciencePlugin implements Plugin {
  readonly manifest = colorScienceManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private palette: PaletteEntry[] = DEFAULT_PALETTE;
  private state: State = {
    baseHex: '#2563EB',
    compareHex: '#F59E0B',
    view: 'chromaticity',
    rule: 'triadic',
    cvd: 'deuteranopia',
    uv: false,
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
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'chromaticity', label: this.zh ? 'CIE 色度图' : 'CIE chromaticity' },
          { value: 'spaces', label: this.zh ? '色彩空间换算' : 'Colour-space table' },
          { value: 'harmony', label: this.zh ? '配色规则' : 'Harmony rules' },
          { value: 'palette', label: this.zh ? '调色板与可访问性' : 'Palette & accessibility' },
          { value: 'vision', label: this.zh ? '色觉模拟' : 'Colour-vision simulation' },
        ],
        value: s.view,
      },
      {
        key: 'baseHex',
        label: 'Base colour',
        labelI18n: { 'zh-CN': '基准色（HEX）', 'en-US': 'Base colour (HEX)' },
        type: 'text',
        value: s.baseHex,
        placeholder: '#2563EB',
      },
      {
        key: 'compareHex',
        label: 'Compare colour',
        labelI18n: { 'zh-CN': '对比色（HEX）', 'en-US': 'Compare colour (HEX)' },
        type: 'text',
        value: s.compareHex,
        placeholder: '#F59E0B',
        visibleWhen: { key: 'view', in: ['spaces', 'chromaticity'] },
      },
      {
        key: 'rule',
        label: 'Harmony rule',
        labelI18n: { 'zh-CN': '配色规则', 'en-US': 'Harmony rule' },
        type: 'select',
        options: (Object.keys(HARMONY_RULES) as HarmonyRule[]).map((id) => ({
          value: id,
          label: this.zh ? HARMONY_RULES[id].zh : HARMONY_RULES[id].en,
          labelI18n: { 'zh-CN': HARMONY_RULES[id].zh, 'en-US': HARMONY_RULES[id].en },
        })),
        value: s.rule,
        visibleWhen: { key: 'view', in: ['harmony', 'vision'] },
      },
      {
        key: 'cvd',
        label: 'Dichromacy type',
        labelI18n: { 'zh-CN': '色觉缺陷类型', 'en-US': 'Dichromacy type' },
        type: 'select',
        options: [
          { value: 'protanopia', label: this.zh ? '红色盲（protanopia）' : 'Protanopia' },
          { value: 'deuteranopia', label: this.zh ? '绿色盲（deuteranopia）' : 'Deuteranopia' },
          { value: 'tritanopia', label: this.zh ? '蓝色盲（tritanopia）' : 'Tritanopia' },
        ],
        value: s.cvd,
        visibleWhen: { key: 'view', in: ['vision'] },
      },
      {
        key: 'uv',
        label: 'Use u′v′ (1976)',
        labelI18n: { 'zh-CN': '使用 u′v′（1976）', 'en-US': 'Use u′v′ (1976)' },
        type: 'checkbox',
        value: s.uv,
        hint: this.zh ? '关闭时显示 CIE 1931 xy' : 'off = CIE 1931 xy',
        visibleWhen: { key: 'view', in: ['chromaticity'] },
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export colour table CSV', '导出色彩表 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.view === 'string' && ['chromaticity', 'spaces', 'harmony', 'palette', 'vision'].includes(params.view)) {
      if (params.view !== this.state.view) {
        this.state.view = params.view as ViewId;
        this.draw();
      }
    }
    if (typeof params.baseHex === 'string') {
      const rgb = hexToRgb(params.baseHex);
      if (rgb) {
        const hex = rgbToHex(rgb);
        if (hex !== this.state.baseHex) {
          this.state.baseHex = hex;
          this.draw();
        }
      }
    }
    if (typeof params.compareHex === 'string') {
      const rgb = hexToRgb(params.compareHex);
      if (rgb) {
        const hex = rgbToHex(rgb);
        if (hex !== this.state.compareHex) {
          this.state.compareHex = hex;
          this.draw();
        }
      }
    }
    if (typeof params.rule === 'string' && params.rule in HARMONY_RULES && params.rule !== this.state.rule) {
      this.state.rule = params.rule as HarmonyRule;
      this.draw();
    }
    if (params.cvd === 'protanopia' || params.cvd === 'deuteranopia' || params.cvd === 'tritanopia') {
      if (params.cvd !== this.state.cvd) {
        this.state.cvd = params.cvd;
        this.draw();
      }
    }
    if (typeof params.uv === 'boolean' && params.uv !== this.state.uv) {
      this.state.uv = params.uv;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const entries = parsePaletteCsv(await file.text());
    if (entries.length === 0) {
      notify(
        this.api,
        'warning',
        'No colours found (expected columns: name, hex — or name, r, g, b).',
        '未找到颜色（需要 name, hex 或 name, r, g, b 列）。',
      );
      return;
    }
    this.palette = entries;
    this.state.view = 'palette';
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded ${entries.length} colours from ${file.name}.`,
      `已从 ${file.name} 载入 ${entries.length} 个颜色。`,
    );
  }

  // ---- actions ---------------------------------------------------------------

  private runBenchmark() {
    const bench = runColorBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh
        ? `实测 ${b.measured.toPrecision(8)} / 参考 ${b.expected.toPrecision(8)}，统一相对误差`
        : `measured ${b.measured.toPrecision(8)} / reference ${b.expected.toPrecision(8)}, unified relative error`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} colour-science benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项色彩科学基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  private exportCsv() {
    const base = this.base();
    const baseLab = rgbToLab(base);
    const rows = this.palette.map((p) => {
      const lab = rgbToLab(p.rgb);
      const lch = labToLch(lab);
      const xyz = rgbToXyz(p.rgb);
      const [x, y] = xyzToXy(xyz);
      const [u, v] = xyzToUv(xyz);
      return [
        p.name,
        p.hex,
        Math.round(p.rgb[0] * 255),
        Math.round(p.rgb[1] * 255),
        Math.round(p.rgb[2] * 255),
        ...xyz.map((n) => Number(n.toFixed(3))),
        ...lab.map((n) => Number(n.toFixed(3))),
        ...lch.map((n) => Number(n.toFixed(3))),
        Number(x.toFixed(4)),
        Number(y.toFixed(4)),
        Number(u.toFixed(4)),
        Number(v.toFixed(4)),
        Number(deltaE76(baseLab, lab).toFixed(3)),
        Number(deltaE2000(baseLab, lab).toFixed(3)),
        Number(contrastRatio(p.rgb, [0, 0, 0]).toFixed(2)),
        Number(contrastRatio(p.rgb, [1, 1, 1]).toFixed(2)),
      ];
    });
    exportRowsCsv(
      this.api,
      'color-spaces',
      [
        'name',
        'hex',
        'r255',
        'g255',
        'b255',
        'X',
        'Y',
        'Z',
        'L',
        'a',
        'b',
        'chroma',
        'hue',
        'x',
        'y',
        'u_prime',
        'v_prime',
        'dE76_vs_base',
        'dE2000_vs_base',
        'contrast_on_black',
        'contrast_on_white',
      ],
      rows,
    );
  }

  private async sendToFigure() {
    const base = this.base();
    const compare = this.compare();
    const de = deltaE2000(rgbToLab(base), rgbToLab(compare));
    const caption: Bilingual = {
      zh: `色彩科学：基准色 ${this.state.baseHex} 与对比色 ${this.state.compareHex}，CIEDE2000 ΔE=${de.toFixed(2)}；调色板 ${this.palette.length} 色，含 WCAG 对比度评估。`,
      en: `Colour science: base ${this.state.baseHex} vs ${this.state.compareHex}, CIEDE2000 ΔE=${de.toFixed(2)}; ${this.palette.length}-colour palette with WCAG contrast evaluation.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '色彩科学分析', en: 'Colour Science Analysis' },
      caption,
      colorFigurePanels({ palette: this.palette, reference: base }),
    );
  }

  // ---- helpers ---------------------------------------------------------------

  private base(): RGB {
    return hexToRgb(this.state.baseHex) ?? [0.145, 0.388, 0.922];
  }

  private compare(): RGB {
    return hexToRgb(this.state.compareHex) ?? [0.961, 0.62, 0.043];
  }

  private harmonyColors(): RGB[] {
    return harmony(this.base(), this.state.rule);
  }

  private publish() {
    const base = this.base();
    const compare = this.compare();
    const lab = rgbToLab(base);
    const lch = labToLch(lab);
    const de2000 = deltaE2000(lab, rgbToLab(compare));
    const contrast = contrastRatio(base, compare);
    const metrics: ScienceMetric[] = [
      {
        key: 'lab-l',
        label: 'L* (base)',
        value: fmtMetric(lch[0]),
        unit: 'L*',
        severity: 'info',
        hint: `${this.state.baseHex} · ${this.zh ? 'CIELAB 明度' : 'CIELAB lightness'}`,
      },
      {
        key: 'lch',
        label: 'Chroma / hue',
        value: `${lch[1].toFixed(1)} / ${lch[2].toFixed(1)}°`,
        severity: 'info',
        hint: this.zh ? 'CIELCH 彩度 C* 与色相角 h°' : 'CIELCH chroma C* and hue angle h°',
      },
      {
        key: 'delta-e2000',
        label: 'CIEDE2000',
        value: fmtMetric(de2000),
        severity: de2000 < 2 ? 'ok' : de2000 < 10 ? 'warn' : 'info',
        hint: this.zh
          ? `基准色与对比色的 CIEDE2000 色差（<2 肉眼几乎不可辨）`
          : `CIEDE2000 difference between base and compare (<2 is near-imperceptible)`,
      },
      {
        key: 'contrast',
        label: 'WCAG contrast',
        value: fmtMetric(contrast, 2),
        unit: ':1',
        severity: contrast >= 7 ? 'ok' : contrast >= 4.5 ? 'info' : 'warn',
        hint: `${this.zh ? '等级' : 'level'} ${wcagLevel(contrast)} · ${this.zh ? '基准色/对比色' : 'base/compare'}`,
      },
      {
        key: 'palette-count',
        label: 'Palette colours',
        value: String(this.palette.length),
        severity: 'info',
        hint: this.zh ? '当前调色板（导入 CSV 可替换）' : 'current palette (import a CSV to replace)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 820;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const base = this.base();
    this.publish();

    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(235,241,250,0.96)';
    const titles: Record<ViewId, [string, string]> = {
      chromaticity: ['CIE 色度图', 'CIE chromaticity diagram'],
      spaces: ['色彩空间换算', 'Colour-space conversion'],
      harmony: ['配色规则', 'Colour harmony'],
      palette: ['调色板与可访问性', 'Palette & accessibility'],
      vision: ['色觉模拟', 'Colour-vision simulation'],
    };
    g.fillText(titles[this.state.view][zh ? 0 : 1], canvas.width / 2, 20);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText(
      zh
        ? `基准色 ${this.state.baseHex} · 对比色 ${this.state.compareHex}`
        : `base ${this.state.baseHex} · compare ${this.state.compareHex}`,
      canvas.width / 2,
      38,
    );

    switch (this.state.view) {
      case 'spaces':
        this.drawSpaces(g, canvas, base, zh);
        break;
      case 'harmony':
        this.drawSwatches(g, canvas, this.harmonyColors(), zh);
        break;
      case 'palette':
        this.drawPalette(g, canvas, zh);
        break;
      case 'vision':
        this.drawVision(g, canvas, zh);
        break;
      default:
        this.drawChromaticity(g, canvas, base, zh);
    }
  }

  private drawChromaticity(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, base: RGB, zh: boolean) {
    const x0 = 60;
    const x1 = canvas.width - 30;
    const y0 = 58;
    const y1 = canvas.height - 50;
    const plotW = Math.max(x1 - x0, 20);
    const plotH = Math.max(y1 - y0, 20);
    const uv = this.state.uv;
    const mapPt = (p: { x: number; y: number }): { x: number; y: number } =>
      uv ? { x: (4 * p.x) / (-2 * p.x + 12 * p.y + 3), y: (9 * p.y) / (-2 * p.x + 12 * p.y + 3) } : p;
    const xMax = uv ? 0.62 : 0.8;
    const yMax = uv ? 0.6 : 0.9;
    const px = (x: number) => x0 + (x / xMax) * plotW;
    const py = (y: number) => y1 - (y / yMax) * plotH;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.font = `10px Consolas, monospace`;
    g.textAlign = 'center';
    for (let x = 0; x <= xMax + 1e-9; x += 0.1) {
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(px(x), y0);
      g.lineTo(px(x), y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.fillText(x.toFixed(1), px(x), y1 + 14);
    }
    g.textAlign = 'right';
    for (let y = 0; y <= yMax + 1e-9; y += 0.1) {
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, py(y));
      g.lineTo(x1, py(y));
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.8)';
      g.fillText(y.toFixed(1), x0 - 6, py(y) + 3);
    }

    const locus = spectralLocus(380, 700, 5).map(mapPt);
    g.strokeStyle = 'rgba(240,244,250,0.9)';
    g.lineWidth = 1.4;
    g.beginPath();
    locus.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), py(p.y)) : g.lineTo(px(p.x), py(p.y))));
    g.closePath();
    g.stroke();

    // sRGB primary triangle
    const gamut = [
      mapPt({ x: 0.64, y: 0.33 }),
      mapPt({ x: 0.3, y: 0.6 }),
      mapPt({ x: 0.15, y: 0.06 }),
    ];
    g.strokeStyle = 'rgba(120,200,255,0.9)';
    g.setLineDash([4, 3]);
    g.beginPath();
    gamut.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), py(p.y)) : g.lineTo(px(p.x), py(p.y))));
    g.closePath();
    g.stroke();
    g.setLineDash([]);

    const [bx, by] = xyzToXy(rgbToXyz(base));
    const b = mapPt({ x: bx, y: by });
    const [cx, cy] = xyzToXy(rgbToXyz(this.compare()));
    const c = mapPt({ x: cx, y: cy });
    g.fillStyle = rgbToHex(base);
    g.beginPath();
    g.arc(px(b.x), py(b.y), 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = rgbToHex(this.compare());
    g.beginPath();
    g.arc(px(c.x), py(c.y), 5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.stroke();

    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `${uv ? "u′" : 'x'} — ${uv ? "v′" : 'y'} 色度平面；白色实线为光谱轨迹，虚线为 sRGB 色域。`
        : `${uv ? "u′" : 'x'} — ${uv ? "v′" : 'y'} plane; solid = spectral locus, dashed = sRGB gamut.`,
      x0,
      y1 + 30,
    );
    g.fillText(
      zh
        ? `基准色坐标 (${bx.toFixed(4)}, ${by.toFixed(4)}) · 对比色 (${cx.toFixed(4)}, ${cy.toFixed(4)})`
        : `base (${bx.toFixed(4)}, ${by.toFixed(4)}) · compare (${cx.toFixed(4)}, ${cy.toFixed(4)})`,
      x0,
      y1 + 44,
    );
  }

  private drawSpaces(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, base: RGB, zh: boolean) {
    const compare = this.compare();
    const x0 = 54;
    const sw = 150;
    const swatch = (rgb: RGB, x: number, y: number, label: string) => {
      g.fillStyle = rgbToHex(rgb);
      g.fillRect(x, y, sw, sw * 0.62);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.strokeRect(x, y, sw, sw * 0.62);
      g.fillStyle = 'rgba(235,241,250,0.95)';
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.fillText(label, x, y + sw * 0.62 + 15);
    };
    swatch(base, x0, 60, `${zh ? '基准' : 'base'} ${this.state.baseHex}`);
    swatch(compare, x0 + 190, 60, `${zh ? '对比' : 'compare'} ${this.state.compareHex}`);

    const rows: Array<[string, string, string]> = [];
    for (const [label, rgb] of [
      ['base', base],
      ['compare', compare],
    ] as Array<[string, RGB]>) {
      const xyz = rgbToXyz(rgb);
      const lab = rgbToLab(rgb);
      const lch = labToLch(lab);
      const hsv = rgbToHsv(rgb);
      const hsl = rgbToHsl(rgb);
      const [x, y] = xyzToXy(xyz);
      rows.push([label, 'XYZ', xyz.map((v) => v.toFixed(2)).join(', ')]);
      rows.push([label, 'Lab', lab.map((v) => v.toFixed(2)).join(', ')]);
      rows.push([label, 'LCH', `${lch[0].toFixed(2)}, ${lch[1].toFixed(2)}, ${lch[2].toFixed(2)}°`]);
      rows.push([label, 'HSV', `${hsv[0].toFixed(0)}°, ${(hsv[1] * 100).toFixed(1)}%, ${(hsv[2] * 100).toFixed(1)}%`]);
      rows.push([label, 'HSL', `${hsl[0].toFixed(0)}°, ${(hsl[1] * 100).toFixed(1)}%, ${(hsl[2] * 100).toFixed(1)}%`]);
      rows.push([label, 'xy', `${x.toFixed(4)}, ${y.toFixed(4)}`]);
    }

    const t0 = 60;
    const tx = x0 + 380;
    const cw = (canvas.width - tx - 26) / 2;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    rows.forEach((r, i) => {
      const y = t0 + i * 22;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(r[0], tx, y);
      g.fillStyle = 'rgba(235,241,250,0.95)';
      g.fillText(r[1], tx + cw * 0.5, y);
      g.fillStyle = 'rgba(120,200,255,0.95)';
      g.fillText(r[2], tx + cw * 1.05, y);
    });

    const de2000 = deltaE2000(rgbToLab(base), rgbToLab(compare));
    const contrast = contrastRatio(base, compare);
    g.fillStyle = 'rgba(255,214,102,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `ΔE2000 = ${de2000.toFixed(3)} · ΔE76 = ${deltaE76(rgbToLab(base), rgbToLab(compare)).toFixed(3)} · 对比度 = ${contrast.toFixed(2)}:1（${wcagLevel(contrast)}）`
        : `ΔE2000 = ${de2000.toFixed(3)} · ΔE76 = ${deltaE76(rgbToLab(base), rgbToLab(compare)).toFixed(3)} · contrast = ${contrast.toFixed(2)}:1 (${wcagLevel(contrast)})`,
      tx,
      t0 + rows.length * 22 + 10,
    );
  }

  private drawSwatches(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, colors: RGB[], zh: boolean) {
    const x0 = 50;
    const y0 = 66;
    const gap = 12;
    const n = Math.max(colors.length, 1);
    const w = Math.min(150, (canvas.width - x0 * 2 - gap * (n - 1)) / n);
    const h = Math.min(150, canvas.height * 0.42);
    colors.forEach((rgb, i) => {
      const x = x0 + i * (w + gap);
      g.fillStyle = rgbToHex(rgb);
      g.fillRect(x, y0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.strokeRect(x, y0, w, h);
      const lab = rgbToLab(rgb);
      const lch = labToLch(lab);
      const cBlack = contrastRatio(rgb, [0, 0, 0]);
      const cWhite = contrastRatio(rgb, [1, 1, 1]);
      g.font = `11px Consolas, monospace`;
      g.textAlign = 'left';
      g.fillStyle = 'rgba(235,241,250,0.96)';
      g.fillText(rgbToHex(rgb), x, y0 + h + 16);
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(`L* ${lch[0].toFixed(1)} · C* ${lch[1].toFixed(1)}`, x, y0 + h + 30);
      g.fillText(`h ${lch[2].toFixed(0)}°`, x, y0 + h + 43);
      g.fillStyle = 'rgba(255,214,102,0.9)';
      g.fillText(
        zh ? `黑 ${cBlack.toFixed(1)}:1 · 白 ${cWhite.toFixed(1)}:1` : `black ${cBlack.toFixed(1)}:1 · white ${cWhite.toFixed(1)}:1`,
        x,
        y0 + h + 57,
      );
    });
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(
      zh
        ? `配色规则：${HARMONY_RULES[this.state.rule].zh}（以 ${this.state.baseHex} 为基准）`
        : `rule: ${HARMONY_RULES[this.state.rule].en} (base ${this.state.baseHex})`,
      x0,
      y0 + h + 82,
    );
    g.fillText(
      zh
        ? 'WCAG：正文 ≥4.5:1（AA），大字 ≥3:1（AA-large），增强 ≥7:1（AAA）。'
        : 'WCAG: body text ≥4.5:1 (AA), large text ≥3:1 (AA-large), enhanced ≥7:1 (AAA).',
      x0,
      y0 + h + 100,
    );
  }

  private drawPalette(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(this.palette.length))));
    const rows = Math.ceil(this.palette.length / cols);
    const x0 = 50;
    const y0 = 62;
    const gap = 10;
    const w = Math.min(168, (canvas.width - x0 * 2 - gap * (cols - 1)) / cols);
    const h = Math.min(96, (canvas.height - y0 - 80 - gap * (rows - 1)) / rows);
    const baseLab = rgbToLab(this.base());
    this.palette.forEach((p, i) => {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      const x = x0 + cx * (w + gap);
      const y = y0 + cy * (h + gap);
      g.fillStyle = p.hex;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.strokeRect(x, y, w, h);
      const de = deltaE2000(baseLab, rgbToLab(p.rgb));
      const cB = contrastRatio(p.rgb, [0, 0, 0]);
      const cW = contrastRatio(p.rgb, [1, 1, 1]);
      g.font = `10px Consolas, monospace`;
      g.textAlign = 'left';
      g.fillStyle = 'rgba(235,241,250,0.96)';
      g.fillText(`${p.name} · ${p.hex}`, x, y + h + 13);
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(
        zh
          ? `ΔE2000 ${de.toFixed(1)} · 对比 黑 ${cB.toFixed(1)} / 白 ${cW.toFixed(1)}`
          : `ΔE2000 ${de.toFixed(1)} · contrast black ${cB.toFixed(1)} / white ${cW.toFixed(1)}`,
        x,
        y + h + 26,
      );
    });
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? '导入 CSV（name, hex）可替换调色板；ΔE 相对当前基准色。'
        : 'Import a CSV (name, hex) to replace the palette; ΔE is relative to the base colour.',
      x0,
      canvas.height - 18,
    );
  }

  private drawVision(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const colors = this.harmonyColors();
    const types: CvdType[] = ['protanopia', 'deuteranopia', 'tritanopia'];
    const x0 = 54;
    const y0 = 70;
    const rowH = Math.min(84, (canvas.height - y0 - 70) / (types.length + 1));
    const sw = Math.min(120, (canvas.width - x0 * 2) / (colors.length + 1));
    const labelW = 120;
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const labels = [
      zh ? '正常视觉' : 'normal',
      zh ? '红色盲' : 'protanopia',
      zh ? '绿色盲' : 'deuteranopia',
      zh ? '蓝色盲' : 'tritanopia',
    ];
    const rows = [colors, ...types.map((t) => colors.map((c) => simulateCvd(c, t)))];
    rows.forEach((row, ri) => {
      const y = y0 + ri * rowH;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(labels[ri]!, x0, y + rowH / 2);
      row.forEach((rgb, ci) => {
        const x = x0 + labelW + ci * (sw + 6);
        g.fillStyle = rgbToHex(rgb);
        g.fillRect(x, y + 8, sw, rowH - 20);
        g.strokeStyle = 'rgba(255,255,255,0.2)';
        g.strokeRect(x, y + 8, sw, rowH - 20);
        g.fillStyle = 'rgba(170,182,200,0.85)';
        g.fillText(rgbToHex(rgb), x, y + rowH - 4);
      });
    });
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText(
      zh
        ? `${this.state.cvd} 模拟：Viénot–Brettel–Mollon 线性近似（非医学诊断）。`
        : `${this.state.cvd} simulation: Viénot–Brettel–Mollon linear approximation (not a medical diagnosis).`,
      x0,
      canvas.height - 20,
    );
  }
}

export default function createColorSciencePlugin(): Plugin {
  return new ColorSciencePlugin();
}
