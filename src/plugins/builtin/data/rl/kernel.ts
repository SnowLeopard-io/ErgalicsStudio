// ==========================================================================
// Reinforcement Learning Lab kernel — pure RL logic.
//
// No DOM / host imports: every experiment is deterministic given
// (config, seed), so a run can be reproduced bit-for-bit. Contents:
//   - seeded RNG (mulberry32) + Gaussian sampler + Beta sampler
//   - environments:
//       * GridWorld   — configurable size (default 6×6), start/goal/trap
//                       cells, per-step cost and slip probability
//       * CartPole    — classic pole-balancing physics with discretized
//                       state bins for tabular methods
//       * MAB         — k-armed bandit with Bernoulli or Gaussian arms
//   - agents:
//       * bandits     — epsilon-greedy, UCB1, Thompson sampling
//       * tabular     — Q-Learning and SARSA (configurable alpha/gamma/eps)
//       * policy grad — REINFORCE with a small linear softmax policy
//   - bookkeeping: per-episode rewards, running means, bandit regret,
//     Q-table snapshot, per-cell greedy policy / state values, pole-angle
//     trace of the last CartPole episode
//   - async experiment runners that yield to the event loop every few
//     episodes and honour a stop callback (the plugin stays responsive
//     without Web Workers)
// ==========================================================================

export type Rng = () => number;

/** GridWorld learning algorithms. */
export type GridAlgorithm = 'qlearning' | 'sarsa' | 'reinforce';
/** Multi-armed bandit agents. */
export type BanditAgent = 'eps-greedy' | 'ucb1' | 'thompson';
/** Tabular algorithms usable on CartPole (REINFORCE is grid-only here). */
export type CartAlgorithm = 'qlearning' | 'sarsa';

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box-Muller (two uniforms per call). */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) draw via Marsaglia-Tsang; used by the Beta sampler. */
function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) {
    // Boost trick: G(a) = G(a+1) · U^(1/a).
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gaussian(rng);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) draw — Thompson posterior sample for Bernoulli arms. */
function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---- GridWorld --------------------------------------------------------------

/** Actions: 0 = up, 1 = right, 2 = down, 3 = left. */
export const GRID_ACTIONS = 4;
const GRID_DR = [-1, 0, 1, 0] as const;
const GRID_DC = [0, 1, 0, -1] as const;

export interface GridWorldSpec {
  /** Square grid side; the board has size × size cells. */
  size: number;
  /** Flattened start cell index. */
  start: number;
  /** Flattened goal cell index (terminal, `goalReward`). */
  goal: number;
  /** Flattened trap / cliff indices (terminal, `trapReward`). */
  traps: number[];
  /** Reward for stepping onto a trap (negative, e.g. −100 for the cliff). */
  trapReward: number;
  /** Reward for reaching the goal. */
  goalReward: number;
  /** Reward for every non-terminal step (negative step cost). */
  stepCost: number;
  /** Probability of slipping to a perpendicular action each step. */
  slip: number;
}

export function makeGridWorld(partial: Partial<GridWorldSpec> = {}): GridWorldSpec {
  const size = clampNum(Math.round(partial.size ?? 6), 3, 12);
  const n = size * size;
  const goal = clampNum(Math.round(partial.goal ?? n - 1), 0, n - 1);
  const traps = (partial.traps ?? []).filter((c) => c >= 0 && c < n && c !== goal);
  return {
    size,
    start: clampNum(Math.round(partial.start ?? 0), 0, n - 1),
    goal,
    traps: [...new Set(traps)],
    trapReward: partial.trapReward ?? -1,
    goalReward: partial.goalReward ?? 1,
    stepCost: partial.stepCost ?? -0.01,
    slip: clampNum(partial.slip ?? 0, 0, 0.9),
  };
}

export function isGridTerminal(spec: GridWorldSpec, state: number): boolean {
  return state === spec.goal || spec.traps.includes(state);
}

/** One environment transition. Traps / cliff send the agent home and end the episode. */
export function gridStep(
  spec: GridWorldSpec,
  state: number,
  action: number,
  rng: Rng,
): { state: number; reward: number; done: boolean } {
  let a = action;
  if (spec.slip > 0 && rng() < spec.slip) {
    a = (action + (rng() < 0.5 ? 1 : 3)) % GRID_ACTIONS;
  }
  const row = Math.floor(state / spec.size);
  const col = state % spec.size;
  const nr = clampNum(row + GRID_DR[a]!, 0, spec.size - 1);
  const nc = clampNum(col + GRID_DC[a]!, 0, spec.size - 1);
  const next = nr * spec.size + nc;
  if (spec.traps.includes(next)) {
    return { state: spec.start, reward: spec.trapReward, done: true };
  }
  if (next === spec.goal) {
    return { state: next, reward: spec.goalReward, done: true };
  }
  return { state: next, reward: spec.stepCost, done: false };
}

// ---- CartPole ---------------------------------------------------------------

export const CARTPOLE_ACTIONS = 2;
/** Bins per state dimension [x, xDot, theta, thetaDot] → 3×3×6×6 = 324 states. */
export const CARTPOLE_BINS = [3, 3, 6, 6] as const;
export const CARTPOLE_STATES =
  CARTPOLE_BINS[0]! * CARTPOLE_BINS[1]! * CARTPOLE_BINS[2]! * CARTPOLE_BINS[3]!;
/** Pole fails beyond ±12° (classic CartPole-v0/v1 bound). */
export const CARTPOLE_FAIL_THETA = (12 * Math.PI) / 180;
export const CARTPOLE_X_LIMIT = 2.4;

export interface CartPolePhysics {
  gravity: number;
  massCart: number;
  massPole: number;
  /** Half-length of the pole (centre of mass). */
  length: number;
  forceMag: number;
  tau: number;
}

export const CARTPOLE_PHYSICS: CartPolePhysics = {
  gravity: 9.8,
  massCart: 1.0,
  massPole: 0.1,
  length: 0.5,
  forceMag: 10.0,
  tau: 0.02,
};

/** Upright, centred initial state with a tiny seeded nudge. */
export function cartPoleReset(rng: Rng): number[] {
  return [(rng() - 0.5) * 0.1, 0, (rng() - 0.5) * 0.1, 0];
}

/** One Euler step of the classic CartPole dynamics. */
export function cartPoleStep(
  state: number[],
  action: number,
): { state: number[]; reward: number; done: boolean } {
  const x = state[0] ?? 0;
  const xDot = state[1] ?? 0;
  const theta = state[2] ?? 0;
  const thetaDot = state[3] ?? 0;
  const p = CARTPOLE_PHYSICS;
  const force = action === 1 ? p.forceMag : -p.forceMag;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const totalMass = p.massCart + p.massPole;
  const poleMassLength = p.massPole * p.length;
  const temp = (force + poleMassLength * thetaDot * thetaDot * sinT) / totalMass;
  const thetaAcc =
    (p.gravity * sinT - cosT * temp) /
    (p.length * (4 / 3 - (p.massPole * cosT * cosT) / totalMass));
  const xAcc = temp - (poleMassLength * thetaAcc * cosT) / totalMass;

  const nx = x + p.tau * xDot;
  const nxDot = xDot + p.tau * xAcc;
  const nTheta = theta + p.tau * thetaDot;
  const nThetaDot = thetaDot + p.tau * thetaAcc;

  const done = Math.abs(nx) > CARTPOLE_X_LIMIT || Math.abs(nTheta) > CARTPOLE_FAIL_THETA;
  return { state: [nx, nxDot, nTheta, nThetaDot], reward: 1, done };
}

/** Clip-and-bin a continuous state into a single Q-table row index. */
export function discretizeCartPole(state: number[]): number {
  const bounds: Array<[number, number]> = [
    [-CARTPOLE_X_LIMIT, CARTPOLE_X_LIMIT],
    [-3, 3],
    [-CARTPOLE_FAIL_THETA, CARTPOLE_FAIL_THETA],
    [-3.5, 3.5],
  ];
  let idx = 0;
  for (let d = 0; d < 4; d += 1) {
    const [lo, hi] = bounds[d]!;
    const bins = CARTPOLE_BINS[d]!;
    const v = clampNum(state[d] ?? 0, lo, hi);
    // Scale to [0, bins) — the top bound lands in the last bin, not `bins`.
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    idx = idx * CARTPOLE_BINS[d]! + b;
  }
  return idx;
}

// ---- Multi-armed bandit -----------------------------------------------------

export interface BanditSpec {
  k: number;
  type: 'bernoulli' | 'gaussian';
  /** Bernoulli success probabilities or Gaussian mean rewards per arm. */
  means: number[];
}

/** Seeded arm layout: Bernoulli p ~ U(0.2, 0.8); Gaussian q* ~ N(0, 1). */
export function makeBandit(k: number, type: 'bernoulli' | 'gaussian', rng: Rng): BanditSpec {
  const arms = clampNum(Math.round(k), 2, 20);
  const means: number[] = [];
  for (let i = 0; i < arms; i += 1) {
    means.push(type === 'bernoulli' ? 0.2 + rng() * 0.6 : gaussian(rng));
  }
  return { k: arms, type, means };
}

/** Expected reward of the best arm (the reference of regret). */
export function banditOptimalMean(spec: BanditSpec): number {
  return Math.max(...spec.means);
}

/** Pull an arm once. */
export function banditPull(spec: BanditSpec, arm: number, rng: Rng): number {
  const mu = spec.means[arm] ?? 0;
  if (spec.type === 'bernoulli') return rng() < mu ? 1 : 0;
  return mu + gaussian(rng);
}

// ---- Experiment configuration / results -------------------------------------

export interface TabularConfig {
  episodes: number;
  /** Learning rate (Q/SARSA) or policy step size (REINFORCE). */
  alpha: number;
  gamma: number;
  /** Exploration rate for epsilon-greedy action selection. */
  epsilon: number;
  /** Hard step cap per episode. */
  maxSteps: number;
}

export interface RunOptions {
  seed: number;
  /** Checked between episodes — the plugin's Stop button flips this. */
  shouldStop?: () => boolean;
  /** Awaited every few episodes so the plugin can keep the UI responsive. */
  yieldFn?: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

/** Aggregated result of one experiment (one filled subset per env kind). */
export interface RlRunResult {
  env: 'gridworld' | 'cartpole' | 'bandit';
  algorithm: GridAlgorithm | CartAlgorithm | BanditAgent;
  /** Reward total per episode (per step for bandits). */
  episodeRewards: number[];
  /** Cumulative mean of `episodeRewards`. */
  runningMean: number[];
  /** Cumulative regret, bandits only. */
  regret: number[] | null;
  /** Pull counts per arm, bandits only. */
  armCounts: number[] | null;
  /** Trained Q-table snapshot (states × actions), tabular only. */
  qTable: number[][] | null;
  /** Per-cell greedy action on the grid, gridworld only. */
  policy: number[] | null;
  /** Per-cell state value V(s) = max_a Q(s,a), gridworld only. */
  values: number[] | null;
  /** Pole-angle trace (rad) of the last CartPole episode. */
  angleTrace: number[] | null;
  /** Total environment steps executed (also the benchmark throughput unit). */
  envSteps: number;
  /** Mean reward over the last 50 episodes. */
  meanRewardLast50: number;
  /** Best single-episode reward. */
  bestEpisode: number;
  /** Final cumulative regret, bandits only. */
  finalRegret: number | null;
  /** True when the run ended early via the stop callback. */
  stopped: boolean;
}

/** Episodes between event-loop yields (keeps Stop/typing responsive). */
const YIELD_EVERY = 4;

/** Shared run bookkeeping: step counter, reward history, stop/yield plumbing. */
class RunTracker {
  private rewards: number[] = [];
  private stepCount = 0;
  private stopped = false;

  constructor(private readonly opts: RunOptions) {}

  /** Check the stop flag before starting an episode; false = abort the run. */
  checkStop(): boolean {
    if (this.opts.shouldStop?.()) {
      this.stopped = true;
      return false;
    }
    return true;
  }

  /** Record one finished episode and periodically yield to the event loop. */
  async finishEpisode(done: number, total: number): Promise<void> {
    this.opts.onProgress?.(done, total);
    if (done % YIELD_EVERY === 0 && this.opts.yieldFn) await this.opts.yieldFn();
  }

  bumpSteps(count = 1): void {
    this.stepCount += count;
  }

  pushReward(total: number): void {
    this.rewards.push(total);
  }

  get envSteps(): number {
    return this.stepCount;
  }

  get wasStopped(): boolean {
    return this.stopped;
  }

  get rewardHistory(): number[] {
    return this.rewards;
  }
}

function runningMeanOf(rewards: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < rewards.length; i += 1) {
    sum += rewards[i]!;
    out.push(sum / (i + 1));
  }
  return out;
}

function summarize(rewards: number[]): { meanRewardLast50: number; bestEpisode: number } {
  const tail = rewards.slice(-50);
  const mean = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
  const best = rewards.length > 0 ? Math.max(...rewards) : 0;
  return { meanRewardLast50: mean, bestEpisode: best };
}

function createTable(rows: number, cols: number): number[][] {
  const q: number[][] = new Array(rows);
  for (let s = 0; s < rows; s += 1) q[s] = new Array<number>(cols).fill(0);
  return q;
}

function argmaxRow(qRow: number[]): number {
  let best = 0;
  for (let a = 1; a < qRow.length; a += 1) if (qRow[a]! > qRow[best]!) best = a;
  return best;
}

/** Epsilon-greedy pick from one Q row (greedy part uses a strict argmax). */
function epsGreedy(qRow: number[], epsilon: number, rng: Rng): number {
  if (rng() < epsilon) return Math.floor(rng() * qRow.length) % qRow.length;
  return argmaxRow(qRow);
}

// ---- GridWorld: Q-Learning / SARSA ------------------------------------------

async function runGridTabular(
  algorithm: 'qlearning' | 'sarsa',
  spec: GridWorldSpec,
  config: TabularConfig,
  opts: RunOptions,
): Promise<RlRunResult> {
  const rng = mulberry32(opts.seed);
  const n = spec.size * spec.size;
  const q = createTable(n, GRID_ACTIONS);
  const tracker = new RunTracker(opts);
  const gamma = clampNum(config.gamma, 0, 0.9999);
  const alpha = clampNum(config.alpha, 0.001, 1);
  const epsilon = clampNum(config.epsilon, 0, 1);

  for (let ep = 0; ep < config.episodes; ep += 1) {
    if (!tracker.checkStop()) break;
    let state = spec.start;
    let total = 0;
    // SARSA is on-policy: the next action is sampled before the update.
    let action = epsGreedy(q[state]!, epsilon, rng);
    for (let step = 0; step < config.maxSteps; step += 1) {
      const next = gridStep(spec, state, action, rng);
      tracker.bumpSteps();
      total += next.reward;
      let target = next.reward;
      if (!next.done) {
        if (algorithm === 'sarsa') {
          const nextAction = epsGreedy(q[next.state]!, epsilon, rng);
          target += gamma * q[next.state]![nextAction]!;
          action = nextAction;
        } else {
          target += gamma * Math.max(...q[next.state]!);
        }
      }
      const row = q[state]!;
      row[action] = row[action]! + alpha * (target - row[action]!);
      state = next.done ? spec.start : next.state;
      if (next.done) break;
    }
    tracker.pushReward(total);
    await tracker.finishEpisode(ep + 1, config.episodes);
  }

  // Greedy policy and state values for non-terminal cells.
  const policy: number[] = new Array(n).fill(-1);
  const values: number[] = new Array(n).fill(0);
  for (let s = 0; s < n; s += 1) {
    if (isGridTerminal(spec, s)) continue;
    policy[s] = argmaxRow(q[s]!);
    values[s] = Math.max(...q[s]!);
  }
  const rewards = tracker.rewardHistory;
  const { meanRewardLast50, bestEpisode } = summarize(rewards);
  return {
    env: 'gridworld',
    algorithm,
    episodeRewards: rewards,
    runningMean: runningMeanOf(rewards),
    regret: null,
    armCounts: null,
    qTable: q,
    policy,
    values,
    angleTrace: null,
    envSteps: tracker.envSteps,
    meanRewardLast50,
    bestEpisode,
    finalRegret: null,
    stopped: tracker.wasStopped,
  };
}

// ---- GridWorld: REINFORCE (linear softmax policy) ---------------------------

async function runGridReinforce(
  spec: GridWorldSpec,
  config: TabularConfig,
  opts: RunOptions,
): Promise<RlRunResult> {
  const rng = mulberry32(opts.seed);
  const n = spec.size * spec.size;
  const featBias = n; // index of the bias feature in every weight row
  // Linear softmax policy: preference(a, s) = w[a]·onehot(s) + bias.
  const weights = createTable(GRID_ACTIONS, n + 1);
  const tracker = new RunTracker(opts);
  const gamma = clampNum(config.gamma, 0, 0.9999);
  // One-hot features give large raw gradient magnitudes; rescale so the
  // shared alpha slider stays usable across Q-Learning and REINFORCE.
  const lr = clampNum(config.alpha, 0.001, 1) / 10;

  const softmax = (state: number): number[] => {
    const logits = new Array<number>(GRID_ACTIONS);
    let maxLogit = -Infinity;
    for (let a = 0; a < GRID_ACTIONS; a += 1) {
      const row = weights[a]!;
      const z = row[state]! + row[featBias]!;
      logits[a] = z;
      if (z > maxLogit) maxLogit = z;
    }
    let sum = 0;
    for (let a = 0; a < GRID_ACTIONS; a += 1) {
      logits[a] = Math.exp(logits[a]! - maxLogit);
      sum += logits[a]!;
    }
    for (let a = 0; a < GRID_ACTIONS; a += 1) logits[a] = logits[a]! / sum;
    return logits;
  };

  for (let ep = 0; ep < config.episodes; ep += 1) {
    if (!tracker.checkStop()) break;
    let state = spec.start;
    const states: number[] = [];
    const actions: number[] = [];
    const rewardsSeq: number[] = [];
    let total = 0;
    for (let step = 0; step < config.maxSteps; step += 1) {
      // Sample an action from the current softmax policy.
      const probs = softmax(state);
      let pick = rng();
      let action = GRID_ACTIONS - 1;
      for (let a = 0; a < GRID_ACTIONS; a += 1) {
        pick -= probs[a]!;
        if (pick <= 0) {
          action = a;
          break;
        }
      }
      const next = gridStep(spec, state, action, rng);
      tracker.bumpSteps();
      states.push(state);
      actions.push(action);
      rewardsSeq.push(next.reward);
      total += next.reward;
      state = next.done ? spec.start : next.state;
      if (next.done) break;
    }

    // REINFORCE update with discounted return-to-go: θ += lr · G_t · ∇log π.
    let G = 0;
    for (let t = states.length - 1; t >= 0; t -= 1) {
      G = gamma * G + rewardsSeq[t]!;
      if (!Number.isFinite(G)) break;
      const s = states[t]!;
      const a = actions[t]!;
      const probs = softmax(s);
      for (let a2 = 0; a2 < GRID_ACTIONS; a2 += 1) {
        const grad = (a2 === a ? 1 - probs[a2]! : -probs[a2]!) * lr * G;
        const row = weights[a2]!;
        row[s] = row[s]! + grad; // one-hot state feature
        row[featBias] = row[featBias]! + grad; // bias feature
      }
    }
    tracker.pushReward(total);
    await tracker.finishEpisode(ep + 1, config.episodes);
  }

  // Derive the greedy policy / values from the learned action preferences.
  const policy: number[] = new Array(n).fill(-1);
  const values: number[] = new Array(n).fill(0);
  for (let s = 0; s < n; s += 1) {
    if (isGridTerminal(spec, s)) continue;
    policy[s] = argmaxRow(weights.map((row) => row[s]!));
    values[s] = Math.max(...weights.map((row) => row[s]!));
  }
  const rewards = tracker.rewardHistory;
  const { meanRewardLast50, bestEpisode } = summarize(rewards);
  return {
    env: 'gridworld',
    algorithm: 'reinforce',
    episodeRewards: rewards,
    runningMean: runningMeanOf(rewards),
    regret: null,
    armCounts: null,
    qTable: weights.map((row) => row.slice(0, n)), // per-state preference scores
    policy,
    values,
    angleTrace: null,
    envSteps: tracker.envSteps,
    meanRewardLast50,
    bestEpisode,
    finalRegret: null,
    stopped: tracker.wasStopped,
  };
}

// ---- CartPole: Q-Learning / SARSA -------------------------------------------

async function runCartPole(
  algorithm: CartAlgorithm,
  config: TabularConfig,
  opts: RunOptions,
): Promise<RlRunResult> {
  const rng = mulberry32(opts.seed);
  const q = createTable(CARTPOLE_STATES, CARTPOLE_ACTIONS);
  const tracker = new RunTracker(opts);
  const gamma = clampNum(config.gamma, 0, 0.9999);
  const alpha = clampNum(config.alpha, 0.001, 1);
  const epsilon = clampNum(config.epsilon, 0, 1);
  let angleTrace: number[] | null = null;

  const update = (ds: number, action: number, target: number): void => {
    const row = q[ds]!;
    row[action] = row[action]! + alpha * (target - row[action]!);
  };

  for (let ep = 0; ep < config.episodes; ep += 1) {
    if (!tracker.checkStop()) break;
    let state = cartPoleReset(rng);
    let ds = discretizeCartPole(state);
    let action = epsGreedy(q[ds]!, epsilon, rng);
    let total = 0;
    const angles: number[] = [state[2] ?? 0];
    for (let step = 0; step < config.maxSteps; step += 1) {
      const next = cartPoleStep(state, action);
      tracker.bumpSteps();
      total += next.reward;
      angles.push(next.state[2] ?? 0);
      if (!next.done) {
        const nds = discretizeCartPole(next.state);
        if (algorithm === 'sarsa') {
          const nextAction = epsGreedy(q[nds]!, epsilon, rng);
          update(ds, action, next.reward + gamma * q[nds]![nextAction]!);
          action = nextAction;
        } else {
          update(ds, action, next.reward + gamma * Math.max(...q[nds]!));
        }
        ds = nds;
        state = next.state;
      } else {
        // Terminal: bootstrap only when the step cap (not failure) ended it.
        const reachedCap = step + 1 >= config.maxSteps;
        const nds = discretizeCartPole(next.state);
        update(ds, action, reachedCap ? next.reward + gamma * Math.max(...q[nds]!) : next.reward);
        break;
      }
    }
    angleTrace = angles;
    tracker.pushReward(total);
    await tracker.finishEpisode(ep + 1, config.episodes);
  }

  const rewards = tracker.rewardHistory;
  const { meanRewardLast50, bestEpisode } = summarize(rewards);
  return {
    env: 'cartpole',
    algorithm,
    episodeRewards: rewards,
    runningMean: runningMeanOf(rewards),
    regret: null,
    armCounts: null,
    qTable: q,
    policy: null,
    values: null,
    angleTrace,
    envSteps: tracker.envSteps,
    meanRewardLast50,
    bestEpisode,
    finalRegret: null,
    stopped: tracker.wasStopped,
  };
}

// ---- Multi-armed bandits -----------------------------------------------------

async function runBandit(
  agent: BanditAgent,
  spec: { k: number; type: 'bernoulli' | 'gaussian' },
  steps: number,
  config: Pick<TabularConfig, 'epsilon'>,
  opts: RunOptions,
): Promise<RlRunResult> {
  const rng = mulberry32(opts.seed);
  const bandit = makeBandit(spec.k, spec.type, rng);
  const k = bandit.k;
  const optimal = banditOptimalMean(bandit);
  const q = new Array<number>(k).fill(0); // sample-average value estimates
  const counts = new Array<number>(k).fill(0);
  const rewardSums = new Array<number>(k).fill(0);
  const successes = new Array<number>(k).fill(0); // Bernoulli Thompson posterior
  const rewards: number[] = [];
  const regret: number[] = [];
  const epsilon = clampNum(config.epsilon, 0, 1);
  let cumRegret = 0;
  let stopped = false;

  const pickArm = (t: number): number => {
    if (agent === 'eps-greedy') {
      if (rng() < epsilon) return Math.floor(rng() * k) % k;
      return argmaxRow(q);
    }
    if (agent === 'ucb1') {
      // Pull every arm once, then act optimistically under uncertainty (c = 2).
      for (let a = 0; a < k; a += 1) if (counts[a] === 0) return a;
      const c = 2;
      let best = 0;
      let bestScore = -Infinity;
      for (let a = 0; a < k; a += 1) {
        const score = q[a]! + (c * Math.sqrt(Math.log(t + 1))) / Math.sqrt(counts[a]!);
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }
      return best;
    }
    // Thompson sampling: sample each arm's posterior, take the maximum.
    let best = 0;
    let bestScore = -Infinity;
    for (let a = 0; a < k; a += 1) {
      let sample: number;
      if (bandit.type === 'bernoulli') {
        sample = sampleBeta(1 + successes[a]!, 1 + counts[a]! - successes[a]!, rng);
      } else {
        // Normal-normal conjugate posterior: prior N(0,1), known variance 1.
        const postMean = rewardSums[a]! / (counts[a]! + 1);
        sample = postMean + gaussian(rng) / Math.sqrt(counts[a]! + 1);
      }
      if (sample > bestScore) {
        bestScore = sample;
        best = a;
      }
    }
    return best;
  };

  for (let t = 0; t < steps; t += 1) {
    if (!opts.shouldStop?.()) {
      const arm = pickArm(t);
      const reward = banditPull(bandit, arm, rng);
      counts[arm] = counts[arm]! + 1;
      rewardSums[arm] = rewardSums[arm]! + reward;
      if (bandit.type === 'bernoulli' && reward === 1) successes[arm] = successes[arm]! + 1;
      q[arm] = rewardSums[arm]! / counts[arm]!;
      cumRegret += optimal - bandit.means[arm]!;
      rewards.push(reward);
      regret.push(cumRegret);
      if ((t + 1) % YIELD_EVERY === 0) {
        opts.onProgress?.(t + 1, steps);
        if (opts.yieldFn) await opts.yieldFn();
      }
    } else {
      stopped = true;
      break;
    }
  }
  opts.onProgress?.(rewards.length, steps);

  const { meanRewardLast50, bestEpisode } = summarize(rewards);
  return {
    env: 'bandit',
    algorithm: agent,
    episodeRewards: rewards,
    runningMean: runningMeanOf(rewards),
    regret,
    armCounts: counts.slice(),
    qTable: null,
    policy: null,
    values: null,
    angleTrace: null,
    envSteps: rewards.length,
    meanRewardLast50,
    bestEpisode,
    finalRegret: cumRegret,
    stopped,
  };
}

// ---- Public entry points -----------------------------------------------------

/** Run a GridWorld experiment (Q-Learning, SARSA or REINFORCE). */
export async function runGridExperiment(
  algorithm: GridAlgorithm,
  spec: GridWorldSpec,
  config: TabularConfig,
  opts: RunOptions,
): Promise<RlRunResult> {
  if (algorithm === 'reinforce') return runGridReinforce(spec, config, opts);
  return runGridTabular(algorithm, spec, config, opts);
}

/** Run a CartPole experiment (Q-Learning or SARSA on discretized states). */
export function runCartPoleExperiment(
  algorithm: CartAlgorithm,
  config: TabularConfig,
  opts: RunOptions,
): Promise<RlRunResult> {
  return runCartPole(algorithm, config, opts);
}

/** Run a bandit experiment; the arm layout itself is derived from the seed. */
export function runBanditExperiment(
  agent: BanditAgent,
  spec: { k: number; type: 'bernoulli' | 'gaussian' },
  steps: number,
  config: Pick<TabularConfig, 'epsilon'>,
  opts: RunOptions,
): Promise<RlRunResult> {
  return runBandit(agent, spec, steps, config, opts);
}
