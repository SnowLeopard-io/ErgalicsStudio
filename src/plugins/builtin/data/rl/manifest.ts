// ==========================================================================
// Reinforcement Learning Lab manifest — pure data, split from the plugin
// file so builtin/index.ts can import it statically without dragging the
// plugin implementation into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const rlManifest: PluginManifest = {
  id: 'ai.rl',
  name: 'Reinforcement Learning Lab',
  nameI18n: { 'zh-CN': '强化学习环境', 'en-US': 'Reinforcement Learning Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Tabular and policy-gradient reinforcement learning experiments: Q-Learning, SARSA and REINFORCE on GridWorld and CartPole environments, plus epsilon-greedy, UCB1 and Thompson-sampling agents on multi-armed bandits, with reward curves, regret and per-state greedy policies. Fully seeded and reproducible.',
  descriptionI18n: {
    'zh-CN':
      '强化学习实验环境：在 GridWorld 与 CartPole 上运行 Q-Learning、SARSA 与 REINFORCE，在多臂老虎机上运行 ε-贪婪、UCB1 与 Thompson 采样，输出回报曲线、累计遗憾与逐状态贪婪策略。全部实验基于随机种子，结果可复现。',
    'en-US':
      'Reinforcement learning experiments: Q-Learning, SARSA and REINFORCE on GridWorld and CartPole environments, plus epsilon-greedy, UCB1 and Thompson-sampling agents on multi-armed bandits, with reward curves, regret and per-state greedy policies. Fully seeded and reproducible.',
  },
  license: 'MIT',
  entry: 'ai.rl',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    reproducible: true,
    benchmarks: ['qlearn-gridworld', 'bandit-regret'],
  },
};
