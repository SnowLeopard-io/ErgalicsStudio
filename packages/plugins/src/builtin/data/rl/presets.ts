// ==========================================================================
// RL_PRESETS — default environment presets for the Reinforcement Learning
// Lab. Pure data, bilingual labels; the plugin applies a preset whenever the
// user (or a compute config) switches environments.
// ==========================================================================

import type { GridWorldSpec } from './kernel';

export type RlEnvKind = 'gridworld' | 'cartpole' | 'bandit';

export interface RlPreset {
  id: string;
  env: RlEnvKind;
  /** English label. */
  label: string;
  /** zh-CN label. */
  labelZh: string;
  /** GridWorld layout (presets with `env: 'gridworld'`). */
  grid?: Partial<GridWorldSpec>;
  /** Bandit arm layout (presets with `env: 'bandit'`). */
  bandit?: { k: number; type: 'bernoulli' | 'gaussian' };
}

export const RL_PRESETS: readonly RlPreset[] = [
  {
    id: 'grid-classic-4x4',
    env: 'gridworld',
    label: 'GridWorld · Classic 4×4',
    labelZh: '网格世界 · 经典 4×4',
    grid: {
      size: 4,
      start: 0, // top-left corner
      goal: 15, // bottom-right corner
      traps: [5, 7, 11, 12], // frozen-lake style holes
      trapReward: -1,
      goalReward: 1,
      stepCost: -0.01,
      slip: 0,
    },
  },
  {
    id: 'grid-cliff-6x6',
    env: 'gridworld',
    label: 'GridWorld · Cliff 6×6',
    labelZh: '网格世界 · 悬崖 6×6',
    grid: {
      size: 6,
      start: 30, // bottom-left corner
      goal: 35, // bottom-right corner
      traps: [31, 32, 33, 34], // the cliff between start and goal
      trapReward: -100,
      goalReward: 1,
      stepCost: -1,
      slip: 0,
    },
  },
  {
    id: 'bandit-gaussian-10',
    env: 'bandit',
    label: 'Bandit · 10-arm Gaussian',
    labelZh: '多臂老虎机 · 10 臂高斯',
    bandit: { k: 10, type: 'gaussian' },
  },
  {
    id: 'cartpole-default',
    env: 'cartpole',
    label: 'CartPole · Default',
    labelZh: '倒立摆 · 默认',
  },
];

/** First preset of a given environment (used when the env switches). */
export function firstPresetOf(env: RlEnvKind): RlPreset | undefined {
  return RL_PRESETS.find((p) => p.env === env);
}
