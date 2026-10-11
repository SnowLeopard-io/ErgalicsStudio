// ==========================================================================
// bio-mendel — chi-square goodness-of-fit workbench (canvas)
//
// Draws observed vs expected counts per trait group (Mendel 1866 reference
// data by default, or a user CSV), annotates each group with its χ² p-value
// and publishes per-benchmark errors plus the pooled χ²/df/p verdict to the
// scientific-output strip. All numerics live in ./kernel (pure, DOM-free).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { bioMendelManifest } from './manifest';
import {
  MENDEL_F2_TRAITS,
  groupTraits,
  mergedChiSquare,
  parseTraitCsv,
  runMendelBenchmarks,
  type TraitRow,
} from './kernel';

export { bioMendelManifest } from './manifest';

interface State {
  rows: TraitRow[];
  alpha: number;
}

export class BioMendelPlugin implements Plugin {
  readonly manifest = bioMendelManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    rows: MENDEL_F2_TRAITS,
    alpha: 0.05,
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
    return [
      {
        key: 'alpha',
        label: 'α',
        labelI18n: { 'zh-CN': '显著性水平 α', 'en-US': 'Significance level α' },
        type: 'select',
        options: [
          { value: '0.05', label: '0.05', labelI18n: { 'zh-CN': '0.05', 'en-US': '0.05' } },
          { value: '0.01', label: '0.01', labelI18n: { 'zh-CN': '0.01', 'en-US': '0.01' } },
        ],
        value: String(this.state.alpha),
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export per-trait χ² summary', '导出逐性状 χ² 汇总'),
      actionButton('restoreDemo', 'Restore Mendel 1866 reference data', '恢复孟德尔 1866 参考数据'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.alpha === 'string') {
      const a = Number(params.alpha);
      if ((a === 0.05 || a === 0.01) && a !== this.state.alpha) {
        this.state.alpha = a;
        this.draw();
      }
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'restoreDemo')) {
      this.state.rows = MENDEL_F2_TRAITS;
      this.draw();
      notify(
        this.api,
        'info',
        'Restored the Mendel 1866 seven-trait reference dataset.',
        '已恢复孟德尔 1866 七性状参考数据。',
      );
    }
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
        'bio-mendel accepts trait,category,observed,expectedRatio CSV/TSV/TXT.',
        'bio-mendel 仅接受 trait,category,observed,expectedRatio 的 CSV/TSV/TXT。',
      );
      return;
    }
    const text = await file.text();
    const rows = parseTraitCsv(text);
    if (rows.length === 0) {
      notify(
        this.api,
        'error',
        'No valid count rows found — need columns trait,category,observed,expectedRatio (or bare observed,expectedRatio).',
        '未找到有效计数行——需要 trait,category,observed,expectedRatio 列（或裸的 observed,expectedRatio 两列）。',
      );
      return;
    }
    this.state.rows = rows;
    this.draw();
    this.publishPooled();
    notify(
      this.api,
      'success',
      `Loaded ${rows.length} count rows across ${new Set(rows.map((r) => r.trait)).size} trait groups.`,
      `已加载 ${rows.length} 行计数，共 ${new Set(rows.map((r) => r.trait)).size} 个性状组。`,
    );
  }

  // ---- science outputs -------------------------------------------------------

  private publishPooled() {
    const tests = groupTraits(this.state.rows);
    const pooled = mergedChiSquare(tests);
    const metrics: ScienceMetric[] = [
      {
        key: 'pooled-chi2',
        label: this.zh ? '合并 χ²' : 'Pooled χ²',
        value: fmtMetric(pooled.chi2),
        unit: '',
        severity: 'info',
        hint: this.zh ? 'Σ 各独立性状 χ²（同一原假设下可加）' : 'Σ of independent per-trait χ² (additive under H0)',
      },
      {
        key: 'pooled-df',
        label: 'df',
        value: String(pooled.df),
        unit: '',
        severity: 'info',
      },
      {
        key: 'pooled-p',
        label: this.zh ? '合并 p 值' : 'Pooled p',
        value: fmtMetric(pooled.p),
        unit: '',
        severity: pooled.p >= this.state.alpha ? 'ok' : 'error',
        hint:
          pooled.p >= this.state.alpha
            ? this.zh
              ? `p ≥ ${this.state.alpha}：不拒绝分离比假设`
              : `p ≥ ${this.state.alpha}: segregation ratios not rejected`
            : this.zh
              ? `p < ${this.state.alpha}：显著偏离期望分离比`
              : `p < ${this.state.alpha}: significant deviation from expected ratios`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const bench = runMendelBenchmarks();
    const worst = bench.reduce((acc, b) => Math.max(acc, b.relErr), 0);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `mendel-bench-${b.key}`,
      label: `Bench · ${b.key}`,
      value: fmtMetric(b.relErr),
      unit: 'rel',
      severity: b.relErr < b.tolerance ? 'ok' : 'error',
      hint: `${b.label} — tol ${b.tolerance.toExponential(0)}`,
    }));
    const tests = groupTraits(this.state.rows);
    const pooled = mergedChiSquare(tests);
    metrics.push(
      {
        key: 'pooled-chi2',
        label: this.zh ? '合并 χ²' : 'Pooled χ²',
        value: fmtMetric(pooled.chi2),
        unit: '',
        severity: 'info',
      },
      {
        key: 'pooled-df',
        label: 'df',
        value: String(pooled.df),
        unit: '',
        severity: 'info',
      },
      {
        key: 'pooled-p',
        label: this.zh ? '合并 p 值' : 'Pooled p',
        value: fmtMetric(pooled.p),
        unit: '',
        severity: pooled.p >= this.state.alpha ? 'ok' : 'error',
        hint: this.zh
          ? pooled.p >= this.state.alpha
            ? '观测计数与孟德尔分离比一致'
            : '观测计数显著偏离期望分离比'
          : pooled.p >= this.state.alpha
            ? 'counts consistent with the segregation ratios'
            : 'counts deviate significantly from the ratios',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      bench.every((b) => b.relErr < b.tolerance) ? 'success' : 'warning',
      bench.every((b) => b.relErr < b.tolerance)
        ? `All χ² benchmarks passed (worst rel. err ${worst.toExponential(2)}).`
        : `χ² benchmark failed — worst rel. err ${worst.toExponential(2)}.`,
      bench.every((b) => b.relErr < b.tolerance)
        ? `全部 χ² 基准通过（最大相对误差 ${worst.toExponential(2)}）。`
        : `χ² 基准未通过——最大相对误差 ${worst.toExponential(2)}。`,
    );
  }

  private exportCsv() {
    const tests = groupTraits(this.state.rows);
    const header = ['trait', 'categories', 'observed_total', 'chi2', 'df', 'p', 'verdict'];
    const rows = tests.map((t) => [
      t.trait,
      t.categories.join('|'),
      String(t.observed.reduce((a, b) => a + b, 0)),
      Number.isFinite(t.result.chi2) ? t.result.chi2.toFixed(6) : 'NA',
      String(t.result.df),
      Number.isFinite(t.result.p) ? t.result.p.toFixed(6) : 'NA',
      t.result.p >= this.state.alpha ? 'consistent' : 'deviates',
    ]);
    exportRowsCsv(this.api, 'bio-mendel-chi2-summary', header, rows);
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const tests = groupTraits(this.state.rows);
    if (tests.length === 0) {
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(this.zh ? '暂无数据 — 请加载 CSV 或恢复参考数据' : 'No data — load a CSV or restore the reference data', canvas.width / 2, canvas.height / 2);
      return;
    }

    const padL = 60;
    const padR = 18;
    const padT = 46;
    const padB = 64;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    let yMax = 0;
    for (const t of tests) {
      for (const v of t.observed) yMax = Math.max(yMax, v);
      for (const e of t.result.expected) yMax = Math.max(yMax, e);
    }
    yMax = yMax <= 0 ? 1 : yMax * 1.12;
    const py = (v: number): number => y1 - (plotH * Math.max(v, 0)) / yMax;

    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `孟德尔 F2 分离比 χ² 检验 · ${tests.length} 组 · α=${this.state.alpha}`
        : `Mendel F2 segregation χ² tests · ${tests.length} groups · α=${this.state.alpha}`,
      canvas.width / 2,
      20,
    );

    // y grid + ticks
    g.textAlign = 'right';
    g.font = '10px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const v = (yMax * i) / 4;
      const sy = py(v);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v >= 1000 ? `${Math.round(v / 1000)}k` : v.toFixed(0), x0 - 6, sy + 3);
    }

    // grouped bars: observed vs expected per category
    const n = tests.length;
    const groupW = plotW / n;
    tests.forEach((t, gi) => {
      const k = t.observed.length;
      const barW = Math.max(3, Math.min(16, (groupW - 10) / (2 * k + 1)));
      const totalW = k * 2 * barW + Math.max(k - 1, 0) * 4;
      const startX = x0 + groupW * gi + (groupW - totalW) / 2;
      for (let ci = 0; ci < k; ci += 1) {
        const ox = startX + ci * (2 * barW + 4);
        // observed
        g.fillStyle = 'rgba(120, 200, 250, 0.95)';
        g.fillRect(ox, py(t.observed[ci]!), barW, y1 - py(t.observed[ci]!));
        // expected under H0
        g.fillStyle = 'rgba(240, 170, 110, 0.9)';
        g.fillRect(ox + barW, py(t.result.expected[ci]!), barW, y1 - py(t.result.expected[ci]!));
      }
      // labels below group
      const cx = x0 + groupW * gi + groupW / 2;
      g.textAlign = 'center';
      const sig = t.result.p < this.state.alpha;
      g.fillStyle = sig ? 'rgba(255, 130, 130, 0.95)' : 'rgba(200, 214, 232, 0.9)';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(t.trait, cx, y1 + 14);
      g.font = '9px Consolas, monospace';
      g.fillStyle = sig ? 'rgba(255, 130, 130, 0.95)' : 'rgba(120, 225, 170, 0.85)';
      g.fillText(`χ²=${t.result.chi2.toFixed(2)} p=${t.result.p.toFixed(3)}`, cx, y1 + 27);
    });
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, plotW, plotH);

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 4;
    g.fillStyle = 'rgba(120, 200, 250, 0.95)';
    g.fillRect(x1 - 168, ly, 14, 8);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText(zh ? '观测计数 O' : 'observed O', x1 - 150, ly + 8);
    ly += 16;
    g.fillStyle = 'rgba(240, 170, 110, 0.9)';
    g.fillRect(x1 - 168, ly, 14, 8);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText(zh ? '期望计数 E（按比例归一）' : 'expected E (ratio-normalized)', x1 - 150, ly + 8);
    ly += 16;
    g.fillStyle = 'rgba(120, 225, 170, 0.85)';
    g.fillText(zh ? '绿字 p≥α；红字 p<α（显著偏离）' : 'green p≥α; red p<α (deviation)', x1 - 150, ly + 6);

    // pooled footer
    const pooled = mergedChiSquare(tests);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const verdict =
      pooled.p >= this.state.alpha
        ? zh
          ? '与期望分离比一致'
          : 'consistent with expected ratios'
        : zh
          ? '显著偏离期望分离比'
          : 'deviates significantly';
    g.fillText(
      zh
        ? `合并检验：χ²=${pooled.chi2.toFixed(3)}  df=${pooled.df}  p=${pooled.p.toFixed(4)} → ${verdict}`
        : `Pooled: χ²=${pooled.chi2.toFixed(3)}  df=${pooled.df}  p=${pooled.p.toFixed(4)} → ${verdict}`,
      54,
      canvas.height - 14,
    );
  }
}

export default function createBioMendelPlugin(): Plugin {
  return new BioMendelPlugin();
}
