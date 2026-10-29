// TEMPORARY smoke test — deleted after verification.
import { describe, expect, it } from 'vitest';
import {
  makeGridWorld,
  runBanditExperiment,
  runCartPoleExperiment,
  runGridExperiment,
} from './kernel';

describe('rl kernel smoke', () => {
  it('q-learning solves the 6x6 cliff', async () => {
    const cliff = makeGridWorld({
      size: 6, start: 30, goal: 35, traps: [31, 32, 33, 34],
      trapReward: -100, goalReward: 1, stepCost: -1, slip: 0,
    });
    const res = await runGridExperiment(
      'qlearning', cliff,
      { episodes: 500, alpha: 0.1, gamma: 0.99, epsilon: 0.1, maxSteps: 200 },
      { seed: 42 },
    );
    expect(res.meanRewardLast50).toBeGreaterThan(-60);
    expect(res.bestEpisode).toBeGreaterThan(-20);
    expect(res.policy![35]).toBe(-1); // goal has no policy arrow
  });

  it('sarsa runs and eps-greedy/ucb1/thompson keep bandit regret bounded', async () => {
    const sarsa = await runGridExperiment(
      'sarsa', makeGridWorld({ size: 6, start: 30, goal: 35, traps: [31, 32, 33, 34], trapReward: -100, goalReward: 1, stepCost: -1 }),
      { episodes: 300, alpha: 0.1, gamma: 0.99, epsilon: 0.1, maxSteps: 200 },
      { seed: 7 },
    );
    expect(sarsa.meanRewardLast50).toBeGreaterThan(-120);

    for (const agent of ['eps-greedy', 'ucb1', 'thompson'] as const) {
      const res = await runBanditExperiment(agent, { k: 10, type: 'gaussian' }, 2000, { epsilon: 0.1 }, { seed: 42 });
      expect(res.finalRegret!).toBeLessThan(400);
      expect(res.armCounts!.reduce((a, b) => a + b, 0)).toBe(2000);
    }
  });

  it('reinforce learns the classic 4x4 and cartpole q-learning beats random', async () => {
    const re = await runGridExperiment(
      'reinforce',
      makeGridWorld({ size: 4, start: 0, goal: 15, traps: [5, 7, 11, 12], trapReward: -1, goalReward: 1, stepCost: -0.01 }),
      { episodes: 600, alpha: 0.2, gamma: 0.99, epsilon: 0, maxSteps: 200 },
      { seed: 11 },
    );
    expect(re.meanRewardLast50).toBeGreaterThan(0);
    expect(re.bestEpisode).toBeGreaterThan(0.5);

    const cart = await runCartPoleExperiment(
      'qlearning',
      { episodes: 300, alpha: 0.2, gamma: 0.99, epsilon: 0.1, maxSteps: 500 },
      { seed: 5 },
    );
    expect(cart.meanRewardLast50).toBeGreaterThan(40);
    expect(cart.angleTrace!.length).toBeGreaterThan(1);
  });

  it('is deterministic given the same seed', async () => {
    const spec = makeGridWorld({ size: 4, start: 0, goal: 15, traps: [5, 7, 11, 12], trapReward: -1, goalReward: 1, stepCost: -0.01 });
    const a = await runGridExperiment('qlearning', spec, { episodes: 100, alpha: 0.1, gamma: 0.99, epsilon: 0.1, maxSteps: 200 }, { seed: 99 });
    const b = await runGridExperiment('qlearning', spec, { episodes: 100, alpha: 0.1, gamma: 0.99, epsilon: 0.1, maxSteps: 200 }, { seed: 99 });
    expect(a.episodeRewards).toEqual(b.episodeRewards);
    expect(a.policy).toEqual(b.policy);
  });
});
