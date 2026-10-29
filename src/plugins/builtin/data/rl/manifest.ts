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
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:2a25152a65d7f89544cb5c9cd503b456',
    sig: '0c15c12af30fe8db64fdebe08379d7159920ef70a2696d3fdbba01c129bb881cc1507ba2dc8eac677c0715dc66dcd57a996d59dfc746780f36ab5e70e0ef510a',
    signer: 'Ergalics Studio (AI suite pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: 'f0f5c97eedd922c9bb7dc31a874b82fdfb7e6d58f58fbe2987de9c9f27ecd63e',
  },
};
