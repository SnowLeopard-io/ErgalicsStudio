// ==========================================================================
// Reinforcement Learning Lab plugin — main controller.
//
// Wires the pure RL kernel (GridWorld / CartPole / multi-armed bandit
// environments; Q-Learning, SARSA, REINFORCE and the bandit agents) to the
// Ergalics Studio plugin contract: contextual parameter panel, seeded async
// run loop that yields between episodes, low-saturation 2-D canvas rendering,
// science outputs, CSV export and a throughput benchmark.
//
// The run loop never blocks longer than a few episodes: it awaits a
// setTimeout(0) yield and honours the Stop button, keeping the UI responsive
// without Web Workers.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  ParamVisibilityRule,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs } from '@/core/research/scienceOutput';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import {
  CS,
  drawAxes,
  drawCard,
  drawFootnote,
  drawHeader,
  drawLegend,
  font,
  mix,
  plotBox,
  prepareCanvas,
  type PlotBox,
} from '../../shared/cs-utils';
import {
  CARTPOLE_FAIL_THETA,
  makeGridWorld,
  runBanditExperiment,
  runCartPoleExperiment,
  runGridExperiment,
  type BanditAgent,
  type CartAlgorithm,
  type GridAlgorithm,
  type GridWorldSpec,
  type RlRunResult,
} from './kernel';
import { firstPresetOf, RL_PRESETS } from './presets';
import { rlManifest } from './manifest';

/** Academic low-saturation palette (histogram bars, trace accents). */
const PALETTE = [
  '#7fa8c9', '#6fb3ad', '#a3aebc', '#8f9fc0', '#6da8b8', '#9db4d0', '#7fb8a8', '#b3a3c9',
] as const;

const MAX_EPISODES = 2000;
const GRID_MAX_STEPS = 200;
const CART_MAX_STEPS = 500;
/** Episodes drawn between progress repaints during a run. */
const DRAW_EVERY = 8;
/** Benchmark budget: Q-Learning cliff + bandit must stay under 2 s. */
const BENCHMARK_BUDGET_MS = 2000;
const BENCH_GRID_EPISODES = 500;
const BENCH_BANDIT_STEPS = 2000;

type EnvKind = 'gridworld' | 'cartpole' | 'bandit';

const ENVS: ReadonlyArray<EnvKind> = ['gridworld', 'cartpole', 'bandit'];
const GRID_ALGOS: ReadonlyArray<string> = ['qlearning', 'sarsa', 'reinforce'];
const CART_ALGOS: ReadonlyArray<string> = ['qlearning', 'sarsa'];
const BANDIT_ALGOS: ReadonlyArray<string> = ['eps-greedy', 'ucb1', 'thompson'];

interface RlState {
  preset: string;
  env: EnvKind;
  algorithm: string;
  episodes: number;
  alpha: number;
  gamma: number;
  epsilon: number;
  slip: number;
  seed: number;
}

const DEFAULT_STATE: RlState = {
  preset: 'grid-cliff-6x6',
  env: 'gridworld',
  algorithm: 'qlearning',
  episodes: 300,
  alpha: 0.1,
  gamma: 0.99,
  epsilon: 0.1,
  slip: 0,
  seed: 20261029,
};

export class RLPlugin implements Plugin {
  readonly manifest = rlManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: RlState = { ...DEFAULT_STATE };
  private grid: GridWorldSpec;
  private banditK = 10;
  private banditType: 'bernoulli' | 'gaussian' = 'gaussian';
  private result: RlRunResult | null = null;
  private runtimeMs = 0;
  private progress: { done: number; total: number } | null = null;
  private running = false;
  private stopRequested = false;
  /** Incremented on reset / env switch so a finishing stale run discards itself. */
  private runToken = 0;

  constructor() {
    this.grid = makeGridWorld({});
    this.applyPreset(DEFAULT_STATE.preset);
  }

  async init(api: PluginApi): Promise<void> {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((locale) => {
      this.zh = locale === 'zh-CN';
      this.draw();
    });
  }

  async destroy(): Promise<void> {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.result = null;
  }

  async activate(context: { container: ContainerCapabilities }): Promise<void> {
    this.ctx = context.container;
  }

  async deactivate(): Promise<void> {
    this.ctx = null;
  }

  render(container: ContainerCapabilities): void {
    this.ctx = container;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter panel ---------------------------------------------------

  /** Small bilingual labelled select, mirroring the sibling data plugins. */
  private select(
    key: string,
    en: string,
    zh: string,
    value: string,
    options: Array<{ value: string; en: string; zh: string }>,
  ): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'select',
      value,
      options: options.map((o) => ({
        value: o.value,
        label: this.zh ? o.zh : o.en,
        labelI18n: { 'zh-CN': o.zh, 'en-US': o.en },
      })),
    };
  }

  private numberParam(
    key: string,
    en: string,
    zh: string,
    value: number,
    min: number,
    max: number,
    step: number,
    visibleWhen?: ParamVisibilityRule,
  ): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'number',
      min,
      max,
      step,
      value,
      ...(visibleWhen ? { visibleWhen } : {}),
    };
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const isBandit = s.env === 'bandit';
    const isGrid = s.env === 'gridworld';
    const algoOptions = isBandit
      ? [
          { value: 'eps-greedy', en: 'ε-greedy', zh: 'ε-贪婪' },
          { value: 'ucb1', en: 'UCB1', zh: 'UCB1' },
          { value: 'thompson', en: 'Thompson Sampling', zh: 'Thompson 采样' },
        ]
      : [
          { value: 'qlearning', en: 'Q-Learning', zh: 'Q-Learning' },
          { value: 'sarsa', en: 'SARSA', zh: 'SARSA' },
          ...(isGrid ? [{ value: 'reinforce', en: 'REINFORCE', zh: 'REINFORCE' }] : []),
        ];
    const presetOptions = [
      ...RL_PRESETS.filter((p) => p.env === s.env).map((p) => ({ value: p.id, en: p.label, zh: p.labelZh })),
      { value: 'custom', en: 'Custom', zh: '自定义' },
    ];
    const TABULAR = ['qlearning', 'sarsa', 'reinforce'] as const;
    const EPS_USERS = ['qlearning', 'sarsa', 'eps-greedy'] as const;
    return [
      this.select('preset', 'Preset', '预设环境', s.preset, presetOptions),
      this.select('env', 'Environment', '环境', s.env, [
        { value: 'gridworld', en: 'GridWorld', zh: '网格世界' },
        { value: 'cartpole', en: 'CartPole', zh: '倒立摆' },
        { value: 'bandit', en: 'Multi-Armed Bandit', zh: '多臂老虎机' },
      ]),
      this.select('algorithm', 'Algorithm', '算法', s.algorithm, algoOptions),
      this.numberParam(
        'episodes',
        isBandit ? 'Steps' : 'Episodes',
        isBandit ? '步数' : '回合数',
        s.episodes,
        1,
        MAX_EPISODES,
        10,
      ),
      this.numberParam('alpha', 'Learning Rate α', '学习率 α', s.alpha, 0.01, 1, 0.01, {
        key: 'algorithm',
        in: TABULAR,
      }),
      this.numberParam('gamma', 'Discount γ', '折扣 γ', s.gamma, 0, 0.999, 0.001, {
        key: 'algorithm',
        in: TABULAR,
      }),
      this.numberParam('epsilon', 'Exploration ε', '探索率 ε', s.epsilon, 0, 1, 0.01, {
        key: 'algorithm',
        in: EPS_USERS,
      }),
      this.numberParam('slip', 'Slip Probability', '滑动概率', s.slip, 0, 0.5, 0.05, {
        key: 'env',
        in: ['gridworld'],
      }),
      this.numberParam('seed', 'Seed', '随机种子', s.seed, 1, 999999999, 1),
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('stop', 'Stop', '停止', 'danger'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('benchmark', 'Benchmark', '基准测试'),
      actionButton('exportCsv', 'Export Reward CSV', '导出回报 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>): void {
    const s = this.state;
    let structural = false;

    if (typeof params.preset === 'string' && params.preset !== s.preset) {
      this.applyPreset(params.preset);
      structural = true;
    }
    if (typeof params.env === 'string' && ENVS.includes(params.env as EnvKind) && params.env !== s.env) {
      s.env = params.env as EnvKind;
      // Each env speaks a different agent language; adopt a workable default.
      s.algorithm = s.env === 'bandit' ? 'eps-greedy' : 'qlearning';
      const preset = firstPresetOf(s.env);
      if (preset) this.applyPreset(preset.id);
      structural = true;
    }
    if (typeof params.algorithm === 'string' && this.isValidAlgorithm(params.algorithm) && params.algorithm !== s.algorithm) {
      s.algorithm = params.algorithm;
      s.preset = 'custom';
    }
    if (typeof params.episodes === 'number' && Number.isFinite(params.episodes)) {
      const v = Math.min(MAX_EPISODES, Math.max(1, Math.round(params.episodes)));
      if (v !== s.episodes) {
        s.episodes = v;
        s.preset = 'custom';
      }
    }
    if (typeof params.alpha === 'number' && Number.isFinite(params.alpha)) {
      s.alpha = Math.min(1, Math.max(0.01, params.alpha));
    }
    if (typeof params.gamma === 'number' && Number.isFinite(params.gamma)) {
      s.gamma = Math.min(0.999, Math.max(0, params.gamma));
    }
    if (typeof params.epsilon === 'number' && Number.isFinite(params.epsilon)) {
      s.epsilon = Math.min(1, Math.max(0, params.epsilon));
    }
    if (typeof params.slip === 'number' && Number.isFinite(params.slip)) {
      s.slip = Math.min(0.5, Math.max(0, params.slip));
      this.grid = makeGridWorld({ ...this.grid, slip: s.slip });
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      s.seed = Math.max(1, Math.round(params.seed));
    }

    if (actionFired(params, 'run')) {
      void this.runTraining(true);
      return;
    }
    if (actionFired(params, 'stop')) {
      this.requestStop();
      return;
    }
    if (actionFired(params, 'reset')) {
      this.resetAll();
      return;
    }
    if (actionFired(params, 'benchmark')) {
      void this.runBenchmark();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }

    if (structural) {
      // Preset / env switch invalidates the previous experiment and changes
      // which params are visible — refresh the panel and the canvas.
      this.runToken += 1;
      if (this.running) this.stopRequested = true;
      this.result = null;
      this.runtimeMs = 0;
      this.progress = null;
      clearScienceOutputs(this.manifest.id);
      emit('host:params:changed', { pluginId: this.manifest.id });
      this.draw();
    }
  }

  /** Apply a preset's environment layout; unknown ids fall back to custom. */
  private applyPreset(id: string): void {
    const preset = RL_PRESETS.find((p) => p.id === id && p.env === this.state.env);
    if (!preset) {
      this.state.preset = 'custom';
      return;
    }
    this.state.preset = preset.id;
    if (preset.grid) {
      this.grid = makeGridWorld(preset.grid);
      if (preset.grid.slip !== undefined) this.state.slip = preset.grid.slip;
    }
    if (preset.bandit) {
      this.banditK = preset.bandit.k;
      this.banditType = preset.bandit.type;
    }
  }

  private isValidAlgorithm(a: string): boolean {
    if (this.state.env === 'bandit') return BANDIT_ALGOS.includes(a);
    if (this.state.env === 'cartpole') return CART_ALGOS.includes(a);
    return GRID_ALGOS.includes(a);
  }

  /** Algorithm guaranteed to match the current env (guards stale panels). */
  private effectiveAlgorithm(): GridAlgorithm | CartAlgorithm | BanditAgent {
    const a = this.state.algorithm;
    if (this.state.env === 'bandit') return BANDIT_ALGOS.includes(a) ? (a as BanditAgent) : 'eps-greedy';
    if (this.state.env === 'cartpole') return CART_ALGOS.includes(a) ? (a as CartAlgorithm) : 'qlearning';
    return GRID_ALGOS.includes(a) ? (a as GridAlgorithm) : 'qlearning';
  }

  // ---- run loop ----------------------------------------------------------

  private async runTraining(
    explicit: boolean,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<void> {
    if (this.running) {
      if (explicit) {
        notify(this.api, 'warning', 'A run is already in progress.', '已有实验在运行中。');
      }
      return;
    }
    this.running = true;
    this.stopRequested = false;
    this.progress = null;
    const token = ++this.runToken;
    const s = this.state;
    try {
      const opts = {
        seed: Math.round(s.seed),
        shouldStop: () => this.stopRequested,
        yieldFn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        onProgress: (done: number, total: number) => {
          this.progress = { done, total };
          onProgress?.({ done, total, label: `${s.env}/${s.algorithm}` });
          if (done % DRAW_EVERY === 0 || done === total) this.draw();
        },
      };
      const config = {
        episodes: s.episodes,
        alpha: s.alpha,
        gamma: s.gamma,
        epsilon: s.epsilon,
        maxSteps: s.env === 'cartpole' ? CART_MAX_STEPS : GRID_MAX_STEPS,
      };
      const algo = this.effectiveAlgorithm();
      const started = performance.now();
      let res: RlRunResult;
      if (s.env === 'gridworld') {
        res = await runGridExperiment(algo as GridAlgorithm, this.grid, config, opts);
      } else if (s.env === 'cartpole') {
        res = await runCartPoleExperiment(algo as CartAlgorithm, config, opts);
      } else {
        res = await runBanditExperiment(
          algo as BanditAgent,
          { k: this.banditK, type: this.banditType },
          s.episodes,
          { epsilon: s.epsilon },
          opts,
        );
      }
      this.runtimeMs = performance.now() - started;
      // A reset / env switch happened mid-run — drop the stale result.
      if (token !== this.runToken) return;
      this.result = res;
      this.publish(res, this.runtimeMs);
      this.api.reportDataScale(res.envSteps);
      this.draw();
      if (explicit) {
        if (res.stopped) {
          notify(
            this.api,
            'info',
            `Stopped after ${res.episodeRewards.length} ${s.env === 'bandit' ? 'steps' : 'episodes'}.`,
            `已在 ${res.episodeRewards.length} ${s.env === 'bandit' ? '步' : '个回合'}后停止。`,
          );
        } else {
          notify(
            this.api,
            'success',
            `Run finished — mean(last 50) ${fmtMetric(res.meanRewardLast50, 3)} (${this.runtimeMs.toFixed(0)} ms).`,
            `运行完成 — 后 50 回合均值 ${fmtMetric(res.meanRewardLast50, 3)}（${this.runtimeMs.toFixed(0)} ms）。`,
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Run failed: ${message}`, `运行失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  private requestStop(): void {
    if (!this.running) return;
    this.stopRequested = true;
    notify(this.api, 'info', 'Stopping after the current episode…', '将在当前回合结束后停止…');
  }

  private resetAll(): void {
    this.runToken += 1; // invalidate any in-flight run
    if (this.running) this.stopRequested = true;
    this.result = null;
    this.runtimeMs = 0;
    this.progress = null;
    clearScienceOutputs(this.manifest.id);
    this.draw();
  }

  // ---- science outputs ---------------------------------------------------

  private publish(res: RlRunResult, runtimeMs: number): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'mean-reward',
        label: zh ? '后 50 回合平均回报' : 'Mean reward (last 50)',
        value: fmtMetric(res.meanRewardLast50, 4),
        severity: 'ok',
        hint:
          zh
            ? res.env === 'bandit'
              ? '最后 50 步的单步平均奖励'
              : '最后 50 个回合的回报均值'
            : res.env === 'bandit'
              ? 'mean per-step reward over the last 50 steps'
              : 'mean episode return over the last 50 episodes',
      },
      {
        key: 'best-episode',
        label: zh ? '最佳回合回报' : 'Best episode reward',
        value: fmtMetric(res.bestEpisode, 4),
        severity: 'info',
      },
    ];
    if (res.finalRegret !== null) {
      metrics.push({
        key: 'final-regret',
        label: zh ? '最终累计遗憾' : 'Final cumulative regret',
        value: fmtMetric(res.finalRegret, 4),
        severity: 'info',
        hint: zh ? '∑ 最优臂期望 − 所选臂期望' : 'Σ optimal-arm mean − chosen-arm mean',
      });
    }
    metrics.push({
      key: 'runtime',
      label: zh ? '运行耗时' : 'Runtime',
      value: `${fmtMetric(runtimeMs, 4)} ms`,
      unit: 'ms',
      severity: 'info',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- benchmark -----------------------------------------------------------

  /** Q-Learning on the 6×6 cliff (500 episodes) + 10-arm Gaussian bandit
   *  (2000 steps); publishes total ms, steps/s and the env-step count. */
  private async runBenchmark(): Promise<void> {
    if (this.running) {
      notify(this.api, 'warning', 'A run is already in progress.', '已有实验在运行中。');
      return;
    }
    this.running = true;
    try {
      const cliff = makeGridWorld({
        size: 6,
        start: 30,
        goal: 35,
        traps: [31, 32, 33, 34],
        trapReward: -100,
        goalReward: 1,
        stepCost: -1,
        slip: 0,
      });
      const started = performance.now();
      const gridRun = await runGridExperiment(
        'qlearning',
        cliff,
        { episodes: BENCH_GRID_EPISODES, alpha: 0.1, gamma: 0.99, epsilon: 0.1, maxSteps: GRID_MAX_STEPS },
        { seed: 42 },
      );
      const banditRun = await runBanditExperiment(
        'eps-greedy',
        { k: 10, type: 'gaussian' },
        BENCH_BANDIT_STEPS,
        { epsilon: 0.1 },
        { seed: 43 },
      );
      const totalMs = performance.now() - started;
      const totalSteps = gridRun.envSteps + banditRun.envSteps;
      const stepsPerSec = totalSteps / Math.max(1e-9, totalMs / 1000);
      const zh = this.zh;
      setScienceOutputs(this.manifest.id, [
        {
          key: 'bench-steps',
          label: zh ? '基准环境步数' : 'Benchmark env steps',
          value: String(totalSteps),
          severity: 'info',
          hint: zh ? 'Q-Learning 500 回合 + 老虎机 2000 步' : 'Q-Learning 500 episodes + bandit 2000 steps',
        },
        {
          key: 'bench-total',
          label: zh ? '基准总耗时' : 'Benchmark total time',
          value: `${fmtMetric(totalMs, 4)} ms`,
          unit: 'ms',
          severity: totalMs < BENCHMARK_BUDGET_MS ? 'ok' : 'warn',
          hint: zh ? `目标 < ${BENCHMARK_BUDGET_MS / 1000} s` : `target < ${BENCHMARK_BUDGET_MS / 1000} s`,
        },
        {
          key: 'bench-rate',
          label: zh ? '基准吞吐' : 'Benchmark throughput',
          value: `${fmtMetric(stepsPerSec, 4)} steps/s`,
          severity: 'info',
          hint: zh ? '环境步 / 秒（含两次完整实验）' : 'environment steps per second across both runs',
        },
      ]);
      this.api.reportDataScale(totalSteps);
      notify(
        this.api,
        'success',
        `Benchmark: ${totalSteps} env steps in ${totalMs.toFixed(0)} ms (${fmtMetric(stepsPerSec, 3)} steps/s).`,
        `基准测试：${totalSteps} 个环境步，耗时 ${totalMs.toFixed(0)} ms（${fmtMetric(stepsPerSec, 3)} 步/秒）。`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify(this.api, 'error', `Benchmark failed: ${message}`, `基准测试失败：${message}`);
    } finally {
      this.running = false;
    }
  }

  // ---- block / flow mode -----------------------------------------------------

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    if (typeof input === 'string' && input.trim()) {
      try {
        const cfg = JSON.parse(input) as Record<string, unknown>;
        // Route through updateParams so clamping / preset logic stays in one place.
        const apply: Record<string, unknown> = {};
        for (const key of ['preset', 'env', 'algorithm', 'episodes', 'alpha', 'gamma', 'epsilon', 'slip', 'seed']) {
          if (key in cfg) apply[key] = cfg[key];
        }
        this.updateParams(apply);
      } catch {
        return { ok: false, error: 'invalid JSON config (expected {"env","algorithm","episodes",...})' };
      }
    }
    if (this.running) {
      return { ok: false, error: 'a run is already in progress' };
    }
    await this.runTraining(false, onProgress);
    const res = this.result;
    if (!res) return { ok: false, error: 'run produced no result' };
    return {
      ok: true,
      output: {
        env: res.env,
        algorithm: res.algorithm,
        meanReward: res.meanRewardLast50,
        ...(res.finalRegret !== null ? { regret: res.finalRegret } : {}),
        runtimeMs: this.runtimeMs,
      },
    };
  }

  // ---- exports ----------------------------------------------------------------

  /** Export the per-episode (per-step) reward history as CSV. */
  private exportCsv(): void {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run an experiment first.', '请先运行实验。');
      return;
    }
    const rows = res.episodeRewards.map((r, i) => [
      i + 1,
      Number(r.toFixed(4)),
      Number((res.runningMean[i] ?? 0).toFixed(4)),
    ]);
    exportRowsCsv(this.api, `rl-${res.env}-${res.algorithm}`, ['episode', 'reward', 'running_mean'], rows);
  }

  // ---- rendering -----------------------------------------------------------------

  private draw(): void {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const zh = this.zh;
    const res = this.result;
    drawHeader(g, w, zh ? '强化学习实验室' : 'Reinforcement Learning Lab', this.subtitle(), zh);
    if (!res) {
      if (this.running && this.progress) {
        g.fillStyle = CS.dim;
        g.font = font(zh, 12);
        g.textAlign = 'center';
        g.fillText(
          zh
            ? `训练中… ${this.progress.done}/${this.progress.total}`
            : `Training… ${this.progress.done}/${this.progress.total}`,
          w / 2,
          h / 2 - 6,
        );
      } else {
        g.fillStyle = CS.dim;
        g.font = font(zh, 12);
        g.textAlign = 'center';
        g.fillText(
          zh ? '点击「运行」开始训练' : 'Press "Run" to start training.',
          w / 2,
          h / 2 - 6,
        );
        g.fillStyle = CS.faint;
        g.font = font(zh, 10.5);
        g.fillText(
          zh
            ? '选择环境与算法（预设环境：经典 4×4、悬崖 6×6、10 臂高斯老虎机、倒立摆）。'
            : 'Pick an environment and algorithm (presets: classic 4×4, cliff 6×6, 10-arm Gaussian bandit, CartPole).',
          w / 2,
          h / 2 + 16,
        );
      }
      drawFootnote(g, w, h, this.footnote(), zh);
      return;
    }
    switch (res.env) {
      case 'gridworld':
        this.drawGridWorld(g, w, h, res, zh);
        break;
      case 'bandit':
        this.drawBandit(g, w, h, res, zh);
        break;
      case 'cartpole':
        this.drawCartPole(g, w, h, res, zh);
        break;
    }
    drawFootnote(g, w, h, this.footnote(), zh);
  }

  private subtitle(): string {
    const s = this.state;
    const envName =
      s.env === 'gridworld' ? (this.zh ? '网格世界' : 'GridWorld')
      : s.env === 'cartpole' ? (this.zh ? '倒立摆' : 'CartPole')
      : this.zh ? '多臂老虎机' : 'Bandit';
    const parts = [
      envName,
      s.algorithm,
      `${s.env === 'bandit' ? (this.zh ? '步数' : 'steps') : this.zh ? '回合' : 'episodes'} ${s.episodes}`,
      `${this.zh ? '预设' : 'preset'} ${s.preset}`,
      `seed ${s.seed}`,
    ];
    if (this.running && this.progress) {
      parts.push(`${this.progress.done}/${this.progress.total}`);
    }
    return parts.join(' · ');
  }

  private footnote(): string {
    const zh = this.zh;
    switch (this.state.env) {
      case 'gridworld':
        return zh
          ? '左：状态价值着色（绿正红负）与贪婪策略箭头（S 起点，G 终点，红色为陷阱/悬崖）；右：每回合回报与累计均值。'
          : 'Left: state values shaded (green positive, red negative) with greedy policy arrows (S start, G goal, red traps/cliff); right: episode returns and running mean.';
      case 'bandit':
        return zh
          ? '上：单步奖励与累计均值（左）、累计遗憾（右）；下：各臂选择次数直方图。遗憾为最优臂期望与所选臂期望之差的累加。'
          : 'Top: per-step reward with running mean (left) and cumulative regret (right); bottom: arm-choice histogram. Regret accumulates optimal-mean minus chosen-mean.';
      case 'cartpole':
        return zh
          ? '上：每回合回报（每存活一步 +1）；下：最近一回合的杆角度轨迹，红色虚线为 ±12° 失败阈值。'
          : 'Top: episode returns (+1 per surviving step); bottom: pole-angle trace of the last episode, red dashed lines mark the ±12° failure threshold.';
      default:
        return '';
    }
  }

  /** Generic multi-series line plot into a plot box (axes + legend drawn). */
  private drawLinePanel(
    g: CanvasRenderingContext2D,
    box: PlotBox,
    series: Array<{ data: number[]; color: string; dash?: boolean }>,
    xLabel: string,
    yLabel: string,
    zh: boolean,
  ): void {
    let maxLen = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      maxLen = Math.max(maxLen, s.data.length);
      for (const v of s.data) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (maxLen === 0) return;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (hi - lo < 1e-9) {
      hi += 0.5;
      lo -= 0.5;
    }
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(hi - t * (hi - lo), 3),
    }));
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: String(Math.round(t * (maxLen - 1)) + 1),
    }));
    drawAxes(g, box, xTicks, yTicks, xLabel, yLabel, zh);
    const denom = Math.max(1, maxLen - 1);
    const span = hi - lo;
    for (const s of series) {
      if (s.data.length === 0) continue;
      g.strokeStyle = s.color;
      g.lineWidth = 1.6;
      g.setLineDash(s.dash ? [5, 3] : []);
      g.beginPath();
      s.data.forEach((v, i) => {
        const x = box.x0 + box.w * (i / denom);
        const y = box.y1 - box.h * ((v - lo) / span);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    }
  }

  /** GridWorld: board with value shading + policy arrows, reward curve right. */
  private drawGridWorld(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    res: RlRunResult,
    zh: boolean,
  ): void {
    const spec = this.grid;
    const size = spec.size;
    const availH = h - 66 - 56;
    const boardAreaW = Math.round(w * 0.46);
    const cell = Math.max(10, Math.floor(Math.min((boardAreaW - 24) / size, availH / size)));
    const boardW = cell * size;
    const bx = Math.round(24 + (boardAreaW - boardW) / 2);
    const by = 66 + Math.round(Math.max(0, availH - boardW) / 2);

    g.fillStyle = CS.dim;
    g.font = font(zh, 10.5, '600');
    g.textAlign = 'center';
    g.fillText(
      zh ? '状态价值与贪婪策略' : 'state values & greedy policy',
      bx + boardW / 2,
      by - 10,
    );

    drawCard(g, bx - 8, by - 8, boardW + 16, boardW + 16);
    const vmax = Math.max(1e-9, ...(res.values ?? [1]).map((v) => Math.abs(v)));
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const s = r * size + c;
        const x = bx + c * cell;
        const y = by + r * cell;
        let fill = 'rgba(255,255,255,0.028)';
        const v = res.values?.[s];
        if (v !== undefined && !spec.traps.includes(s) && s !== spec.goal) {
          const t = Math.min(1, Math.abs(v) / vmax);
          fill = v >= 0 ? mix('#10161f', '#5da58f', t) : mix('#10161f', '#b07070', t);
        }
        if (spec.traps.includes(s)) fill = 'rgba(255,139,134,0.22)';
        if (s === spec.goal) fill = 'rgba(126,231,135,0.24)';
        g.fillStyle = fill;
        g.fillRect(x, y, cell, cell);
        g.strokeStyle = CS.grid;
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }

    // Cell decorations: labels, greedy arrows and value read-outs.
    g.textAlign = 'center';
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const s = r * size + c;
        const cx = bx + c * cell + cell / 2;
        const cy = by + r * cell + cell / 2;
        if (s === spec.goal) {
          g.fillStyle = CS.text;
          g.font = font(false, Math.min(13, cell * 0.4), '600');
          g.fillText('G', cx, cy + 4);
          continue;
        }
        if (spec.traps.includes(s)) {
          g.fillStyle = 'rgba(255,139,134,0.85)';
          g.font = font(false, Math.min(13, cell * 0.4), '600');
          g.fillText(spec.trapReward <= -50 ? 'C' : 'T', cx, cy + 4);
          continue;
        }
        if (s === spec.start) {
          g.fillStyle = CS.blue;
          g.font = font(false, Math.min(11, cell * 0.34), '600');
          g.fillText('S', cx - cell * 0.28, cy + 4);
        }
        const action = res.policy?.[s] ?? -1;
        if (action >= 0 && cell >= 16) {
          this.drawArrow(g, cx, cy, (action * Math.PI) / 2 - Math.PI / 2, cell * 0.26);
        }
        const v = res.values?.[s];
        if (v !== undefined && cell >= 40) {
          g.fillStyle = CS.faint;
          g.font = font(false, 8.5);
          g.fillText(fmtMetric(v, 2), cx, by + r * cell + cell - 5);
        }
      }
    }

    // Right: episode-reward curve (always present).
    const box = plotBox(w, h, bx + boardW + 44, 66, 28, 56);
    this.drawLinePanel(
      g,
      box,
      [
        { data: res.episodeRewards, color: 'rgba(120,200,255,0.55)' },
        { data: res.runningMean, color: CS.amber, dash: true },
      ],
      zh ? '回合' : 'episode',
      zh ? '回报' : 'reward',
      zh,
    );
    drawLegend(
      g,
      box.x0 + 8,
      box.y0 - 10,
      [
        { label: zh ? '回合回报' : 'episode reward', color: 'rgba(120,200,255,0.55)' },
        { label: zh ? '累计均值' : 'running mean', color: CS.amber, dash: true },
      ],
      zh,
    );
  }

  /** Small in-cell direction arrow (policy visualisation). */
  private drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, angle: number, len: number): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    g.strokeStyle = 'rgba(166,180,201,0.9)';
    g.fillStyle = 'rgba(166,180,201,0.9)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(cx - dx * len, cy - dy * len);
    g.lineTo(cx + dx * len, cy + dy * len);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + dx * len, cy + dy * len);
    g.lineTo(cx + dx * len * 0.45 - dy * len * 0.4, cy + dy * len * 0.45 + dx * len * 0.4);
    g.lineTo(cx + dx * len * 0.45 + dy * len * 0.4, cy + dy * len * 0.45 - dx * len * 0.4);
    g.closePath();
    g.fill();
  }

  /** Bandit: reward + regret curves on top, arm-choice histogram below. */
  private drawBandit(g: CanvasRenderingContext2D, w: number, h: number, res: RlRunResult, zh: boolean): void {
    const halfH = Math.round((h - 66 - 56) * 0.5);
    const leftBox = plotBox(Math.round(w * 0.5) - 8, halfH, 62, 62, 24, 44);
    this.drawLinePanel(
      g,
      leftBox,
      [
        { data: res.episodeRewards, color: 'rgba(120,200,255,0.45)' },
        { data: res.runningMean, color: CS.amber, dash: true },
      ],
      zh ? '步' : 'step',
      zh ? '单步奖励' : 'reward',
      zh,
    );
    drawLegend(
      g,
      leftBox.x0 + 8,
      leftBox.y0 - 10,
      [
        { label: zh ? '单步奖励' : 'per-step reward', color: 'rgba(120,200,255,0.45)' },
        { label: zh ? '累计均值' : 'running mean', color: CS.amber, dash: true },
      ],
      zh,
    );

    if (res.regret) {
      const rightBox = plotBox(w, halfH, Math.round(w * 0.5) + 10, 62, 26, 44);
      this.drawLinePanel(g, rightBox, [{ data: res.regret, color: CS.red }], zh ? '步' : 'step', zh ? '累计遗憾' : 'regret', zh);
      drawLegend(g, rightBox.x0 + 8, rightBox.y0 - 10, [{ label: zh ? '累计遗憾' : 'cumulative regret', color: CS.red }], zh);
    }

    if (res.armCounts) {
      const counts = res.armCounts;
      const maxCount = Math.max(1, ...counts);
      const histTop = halfH + 84;
      const box = plotBox(w, h, 62, histTop, 28, 56);
      const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        value: t,
        label: fmtMetric(maxCount - t * maxCount, 3),
      }));
      const xTicks = counts.map((_, i) => ({ value: (i + 0.5) / counts.length, label: String(i + 1) }));
      drawAxes(g, box, xTicks, yTicks, zh ? '臂' : 'arm', zh ? '选择次数' : 'pull count', zh);
      const slot = box.w / counts.length;
      const barW = Math.min(56, slot * 0.62);
      counts.forEach((c, i) => {
        const barH = (c / maxCount) * box.h;
        g.fillStyle = PALETTE[i % PALETTE.length]!;
        g.fillRect(box.x0 + i * slot + (slot - barW) / 2, box.y1 - barH, barW, barH);
      });
    }
  }

  /** CartPole: episode-reward curve on top, pole-angle trace below. */
  private drawCartPole(g: CanvasRenderingContext2D, w: number, h: number, res: RlRunResult, zh: boolean): void {
    const topH = Math.round(h * 0.46);
    const topBox = plotBox(w, topH, 62, 62, 28, 44);
    this.drawLinePanel(
      g,
      topBox,
      [
        { data: res.episodeRewards, color: 'rgba(120,200,255,0.55)' },
        { data: res.runningMean, color: CS.amber, dash: true },
      ],
      zh ? '回合' : 'episode',
      zh ? '回报' : 'reward',
      zh,
    );
    drawLegend(
      g,
      topBox.x0 + 8,
      topBox.y0 - 10,
      [
        { label: zh ? '回合回报' : 'episode reward', color: 'rgba(120,200,255,0.55)' },
        { label: zh ? '累计均值' : 'running mean', color: CS.amber, dash: true },
      ],
      zh,
    );

    const trace = res.angleTrace ?? [];
    if (trace.length === 0) return;
    const box = plotBox(w, h, 62, topH + 26, 28, 56);
    // Expand the range to show the ±12° failure threshold when it is close.
    const thr = CARTPOLE_FAIL_THETA;
    let lo = Math.min(...trace, -thr);
    let hi = Math.max(...trace, thr);
    if (hi - lo < 1e-9) {
      hi += 0.01;
      lo -= 0.01;
    }
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: fmtMetric(hi - t * (hi - lo), 3),
    }));
    const maxLen = trace.length;
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      value: t,
      label: String(Math.round(t * (maxLen - 1)) + 1),
    }));
    drawAxes(g, box, xTicks, yTicks, zh ? '步' : 'step', zh ? '杆角度 (rad)' : 'pole angle (rad)', zh);
    // Failure-threshold guide lines (dashed red) when inside the box.
    const span = hi - lo;
    for (const t of [thr, -thr]) {
      const y = box.y1 - box.h * ((t - lo) / span);
      if (y < box.y0 || y > box.y1) continue;
      g.strokeStyle = 'rgba(255,139,134,0.55)';
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(box.x0, y);
      g.lineTo(box.x1, y);
      g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = CS.violet;
    g.lineWidth = 1.4;
    g.beginPath();
    trace.forEach((v, i) => {
      const x = box.x0 + box.w * (i / Math.max(1, maxLen - 1));
      const y = box.y1 - box.h * ((v - lo) / span);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
}

export default function createRlPlugin(): Plugin {
  return new RLPlugin();
}
