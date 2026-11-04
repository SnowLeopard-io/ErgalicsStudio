// Bayesian Inference — MCMC, posterior predictive, Bayes factors, hierarchy.
import type { PluginManifest } from '@/types/plugin';

export const statsBayesManifest: PluginManifest = {
  id: 'example.stats-bayes',
  name: 'Bayesian Inference',
  nameI18n: { 'zh-CN': '贝叶斯推断', 'en-US': 'Bayesian Inference' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Full Bayesian workflow for the normal model: random-walk Metropolis-Hastings, conjugate Gibbs and Hamiltonian Monte Carlo samplers, posterior predictive checks, Savage-Dickey Bayes factors, hierarchical random intercepts and R-hat / ESS convergence diagnostics.',
  descriptionI18n: {
    'zh-CN':
      '正态模型的完整贝叶斯流程：随机游走 Metropolis-Hastings、共轭 Gibbs 与哈密顿蒙特卡洛采样、后验预测检验、Savage-Dickey 贝叶斯因子、分层随机截距模型以及 R-hat / ESS 收敛诊断。',
    'en-US':
      'Full Bayesian workflow for the normal model: random-walk Metropolis-Hastings, conjugate Gibbs and Hamiltonian Monte Carlo samplers, posterior predictive checks, Savage-Dickey Bayes factors, hierarchical random intercepts and R-hat / ESS convergence diagnostics.',
  },
  license: 'MIT',
  entry: 'example.stats-bayes',
  category: 'scientific',
  research: {
    tier: 'research',
    reproducible: true,
    benchmarks: ['posterior-mean', 'posterior-sigma', 'gibbs-analytic', 'rhat-convergence'],
    notes:
      'Samplers are seeded and deterministic. The model is a univariate normal with a normal-inverse-gamma prior; the Bayes factor is the Savage-Dickey density ratio at mu = mu0.',
    notesI18n: {
      'zh-CN': '采样器带固定种子且可复现。模型为带正态-逆 Gamma 先验的一元正态；贝叶斯因子为 mu = mu0 处的 Savage-Dickey 密度比。',
      'en-US':
        'Samplers are seeded and deterministic. The model is a univariate normal with a normal-inverse-gamma prior; the Bayes factor is the Savage-Dickey density ratio at mu = mu0.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'single numeric column with optional group' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'same table, tab separated' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '11ace17ed7c956b616676dff651b77af604cfcced28a5519ce004ed445ed6e999da8f169011b326623c82a6d0d9a81101ef58e9dabf5a6640827db7319d01c05',
    signer: 'Ergalics Studio (stats pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
