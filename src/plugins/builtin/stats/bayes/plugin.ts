// ==========================================================================
// Bayesian Inference plugin
//
// Canvas: the MCMC trace for the posterior mean, the posterior density with
// the 95 % credible interval and prior, and a posterior-predictive histogram.
// The science strip reports the posterior summaries, Bayes factor, R-hat and
// effective sample size for the selected sampler.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { fmtMetric } from '@/core/research/scienceOutput';
import { CS, drawCard, drawLegend, font, plotBox } from '../../shared/cs-utils';
import { fmt, xScale, yScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsBayesManifest } from './manifest';
import {
  DEFAULT_PRIOR,
  hierarchicalModel,
  kde,
  parseBayes,
  runBayes,
  runBayesBenchmark,
  type BayesDataset,
  type BayesResult,
  type Chain,
  type HierarchicalResult,
} from './kernel';
import { bayesFigurePanels } from './figure';

type Sampler = 'mh' | 'gibbs' | 'hmc';

interface BayesState {
  sampler: Sampler;
  iterations: number;
  chains: number;
  seed: number;
}

export interface BayesViewResult {
  dataset: BayesDataset;
  result: BayesResult;
  hierarchical: HierarchicalResult | null;
  samples: number[];
}

export class StatsBayesPlugin extends StatsPluginBase<BayesState, BayesViewResult> {
  constructor() {
    // Data plugins start empty — no bundled sample. The canvas shows an
    // import hint until a dataset is loaded.
    super(statsBayesManifest, { sampler: 'mh', iterations: 2000, chains: 4, seed: 20261029 }, '');
  }

  protected emptyStateHint(): string {
    return this.zh
      ? '请导入 group + score（或分组 + 观测）列的 CSV / TSV 数据。\n可通过「数据」模式或项目文件列表将数据载入到本插件。'
      : 'Import a CSV / TSV dataset with group and score columns.\nUse the Data mode or load a file into this plugin from the file list.';
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.select('sampler', 'Sampler', '采样器', this.state.sampler, [
        { value: 'mh', en: 'Metropolis-Hastings', zh: 'Metropolis-Hastings' },
        { value: 'gibbs', en: 'Conjugate Gibbs', zh: '共轭 Gibbs' },
        { value: 'hmc', en: 'Hamiltonian MC', zh: '哈密顿蒙特卡洛' },
      ]),
      this.rangeParam('iterations', 'Iterations', '迭代次数', this.state.iterations, 500, 6000, 500),
      this.rangeParam('chains', 'Chains', '链数', this.state.chains, 2, 6, 1),
      this.numberParam('seed', 'Seed', '随机种子', this.state.seed, 1, 999999999, 1),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if ((params.sampler === 'mh' || params.sampler === 'gibbs' || params.sampler === 'hmc') && params.sampler !== this.state.sampler) {
      this.state.sampler = params.sampler;
      dirty = true;
    }
    if (typeof params.iterations === 'number' && Number.isFinite(params.iterations)) {
      const iterations = Math.min(6000, Math.max(500, Math.round(params.iterations)));
      if (iterations !== this.state.iterations) {
        this.state.iterations = iterations;
        dirty = true;
      }
    }
    if (typeof params.chains === 'number' && Number.isFinite(params.chains)) {
      const chains = Math.min(6, Math.max(2, Math.round(params.chains)));
      if (chains !== this.state.chains) {
        this.state.chains = chains;
        dirty = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const seed = Math.max(1, Math.round(params.seed));
      if (seed !== this.state.seed) {
        this.state.seed = seed;
        dirty = true;
      }
    }
    return dirty;
  }

  private selectedChain(result: BayesResult): Chain {
    if (this.state.sampler === 'gibbs') return result.gibbs;
    if (this.state.sampler === 'hmc') {
      return { mu: result.hmc, sigma: result.chain.sigma.slice(0, result.hmc.length), accepted: 0 };
    }
    return result.chain;
  }

  protected computeResult(): BayesViewResult | null {
    const dataset = parseBayes(this.text);
    if (dataset.values.length < 3) return null;
    const result = runBayes(dataset.values, {
      iterations: this.state.iterations,
      chains: this.state.chains,
      seed: this.state.seed,
    });
    const hierarchical = dataset.groups && dataset.groups.length === dataset.values.length
      ? hierarchicalModel(dataset.groups, dataset.values, Math.max(1000, this.state.iterations), this.state.seed + 31)
      : null;
    return { dataset, result, hierarchical, samples: this.selectedChain(result).mu };
  }

  protected metrics(view: BayesViewResult): ScienceMetric[] {
    const { result } = view;
    const chain = this.selectedChain(result);
    const mu = result.muSummary;
    const sigma = result.sigmaSummary;
    return [
      {
        key: 'posterior-mean',
        label: this.zh ? '后验均值 μ' : 'Posterior μ',
        value: `${fmt(mu.mean, 4)} [${fmt(mu.lo, 3)}, ${fmt(mu.hi, 3)}]`,
        severity: mu.lo > 0 || mu.hi < 0 ? 'ok' : 'info',
        hint: this.zh ? `95% 可信区间，中位数 ${fmt(mu.median, 3)}` : `95% credible interval, median ${fmt(mu.median, 3)}`,
      },
      {
        key: 'posterior-sigma',
        label: this.zh ? '后验 σ' : 'Posterior σ',
        value: `${fmt(sigma.mean, 4)} [${fmt(sigma.lo, 3)}, ${fmt(sigma.hi, 3)}]`,
        hint: this.zh ? `先验 α=${DEFAULT_PRIOR.alpha}, β=${DEFAULT_PRIOR.beta}` : `prior α=${DEFAULT_PRIOR.alpha}, β=${DEFAULT_PRIOR.beta}`,
      },
      {
        key: 'bf10',
        label: 'BF₁₀ (Savage-Dickey)',
        value: Number.isFinite(result.bf10) ? fmt(result.bf10, 3) : '—',
        severity: result.bf10 > 3 ? 'ok' : 'info',
        hint: this.zh ? `H0: μ=${DEFAULT_PRIOR.mu0}` : `H0: μ=${DEFAULT_PRIOR.mu0}`,
      },
      {
        key: 'rhat',
        label: 'R̂',
        value: fmt(result.rhat, 4),
        severity: result.rhat < 1.01 ? 'ok' : result.rhat < 1.05 ? 'warn' : 'error',
        hint: this.zh ? `Gelman-Rubin，${this.state.chains} 条链` : `Gelman-Rubin across ${this.state.chains} chains`,
      },
      {
        key: 'ess',
        label: 'ESS',
        value: fmt(result.ess, 0),
        severity: result.ess > 400 ? 'ok' : 'warn',
        hint: this.zh ? '有效样本量（含自相关）' : 'effective sample size with autocorrelation',
      },
      {
        key: 'acceptance',
        label: this.zh ? '接受率' : 'Acceptance',
        value: `${fmt((chain.accepted / Math.max(1, chain.mu.length)) * 100, 1)}%`,
        hint: this.state.sampler === 'mh' ? (this.zh ? '随机游走 MH' : 'random-walk MH') : this.zh ? '无需拒绝采样' : 'no rejection step',
      },
      {
        key: 'hierarchical',
        label: this.zh ? '分层模型 τ' : 'Hierarchical τ',
        value: view.hierarchical ? fmt(view.hierarchical.tau, 4) : '—',
        hint: view.hierarchical
          ? this.zh
            ? `总均值 ${fmt(view.hierarchical.grandMean, 3)}，R̂=${fmt(view.hierarchical.rhat, 3)}`
            : `grand mean ${fmt(view.hierarchical.grandMean, 3)}, R̂=${fmt(view.hierarchical.rhat, 3)}`
          : this.zh
            ? '需要 group 列'
            : 'needs a group column',
      },
    ];
  }

  protected benchmark(): BenchRow[] {
    const labels: Record<string, [string, string]> = {
      'posterior-mean': ['Posterior mean recovery', '后验均值回收'],
      'posterior-sigma': ['Posterior σ recovery', '后验 σ 回收'],
      'gibbs-analytic': ['Gibbs vs conjugate', 'Gibbs 与共轭解'],
      'rhat-convergence': ['R̂ convergence', 'R̂ 收敛'],
    };
    return runBayesBenchmark().map((b) => ({
      id: b.id,
      labelEn: labels[b.id]?.[0] ?? b.id,
      labelZh: labels[b.id]?.[1] ?? b.id,
      passed: b.passed,
      value: b.relErr < 1e-3 ? b.relErr.toExponential(2) : fmt(b.relErr, 5),
      detail: b.detail,
    }));
  }

  protected csv(view: BayesViewResult): CsvPayload {
    const chain = this.selectedChain(view.result);
    return {
      name: 'bayes-posterior',
      header: ['draw', 'mu', 'sigma'],
      rows: chain.mu.map((m, i) => [i + 1, m, chain.sigma[i] ?? '']),
    };
  }

  protected figurePanels(view: BayesViewResult): FigurePanelSpec[] {
    return bayesFigurePanels(view);
  }

  protected figureTitle() {
    return { zh: '贝叶斯推断 · 后验与收敛', en: 'Bayesian Inference · Posterior & Convergence' };
  }

  protected figureCaption(view: BayesViewResult) {
    const mu = view.result.muSummary;
    return {
      zh: `贝叶斯推断（${this.state.sampler}，${this.state.iterations} 次迭代）：μ=${fmt(mu.mean, 4)} [${fmt(mu.lo, 3)}, ${fmt(mu.hi, 3)}]，σ=${fmt(view.result.sigmaSummary.mean, 4)}；BF₁₀=${fmt(view.result.bf10, 3)}，R̂=${fmt(view.result.rhat, 4)}，ESS=${fmt(view.result.ess, 0)}。`,
      en: `Bayesian inference (${this.state.sampler}, ${this.state.iterations} iterations): μ=${fmt(mu.mean, 4)} [${fmt(mu.lo, 3)}, ${fmt(mu.hi, 3)}], σ=${fmt(view.result.sigmaSummary.mean, 4)}; BF₁₀=${fmt(view.result.bf10, 3)}, R̂=${fmt(view.result.rhat, 4)}, ESS=${fmt(view.result.ess, 0)}.`,
    };
  }

  protected title(): string {
    return this.zh ? '贝叶斯推断' : 'Bayesian Inference';
  }

  protected subtitle(): string {
    const d = parseBayes(this.text);
    const sampler = this.state.sampler === 'mh' ? 'Metropolis-Hastings' : this.state.sampler === 'gibbs' ? 'Gibbs' : 'HMC';
    return this.zh
      ? `${d.values.length} 个观测 · ${sampler} · ${this.state.chains} 条链 × ${this.state.iterations} 次 · 种子 ${this.state.seed}`
      : `${d.values.length} observations · ${sampler} · ${this.state.chains} chains × ${this.state.iterations} · seed ${this.state.seed}`;
  }

  protected footnote(): string {
    return this.zh
      ? '左：μ 的 MCMC 迹线；中：后验密度与 95% 可信区间（虚线为先验）；右：后验预测分布。'
      : 'Left: MCMC trace of μ; middle: posterior density with the 95% credible interval (dashed prior); right: posterior predictive draws.';
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, view: BayesViewResult | null): void {
    if (!view) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '需要至少 3 个数值观测。' : 'At least 3 numeric observations are required.', w / 2, h / 2);
      return;
    }
    const samples = view.samples;
    const mu = view.result.muSummary;
    const trace = samples.slice(-Math.min(800, samples.length));
    const traceH = Math.round(h * 0.4);
    const traceBox = plotBox(Math.round(w * 0.5), traceH, 66, 74, 22, 34);
    const loS = Math.min(...trace);
    const hiS = Math.max(...trace);
    const pad = (hiS - loS) * 0.1 || 1;
    const xs = xScale(traceBox, 0, Math.max(1, trace.length - 1));
    const ys = yScale(traceBox, loS - pad, hiS + pad);
    g.strokeStyle = CS.axis;
    g.strokeRect(traceBox.x0, traceBox.y0, traceBox.w, traceBox.h);
    g.strokeStyle = CS.grid;
    for (let i = 0; i <= 4; i += 1) {
      const y = traceBox.y0 + (traceBox.h * i) / 4;
      g.beginPath();
      g.moveTo(traceBox.x0, y);
      g.lineTo(traceBox.x1, y);
      g.stroke();
      g.fillStyle = CS.faint;
      g.font = font(false, 8.5);
      g.textAlign = 'right';
      g.fillText(fmt(hiS + pad - (i / 4) * (hiS - loS + 2 * pad), 2), traceBox.x0 - 4, y + 3);
    }
    g.strokeStyle = CS.blue;
    g.beginPath();
    trace.forEach((v, i) => (i === 0 ? g.moveTo(xs(i), ys(v)) : g.lineTo(xs(i), ys(v))));
    g.stroke();
    g.strokeStyle = CS.amber;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(traceBox.x0, ys(mu.mean));
    g.lineTo(traceBox.x1, ys(mu.mean));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? 'μ 迹线' : 'trace of μ', traceBox.x0, traceBox.y0 - 6);

    // Posterior density panel.
    const densBox = {
      x0: Math.round(w * 0.56),
      y0: 74,
      x1: w - 34,
      y1: traceH - 4,
      w: 0,
      h: 0,
    };
    densBox.w = densBox.x1 - densBox.x0;
    densBox.h = densBox.y1 - densBox.y0;
    const dLo = Math.min(...samples);
    const dHi = Math.max(...samples);
    const dPad = (dHi - dLo) * 0.12 || 1;
    const grid = Array.from({ length: 120 }, (_, i) => dLo - dPad + ((dHi - dLo + 2 * dPad) * i) / 119);
    const dens = grid.map((x) => kde(samples, x));
    const maxDens = Math.max(1e-9, ...dens);
    const px = xScale(densBox, grid[0]!, grid.at(-1)!);
    const py = yScale(densBox, 0, maxDens * 1.12);
    g.strokeStyle = CS.axis;
    g.strokeRect(densBox.x0, densBox.y0, densBox.w, densBox.h);
    g.fillStyle = 'rgba(120,200,255,0.18)';
    g.beginPath();
    g.moveTo(px(grid[0]!), py(0));
    grid.forEach((x, i) => g.lineTo(px(x), py(dens[i]!)));
    g.lineTo(px(grid.at(-1)!), py(0));
    g.closePath();
    g.fill();
    g.strokeStyle = CS.blue;
    g.beginPath();
    grid.forEach((x, i) => (i === 0 ? g.moveTo(px(x), py(dens[i]!)) : g.lineTo(px(x), py(dens[i]!))));
    g.stroke();
    for (const v of [mu.lo, mu.hi]) {
      g.strokeStyle = CS.amber;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(px(v), densBox.y0);
      g.lineTo(px(v), densBox.y1);
      g.stroke();
    }
    g.setLineDash([]);
    const priorDensity = (x: number) => {
      const sd = 1 / Math.sqrt(DEFAULT_PRIOR.kappa);
      return Math.exp(-((x - DEFAULT_PRIOR.mu0) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
    };
    const priorScale = maxDens * 1.12;
    g.strokeStyle = CS.faint;
    g.beginPath();
    grid.forEach((x, i) => {
      const v = (priorDensity(x) / Math.max(1e-9, priorDensity(DEFAULT_PRIOR.mu0))) * priorScale * 0.35;
      if (i === 0) g.moveTo(px(x), py(v));
      else g.lineTo(px(x), py(v));
    });
    g.stroke();
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? 'μ 后验密度' : 'posterior density of μ', densBox.x0, densBox.y0 - 6);

    // Posterior predictive histogram.
    const ppcBox = plotBox(w, h, 66, traceH + 60, 30, Math.round(h * 0.18));
    const ppc = view.result.posteriorPredictive;
    const pLo = Math.min(...ppc);
    const pHi = Math.max(...ppc);
    const bins = 32;
    const width = (pHi - pLo) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (const v of ppc) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - pLo) / width)))]! += 1;
    const maxCount = Math.max(1, ...counts);
    g.strokeStyle = CS.axis;
    g.strokeRect(ppcBox.x0, ppcBox.y0, ppcBox.w, ppcBox.h);
    counts.forEach((c, i) => {
      const hBar = (c / maxCount) * (ppcBox.h - 10);
      g.fillStyle = 'rgba(94,230,208,0.7)';
      g.fillRect(ppcBox.x0 + (i / bins) * ppcBox.w, ppcBox.y1 - hBar, ppcBox.w / bins - 1, hBar);
    });
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 9.5, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? '后验预测 y*' : 'posterior predictive y*', ppcBox.x0, ppcBox.y0 - 6);

    drawLegend(g, Math.round(w * 0.56) + 8, 52, [
      { label: this.zh ? '后验' : 'posterior', color: CS.blue },
      { label: this.zh ? '95% 区间' : '95% CI', color: CS.amber, dash: true },
    ], this.zh);
    void fmtMetric;
    void drawCard;
  }
}

export default function createStatsBayesPlugin(): StatsBayesPlugin {
  return new StatsBayesPlugin();
}
