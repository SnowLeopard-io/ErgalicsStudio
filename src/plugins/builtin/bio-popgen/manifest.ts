import type { PluginManifest } from '@/types/plugin';

export const bioPopgenManifest: PluginManifest = {
  id: 'example.bio-popgen',
  name: 'Population Genetics',
  nameI18n: { 'zh-CN': '群体遗传学', 'en-US': 'Population Genetics' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Hardy-Weinberg equilibrium chi-square test plus a seeded, fully reproducible Wright-Fisher genetic-drift simulation with optional selection (recessive/additive/dominant).',
  descriptionI18n: {
    'zh-CN':
      '哈代-温伯格平衡（HWE）卡方检验，以及带可选自然选择（隐性/加性/显性）的、可复现的 Wright-Fisher 遗传漂变模拟；展示等位基因频率的随机漂移、固定概率与杂合度衰减。',
    'en-US':
      'Hardy-Weinberg equilibrium chi-square test and a seeded, fully reproducible Wright-Fisher genetic-drift simulation with optional selection (recessive / additive / dominant), showing random allele-frequency drift, fixation and heterozygosity decay.',
  },
  license: 'MIT',
  entry: 'example.bio-popgen',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'genotype AA,Aa,aa counts' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated AA,Aa,aa counts' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'genotype counts {AA,Aa,aa} / [AA,Aa,aa]' },
    { extension: '.vcf', mimeTypes: ['text/vcard', 'text/plain', 'application/gzip'], description: 'VCF variant-call genotypes (GT)' },
    { extension: '.dat', mimeTypes: ['text/plain'], description: 'whitespace AA,Aa,aa counts' },
  ],
};