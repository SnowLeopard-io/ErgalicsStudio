// ==========================================================================
// Zipf's law word-frequency analysis — manifest
//
// Tokenizes real public-domain text, ranks words by frequency, fits the
// power law f(r) ∝ r^-s by ordinary least squares on log(rank) vs log(freq)
// with an s ± sigma estimate and R^2, and compares against the ideal
// Zipf exponent s = 1. Ships Jane Austen's Emma (1816) — Project Gutenberg
// eBook #158, public domain — as a real-corpus sample.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const statsZipfManifest: PluginManifest = {
  id: 'example.stats-zipf',
  name: "Zipf's Law Word Frequencies",
  nameI18n: { 'zh-CN': 'Zipf 定律词频分析', 'en-US': "Zipf's Law Word Frequencies" },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    "Zipf's-law analyser for real corpora: tokenize (English words or CJK characters), rank word frequencies, fit log(rank)-log(freq) by least squares (exponent s ± sigma, R^2, per-rank residuals), optionally drop the top-N hapx-driven headwords, and compare against the ideal s = 1 (Zipf 1949).",
  descriptionI18n: {
    'zh-CN':
      '真实语料的 Zipf 定律分析：分词（英文按词、中文按字）、词频排序、log(rank)–log(freq) 最小二乘拟合（指数 s±σ、R²、逐秩残差）、可选剔除前 N 个高频词，并与理想 Zipf 指数 s=1 对照（Zipf 1949）。内置 Jane Austen《Emma》公版语料（Gutenberg #158）。',
    'en-US':
      "Zipf's-law analyser for real corpora: tokenize (English words or CJK characters), rank word frequencies, fit log(rank)-log(freq) by least squares (exponent s ± sigma, R^2, per-rank residuals), optionally drop the top-N headwords, and compare against the ideal s = 1 (Zipf 1949). Ships Jane Austen's Emma public-domain corpus (Gutenberg #158).",
  },
  license: 'MIT',
  entry: 'example.stats-zipf',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    benchmarks: ['zipf-synthetic-recovery', 'zipf-micro-text', 'zipf-ols-hand'],
    reproducible: true,
    notes:
      'Benchmarks: (1) a seeded synthetic corpus drawn exactly from p(r) ∝ r^-1.0 over 2000 ranks recovers s within 5% relative error (OLS over ranks 1-500, where expected counts stay large enough to avoid log-domain Poisson bias); (2) the micro text "the cat sat on the mat" gives the:2 hand-checked counts; (3) the OLS fit (slope/intercept/R²) matches an independent closed-form computation to < 1e-9 on a perfectly log-linear fixture. Relative errors use |computed - analytic| / |analytic|. Real-data sample: Jane Austen, Emma (1816), Project Gutenberg eBook #158, public domain.',
    notesI18n: {
      'zh-CN':
        '基准：① 按精确 p(r) ∝ r^-1.0（2000 秩、固定种子）合成的词袋回收 s，相对误差 < 5%（在 1–500 秩上拟合，期望计数足够大以规避对数域 Poisson 偏置）；② 微型文本 "the cat sat on the mat" 手工词频对照（the:2）；③ OLS 拟合（斜率/截距/R²）与独立闭式计算在完全对数线性数据上误差 < 1e-9。相对误差口径 |计算−解析|/|解析|。真实语料：Jane Austen《Emma》(1816)，Project Gutenberg eBook #158，公版。',
      'en-US':
        'Benchmarks: (1) a seeded synthetic corpus drawn exactly from p(r) ∝ r^-1.0 over 2000 ranks recovers s within 5% relative error (OLS over ranks 1-500, where expected counts stay large enough to avoid log-domain Poisson bias); (2) the micro text "the cat sat on the mat" gives the:2 hand-checked counts; (3) the OLS fit (slope/intercept/R²) matches an independent closed-form computation to < 1e-9 on a perfectly log-linear fixture. Relative errors use |computed - analytic| / |analytic|. Real-data sample: Jane Austen, Emma (1816), Project Gutenberg eBook #158, public domain.',
    },
  },
  formats: [
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'raw text corpus ("#..." lines are treated as comments)' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'raw text, or pre-computed "word,count" frequency pairs' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'raw text, or tab-separated "word<TAB>count" pairs' },
  ],
};
