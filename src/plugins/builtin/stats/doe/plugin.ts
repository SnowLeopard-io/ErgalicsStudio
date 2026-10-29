// ==========================================================================
// DOE — Design of Experiments plugin
//
// Canvas: a Pareto chart of standardised effects (|t| against the t critical
// value) plus the ANOVA table. Params let the user switch between the
// main-effects and main-plus-interactions models and choose the Taguchi S/N
// goal. The fitted model, effect sizes and validation benchmarks are exported
// through the science strip and Figure Studio.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { studentTInv } from '@/core/stats/special';
import { fmtMetric } from '@/core/research/scienceOutput';
import {
  CS,
  drawCard,
  drawTable,
  drawAxes,
  font,
  plotBox,
} from '../../shared/cs-utils';
import { fmt, fmtP, xScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsDoeManifest } from './manifest';
import { doeBenchmark, factorEffects, fitDoe, orthogonalityDefect, parseDoeTable, taguchiSN, type DoeFit } from './kernel';
import { doeFigurePanels } from './figure';

const DEFAULT_DATA = `run,A,B,C,response
1,-1,-1,-1,7.42
2,1,-1,-1,11.18
3,-1,1,-1,8.61
4,1,1,-1,13.02
5,-1,-1,1,7.88
6,1,-1,1,11.55
7,-1,1,1,9.14
8,1,1,1,13.41
9,-1,-1,-1,7.51
10,1,-1,-1,11.09
11,-1,1,-1,8.72
12,1,1,-1,12.91
13,-1,-1,1,7.79
14,1,-1,1,11.63
15,-1,1,1,9.21
16,1,1,1,13.35`;

interface DoeState {
  order: 1 | 2;
  goal: 'smaller' | 'larger' | 'nominal';
}

export class StatsDoePlugin extends StatsPluginBase<DoeState, DoeFit> {
  constructor() {
    super(statsDoeManifest, { order: 2, goal: 'smaller' }, DEFAULT_DATA);
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.select('order', 'Model order', '模型阶数', String(this.state.order), [
        { value: '1', en: 'Main effects', zh: '主效应' },
        { value: '2', en: 'Main + two-way', zh: '主效应 + 二阶交互' },
      ]),
      this.select('goal', 'Taguchi S/N goal', '田口信噪比目标', this.state.goal, [
        { value: 'smaller', en: 'Smaller is better', zh: '望小' },
        { value: 'larger', en: 'Larger is better', zh: '望大' },
        { value: 'nominal', en: 'Nominal is best', zh: '望目' },
      ]),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if (params.order === '1' || params.order === '2') {
      const order = Number(params.order) as 1 | 2;
      if (order !== this.state.order) {
        this.state.order = order;
        dirty = true;
      }
    }
    if (params.goal === 'smaller' || params.goal === 'larger' || params.goal === 'nominal') {
      if (params.goal !== this.state.goal) {
        this.state.goal = params.goal;
        dirty = true;
      }
    }
    return dirty;
  }

  protected computeResult(): DoeFit | null {
    const dataset = parseDoeTable(this.text);
    return fitDoe(dataset, this.state.order);
  }

  protected metrics(result: DoeFit): ScienceMetric[] {
    const dataset = parseDoeTable(this.text);
    const orth = orthogonalityDefect(result.design);
    const effects = factorEffects(dataset);
    const best = effects
      .map((f) => ({ factor: f.factor, spread: Math.max(...f.levels.map((l) => l.mean)) - Math.min(...f.levels.map((l) => l.mean)) }))
      .sort((a, b) => b.spread - a.spread)[0];
    // The strongest standardised coefficient drives the Pareto chart.
    const top = [...result.coefficients].sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
    return [
      {
        key: 'r2',
        label: this.zh ? '决定系数 R²' : 'R²',
        value: fmtMetric(result.r2),
        severity: result.r2 > 0.95 ? 'ok' : result.r2 > 0.8 ? 'warn' : 'info',
        hint: this.zh ? `调整 R²=${fmt(result.adjR2, 4)}，n=${result.n}` : `adjusted R²=${fmt(result.adjR2, 4)}, n=${result.n}`,
      },
      {
        key: 'rmse',
        label: 'RMSE',
        value: fmtMetric(result.rmse),
        severity: 'info',
        hint: this.zh ? `残差自由度 ${result.anova.at(-1)?.df ?? 0}` : `residual df ${result.anova.at(-1)?.df ?? 0}`,
      },
      {
        key: 'orthogonality',
        label: this.zh ? '正交性缺陷' : 'Orthogonality defect',
        value: fmt(orth, 6),
        severity: orth < 1e-9 ? 'ok' : 'warn',
        hint: this.zh ? '编码列间最大 |r|' : 'max |r| across coded columns',
      },
      {
        key: 'top-effect',
        label: this.zh ? '最强效应' : 'Strongest effect',
        value: top ? fmt(top.estimate, 4) : '—',
        hint: top ? `${top.term} · |t|=${fmt(Math.abs(top.t), 3)} · p=${fmtP(top.p)}` : '—',
      },
      {
        key: 'best-factor',
        label: this.zh ? '极差最大因子' : 'Largest factor spread',
        value: best ? fmt(best.spread, 3) : '—',
        hint: best ? best.factor : '—',
      },
      {
        key: 'sn',
        label: this.zh ? '最优水平 S/N' : 'Best-level S/N',
        value: fmt(taguchiSN(dataset.rows.map((r) => r.response), this.state.goal), 3),
        unit: 'dB',
        hint: this.zh ? `田口目标：${this.state.goal}` : `Taguchi goal: ${this.state.goal}`,
      },
    ];
  }

  protected benchmark(): BenchRow[] {
    return doeBenchmark().map((b) => ({
      id: b.id,
      labelEn: b.id === 'doe-orthogonality' ? 'Coded-column orthogonality' : '2³ coefficient recovery',
      labelZh: b.id === 'doe-orthogonality' ? '编码列正交性' : '2³ 系数回收',
      passed: b.passed,
      value: b.relErr < 1e-3 ? b.relErr.toExponential(2) : fmt(b.relErr, 6),
      detail: b.detail,
    }));
  }

  protected csv(result: DoeFit): CsvPayload {
    return {
      name: 'doe-anova',
      header: ['term', 'estimate', 'std_error', 't', 'p', 'df', 'ss', 'ms', 'F', 'partial_eta2'],
      rows: result.coefficients.map((c) => {
        const row = result.anova.find((a) => a.term === c.term);
        return [c.term, c.estimate, c.se, c.t, c.p, row?.df ?? '', row?.ss ?? '', row?.ms ?? '', row?.f ?? '', row?.eta2 ?? ''];
      }),
    };
  }

  protected figurePanels(result: DoeFit): FigurePanelSpec[] {
    return doeFigurePanels(result, parseDoeTable(this.text));
  }

  protected figureTitle() {
    return { zh: '试验设计 · 效应与方差分析', en: 'Design of Experiments · Effects & ANOVA' };
  }

  protected figureCaption(result: DoeFit) {
    return {
      zh: `DOE（n=${result.n}，${result.order === 1 ? '主效应' : '主效应+二阶交互'}）：R²=${fmtMetric(result.r2)}，调整 R²=${fmtMetric(result.adjR2)}，RMSE=${fmtMetric(result.rmse)}；编码列正交性缺陷 ${fmt(orthogonalityDefect(result.design), 8)}。`,
      en: `DOE (n=${result.n}, ${result.order === 1 ? 'main effects' : 'main effects + two-way interactions'}): R²=${fmtMetric(result.r2)}, adjusted R²=${fmtMetric(result.adjR2)}, RMSE=${fmtMetric(result.rmse)}; coded-column orthogonality defect ${fmt(orthogonalityDefect(result.design), 8)}.`,
    };
  }

  protected title(): string {
    return this.zh ? '试验设计（DOE）效应分析' : 'Design of Experiments — Effect Analysis';
  }

  protected subtitle(): string {
    const dataset = parseDoeTable(this.text);
    return this.zh
      ? `${dataset.factors.length} 个因子 · ${dataset.rows.length} 次试验 · 响应 ${dataset.response} · ${this.state.order === 1 ? '仅主效应' : '主效应 + 二阶交互'}`
      : `${dataset.factors.length} factors · ${dataset.rows.length} runs · response ${dataset.response} · ${this.state.order === 1 ? 'main effects only' : 'main effects + two-way'}`;
  }

  protected footnote(): string {
    return this.zh
      ? '条形 = 标准化效应 |t|；橙色虚线 = 双侧 5% t 临界值。R² 与 ANOVA 来自同一最小二乘拟合。'
      : 'Bars = standardised effect |t|; orange dashed line = two-sided 5% t critical value. R² and ANOVA share the same least-squares fit.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, result: DoeFit | null): void {
    if (!result) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '数据不足：需要至少 n > p 的试验行。' : 'Not enough runs: need n > p.', w / 2, h / 2);
      return;
    }
    const box = plotBox(w, h, 72, 82, 32, Math.max(150, Math.round(h * 0.38)));
    const effects = [...result.coefficients].sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 10);
    const critical = studentTInv(0.975, Math.max(1, result.n - result.coefficients.length - 1));
    const maxT = Math.max(critical * 1.35, ...effects.map((e) => Math.abs(e.t)), 1);
    const xs = xScale(box, 0, maxT);
    const rowH = box.h / Math.max(1, effects.length);
    const yAt = (i: number) => box.y0 + rowH * (i + 0.5);

    drawAxes(
      g,
      box,
      [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: f, label: fmt(maxT * f, 1) })),
      [],
      this.zh ? '|t| 统计量' : '|t| statistic',
      '',
      this.zh,
    );
    effects.forEach((e, i) => {
      const y = yAt(i);
      const significant = Math.abs(e.t) >= critical;
      g.fillStyle = significant ? 'rgba(250,180,90,0.85)' : 'rgba(120,200,255,0.5)';
      g.fillRect(box.x0, y - rowH * 0.3, Math.max(1, xs(Math.abs(e.t)) - box.x0), rowH * 0.6);
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 9.5);
      g.textAlign = 'right';
      g.fillText(e.term.length > 12 ? `${e.term.slice(0, 11)}…` : e.term, box.x0 - 8, y + 3);
      g.textAlign = 'left';
      g.fillStyle = CS.faint;
      g.fillText(`${fmt(Math.abs(e.t), 2)}`, xs(Math.abs(e.t)) + 5, y + 3);
    });
    const cx = xs(critical);
    g.strokeStyle = CS.amber;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(cx, box.y0);
    g.lineTo(cx, box.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = CS.amber;
    g.font = font(this.zh, 9.5);
    g.textAlign = 'left';
    g.fillText(`t*.95=${fmt(critical, 2)}`, cx + 4, box.y0 + 11);

    // ANOVA table in the lower band.
    const tableTop = box.y1 + 34;
    drawCard(g, 24, tableTop - 14, w - 48, h - tableTop - 24);
    const rows = result.anova.slice(0, 10).map((a) => [
      a.term,
      a.df,
      fmt(a.ss, 3),
      Number.isFinite(a.f) ? fmt(a.f, 3) : '—',
      Number.isFinite(a.p) ? fmtP(a.p) : '—',
      fmt(a.eta2, 3),
    ]);
    drawTable(g, w, h, ['term', 'df', 'SS', 'F', 'p', 'η²'], rows, { top: tableTop, rowHeight: 16 });
  }
}

export default function createStatsDoePlugin(): StatsDoePlugin {
  return new StatsDoePlugin();
}
