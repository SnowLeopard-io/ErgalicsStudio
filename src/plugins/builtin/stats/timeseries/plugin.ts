// ==========================================================================
// Time Series Analysis plugin
//
// Canvas: the observed series with the ARIMA forecast and confidence band on
// top, ACF and PACF correlograms underneath. The science strip reports the
// unit-root decisions, the selected ARIMA order, GARCH persistence and the
// Granger p-value. Every model is deterministic for a given input.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { CS, drawAxes, drawCard, drawLegend, drawTable, font, plotBox } from '../../shared/cs-utils';
import { fmt, fmtP, xScale, yScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsTimeseriesManifest } from './manifest';
import {
  acf,
  adfTest,
  fitArima,
  fitGarch11,
  forecastArima,
  grangerCausality,
  kpssTest,
  pacf,
  parseSeries,
  ppTest,
  runTimeSeriesBenchmark,
  seasonalDecompose,
  type AcfPoint,
  type ArimaModel,
  type Decomposition,
  type ForecastPoint,
  type GarchFit,
  type GrangerResult,
  type SeriesData,
  type UnitRootTest,
} from './kernel';
import { timeseriesFigurePanels } from './figure';

function defaultData(): string {
  let seed = 20261029;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rows = ['month,value'];
  for (let t = 0; t < 84; t += 1) {
    const noise = (rand() - 0.5) * 1.6;
    const value = 20 + 0.07 * t + 3.2 * Math.sin((2 * Math.PI * t) / 12) + noise;
    rows.push(`${t + 1},${value.toFixed(3)}`);
  }
  return rows.join('\n');
}

export interface TsResult {
  series: SeriesData;
  acf: AcfPoint[];
  pacf: AcfPoint[];
  decomp: Decomposition | null;
  tests: UnitRootTest[];
  arima: ArimaModel | null;
  forecast: ForecastPoint[];
  garch: GarchFit | null;
  granger: GrangerResult[];
}

interface TsState {
  period: number;
  mode: 'additive' | 'multiplicative';
  horizon: number;
  autoOrder: boolean;
}

export class StatsTimeseriesPlugin extends StatsPluginBase<TsState, TsResult> {
  constructor() {
    super(statsTimeseriesManifest, { period: 12, mode: 'additive', horizon: 12, autoOrder: true }, defaultData());
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.rangeParam('period', 'Seasonal period', '季节周期', this.state.period, 2, 24, 1),
      this.select('mode', 'Decomposition', '分解方式', this.state.mode, [
        { value: 'additive', en: 'Additive', zh: '加法' },
        { value: 'multiplicative', en: 'Multiplicative', zh: '乘法' },
      ]),
      this.rangeParam('horizon', 'Forecast horizon', '预测步长', this.state.horizon, 4, 36, 1),
      this.checkParam('autoOrder', 'AIC order search', 'AIC 自动定阶', this.state.autoOrder),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if (typeof params.period === 'number' && Number.isFinite(params.period)) {
      const period = Math.min(24, Math.max(2, Math.round(params.period)));
      if (period !== this.state.period) {
        this.state.period = period;
        dirty = true;
      }
    }
    if (params.mode === 'additive' || params.mode === 'multiplicative') {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        dirty = true;
      }
    }
    if (typeof params.horizon === 'number' && Number.isFinite(params.horizon)) {
      const horizon = Math.min(36, Math.max(4, Math.round(params.horizon)));
      if (horizon !== this.state.horizon) {
        this.state.horizon = horizon;
        dirty = true;
      }
    }
    if (typeof params.autoOrder === 'boolean' && params.autoOrder !== this.state.autoOrder) {
      this.state.autoOrder = params.autoOrder;
      dirty = true;
    }
    return dirty;
  }

  protected computeResult(): TsResult | null {
    const series = parseSeries(this.text);
    if (series.values.length < 8) return null;
    const maxLag = Math.min(24, Math.floor(series.values.length / 3));
    const arima = this.state.autoOrder
      ? fitArima(series.values, { d: 1 })
      : fitArima(series.values, { p: 1, q: 1, d: 1 });
    const garchSource = series.values.length > 40 ? series.values.slice(-200) : series.values;
    return {
      series,
      acf: acf(series.values, maxLag),
      pacf: pacf(series.values, maxLag),
      decomp: seasonalDecompose(series.values, this.state.period, this.state.mode),
      tests: [adfTest(series.values, 1), kpssTest(series.values), ppTest(series.values)],
      arima,
      forecast: arima ? forecastArima(arima, this.state.horizon) : [],
      garch: fitGarch11(garchSource),
      granger: series.aux ? grangerCausality(series.values, series.aux, Math.min(6, Math.floor(series.values.length / 12))) : [],
    };
  }

  protected metrics(result: TsResult): ScienceMetric[] {
    const adf = result.tests[0]!;
    const kpss = result.tests[1]!;
    const arima = result.arima;
    const garch = result.garch;
    const granger = result.granger.find((g) => g.p < 0.05) ?? result.granger[0];
    return [
      {
        key: 'adf',
        label: 'ADF t',
        value: fmt(adf.statistic, 3),
        severity: adf.stationary ? 'ok' : 'warn',
        hint: this.zh ? `5% 临界值 ${adf.critical5} · ${adf.stationary ? '拒绝单位根' : '不能拒绝单位根'}` : `5% critical ${adf.critical5} · ${adf.stationary ? 'reject unit root' : 'retain unit root'}`,
      },
      {
        key: 'kpss',
        label: 'KPSS stat',
        value: fmt(kpss.statistic, 3),
        severity: kpss.stationary ? 'ok' : 'warn',
        hint: this.zh ? `5% 临界值 ${kpss.critical5} · ${kpss.stationary ? '水平平稳' : '非平稳'}` : `5% critical ${kpss.critical5} · ${kpss.stationary ? 'level stationary' : 'non-stationary'}`,
      },
      {
        key: 'arima',
        label: 'ARIMA order',
        value: arima ? `(${arima.p},${arima.d},${arima.q})` : '—',
        hint: arima ? `AIC=${fmt(arima.aic, 2)} · BIC=${fmt(arima.bic, 2)} · σ²=${fmt(arima.sigma2, 4)}` : '—',
      },
      {
        key: 'garch',
        label: 'GARCH persistence',
        value: garch ? fmt(garch.persistence, 4) : '—',
        severity: garch && garch.persistence < 0.99 ? 'ok' : 'warn',
        hint: garch ? `α=${fmt(garch.alpha, 4)}, β=${fmt(garch.beta, 4)}, ω=${fmt(garch.omega, 6)}` : '—',
      },
      {
        key: 'seasonal',
        label: this.zh ? '季节振幅' : 'Seasonal amplitude',
        value: result.decomp ? fmt(Math.max(...result.decomp.seasonalIndex.map(Math.abs)), 3) : '—',
        hint: result.decomp ? (this.zh ? `${result.decomp.mode}，周期 ${result.decomp.period}` : `${result.decomp.mode}, period ${result.decomp.period}`) : '—',
      },
      {
        key: 'granger',
        label: this.zh ? 'Granger 最小 p' : 'Granger min p',
        value: granger ? fmtP(granger.p) : '—',
        severity: granger && granger.p < 0.05 ? 'ok' : 'info',
        hint: granger ? (this.zh ? `滞后 ${granger.lag}；副序列${granger.causes ? '有' : '无'}预测增益` : `lag ${granger.lag}; auxiliary series ${granger.causes ? 'adds' : 'does not add'} predictive value`) : (this.zh ? '需要第二列序列' : 'needs a second series column'),
      },
    ];
  }

  protected benchmark(): BenchRow[] {
    return runTimeSeriesBenchmark().map((b) => ({
      id: b.id,
      labelEn: b.id === 'ar1-recovery' ? 'AR(1) coefficient' : b.id === 'adf-stationarity' ? 'ADF decision' : 'Seasonal index',
      labelZh: b.id === 'ar1-recovery' ? 'AR(1) 系数回收' : b.id === 'adf-stationarity' ? 'ADF 判别' : '季节指数回收',
      passed: b.passed,
      value: fmt(b.relErr, 6),
      detail: b.detail,
    }));
  }

  protected csv(result: TsResult): CsvPayload {
    const rows: Array<Array<string | number>> = result.series.values.map((v, t) => [
      result.series.time[t] ?? t + 1,
      v,
      result.decomp?.trend[t] ?? '',
      result.decomp?.seasonal[t] ?? '',
      result.decomp?.resid[t] ?? '',
    ]);
    return { name: 'timeseries-decomposition', header: ['time', 'value', 'trend', 'seasonal', 'residual'], rows };
  }

  protected figurePanels(result: TsResult): FigurePanelSpec[] {
    return timeseriesFigurePanels(result);
  }

  protected figureTitle() {
    return { zh: '时间序列 · 预测与相关结构', en: 'Time Series · Forecast & Correlation' };
  }

  protected figureCaption(result: TsResult) {
    return {
      zh: `时间序列（n=${result.series.values.length}）：ARIMA${result.arima ? `(${result.arima.p},${result.arima.d},${result.arima.q})` : '不可用'}，AIC=${fmt(result.arima?.aic ?? NaN, 2)}；ADF t=${fmt(result.tests[0]?.statistic ?? NaN, 3)}，KPSS=${fmt(result.tests[1]?.statistic ?? NaN, 3)}；GARCH 持续性 ${fmt(result.garch?.persistence ?? NaN, 4)}。`,
      en: `Time series (n=${result.series.values.length}): ARIMA${result.arima ? `(${result.arima.p},${result.arima.d},${result.arima.q})` : ' unavailable'}, AIC=${fmt(result.arima?.aic ?? NaN, 2)}; ADF t=${fmt(result.tests[0]?.statistic ?? NaN, 3)}, KPSS=${fmt(result.tests[1]?.statistic ?? NaN, 3)}; GARCH persistence ${fmt(result.garch?.persistence ?? NaN, 4)}.`,
    };
  }

  protected title(): string {
    return this.zh ? '时间序列分析' : 'Time Series Analysis';
  }

  protected subtitle(): string {
    const s = parseSeries(this.text);
    return this.zh
      ? `${s.values.length} 个观测 · 序列 ${s.valueName}${s.aux ? ' · 含因果副序列' : ''} · 周期 ${this.state.period}`
      : `${s.values.length} observations · series ${s.valueName}${s.aux ? ' · with causal auxiliary' : ''} · period ${this.state.period}`;
  }

  protected footnote(): string {
    return this.zh
      ? '蓝色 = 观测值，橙色 = ARIMA 预测均值与 95% 预测带；柱状图 = ACF / PACF，虚线为 ±1.96/√n 近似带。'
      : 'Blue = observations, orange = ARIMA forecast mean with 95% band; bars = ACF / PACF with ±1.96/√n approximate bands.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, result: TsResult | null): void {
    if (!result) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '至少需要 8 个观测值。' : 'At least 8 observations are required.', w / 2, h / 2);
      return;
    }
    const top = plotBox(w, h, 64, 76, 30, Math.round(h * 0.44));
    const values = result.series.values;
    const n = values.length;
    const forecast = result.forecast;
    const allY = [...values, ...forecast.flatMap((p) => [p.lo, p.hi])];
    const lo = Math.min(...allY);
    const hi = Math.max(...allY);
    const total = n + forecast.length;
    const xs = xScale(top, 1, total);
    const ys = yScale(top, lo, hi);

    drawAxes(
      g,
      top,
      [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: f, label: String(Math.round(1 + f * (total - 1))) })),
      [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: f, label: fmt(lo + f * (hi - lo), 1) })),
      this.zh ? '时间' : 'time',
      result.series.valueName,
      this.zh,
    );

    // 95 % forecast band as a filled ribbon.
    if (forecast.length > 0) {
      g.fillStyle = 'rgba(250,180,90,0.16)';
      g.beginPath();
      forecast.forEach((p, i) => {
        const x = xs(n + p.step);
        const y = ys(p.hi);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      for (let i = forecast.length - 1; i >= 0; i -= 1) {
        const p = forecast[i]!;
        g.lineTo(xs(n + p.step), ys(p.lo));
      }
      g.closePath();
      g.fill();
    }

    g.strokeStyle = CS.blue;
    g.lineWidth = 1.6;
    g.beginPath();
    values.forEach((v, i) => (i === 0 ? g.moveTo(xs(i + 1), ys(v)) : g.lineTo(xs(i + 1), ys(v))));
    g.stroke();
    g.lineWidth = 1;

    g.strokeStyle = CS.amber;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(xs(n), ys(values[n - 1]!));
    forecast.forEach((p) => g.lineTo(xs(n + p.step), ys(p.mean)));
    g.stroke();
    g.setLineDash([]);

    drawLegend(g, top.x0 + 6, top.y0 + 12, [
      { label: this.zh ? '观测' : 'observed', color: CS.blue },
      { label: this.zh ? 'ARIMA 预测' : 'ARIMA forecast', color: CS.amber, dash: true },
    ], this.zh);

    // Correlograms underneath.
    const lag = result.acf.length;
    const gap = 22;
    const bottomY = top.y1 + 30;
    const bottomH = Math.max(90, h - bottomY - 40);
    const acfBox = { x0: 62, y0: bottomY, x1: Math.round(w * 0.48), y1: bottomY + bottomH, w: 0, h: bottomH };
    const pacfBox = { x0: Math.round(w * 0.56), y0: bottomY, x1: w - 30, y1: bottomY + bottomH, w: 0, h: bottomH };
    acfBox.w = acfBox.x1 - acfBox.x0;
    pacfBox.w = pacfBox.x1 - pacfBox.x0;
    const drawCorr = (box: typeof acfBox, points: AcfPoint[], label: string) => {
      drawAxes(
        g,
        box,
        [0, 0.5, 1].map((f) => ({ value: f, label: String(Math.round(f * (lag - 1))) })),
        [0, 0.5, 1].map((f) => ({ value: f, label: fmt(-1 + 2 * f, 1) })),
        this.zh ? '滞后' : 'lag',
        label,
        this.zh,
      );
      const yAt = (v: number) => box.y0 + box.h * (1 - (v + 1) / 2);
      const barW = Math.max(1.5, box.w / lag - 2);
      points.forEach((p) => {
        const x = box.x0 + (box.w * p.lag) / Math.max(1, lag - 1);
        const y0 = yAt(0);
        const y1 = yAt(p.value);
        g.fillStyle = Math.abs(p.value) > 1.96 / Math.sqrt(n) ? CS.cyan : 'rgba(120,200,255,0.55)';
        g.fillRect(x - barW / 2, Math.min(y0, y1), barW, Math.abs(y1 - y0));
      });
      g.strokeStyle = CS.faint;
      g.setLineDash([3, 3]);
      for (const v of [-1.96 / Math.sqrt(n), 1.96 / Math.sqrt(n)]) {
        g.beginPath();
        g.moveTo(box.x0, yAt(v));
        g.lineTo(box.x1, yAt(v));
        g.stroke();
      }
      g.setLineDash([]);
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 10, '600');
      g.textAlign = 'left';
      g.fillText(label, box.x0, box.y0 - 6);
    };
    drawCorr(acfBox, result.acf, 'ACF');
    drawCorr(pacfBox, result.pacf, 'PACF');
    void gap;
    void drawCard;
    void drawTable;
  }
}

export default function createStatsTimeseriesPlugin(): StatsTimeseriesPlugin {
  return new StatsTimeseriesPlugin();
}
