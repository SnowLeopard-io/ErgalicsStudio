import type { PluginManifest } from '@/types/plugin';

export const bioMendelManifest: PluginManifest = {
  id: 'example.bio-mendel',
  name: 'Mendel F2 χ² Tests',
  nameI18n: { 'zh-CN': '孟德尔 F2 分离比 χ² 检验', 'en-US': 'Mendel F2 χ² Tests' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Chi-square goodness-of-fit tests for Mendelian F2 segregation ratios (3:1 monohybrid, 9:3:3:1 dihybrid). Ships the seven-trait 1866 dataset, a self-implemented χ² p-value via the regularized incomplete gamma function (no stats dependency), per-trait and pooled verdicts.',
  descriptionI18n: {
    'zh-CN':
      '对孟德尔 F2 分离比（单杂合 3:1、双杂合 9:3:3:1）做卡方拟合优度检验：内置 1866 年七性状原始计数，自行实现不完全伽马函数计算 χ² p 值（无统计库依赖），输出逐性状与合并检验结论。',
    'en-US':
      'Chi-square goodness-of-fit tests for Mendelian F2 segregation ratios (3:1 monohybrid, 9:3:3:1 dihybrid). Ships the seven-trait 1866 dataset, a self-implemented χ² p-value via the regularized incomplete gamma function (no stats dependency), per-trait and pooled verdicts.',
  },
  license: 'MIT',
  entry: 'example.bio-mendel',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { count: 'individuals' },
    benchmarks: ['mendel-chi2-numeric'],
    reproducible: true,
    notes:
      'Embedded validation battery: hand-computed χ²=2.4 exact; df=1 quantile χ²=3.8414588→p=0.05 within 1e-4; even-df closed forms Q(2,x)=e^(−x/2) and Q(4,x)=e^(−x/2)(1+x/2) within 1e-9; Mendel round:wrinkled 5474:1850 → χ²≈0.262879 (E=[5493,1831]) within 1e-9. Reference data: Mendel (1866) "Versuche über Pflanzen-Hybriden", public domain.',
    notesI18n: {
      'zh-CN':
        '内嵌验证：手算例 χ²=2.4 精确成立；df=1 分位数 χ²=3.8414588→p=0.05（误差<1e-4）；偶数自由度闭式 Q(2,x)=e^(−x/2)、Q(4,x)=e^(−x/2)(1+x/2)（误差<1e-9）；孟德尔圆粒:皱粒 5474:1850 → χ²≈0.262879（E=[5493,1831]，误差<1e-9）。数据出处：Mendel (1866)《植物杂交试验》，公版。',
      'en-US':
        'Embedded validation battery: hand-computed χ²=2.4 exact; df=1 quantile χ²=3.8414588→p=0.05 within 1e-4; even-df closed forms Q(2,x)=e^(−x/2) and Q(4,x)=e^(−x/2)(1+x/2) within 1e-9; Mendel round:wrinkled 5474:1850 → χ²≈0.262879 (E=[5493,1831]) within 1e-9. Reference data: Mendel (1866) "Versuche über Pflanzen-Hybriden", public domain.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'trait,category,observed,expectedRatio counts table' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated counts table' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma/semicolon/tab-separated counts table' },
  ],
};
