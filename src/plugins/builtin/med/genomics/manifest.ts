import type { PluginManifest } from '@/types/plugin';

export const medGenomicsManifest: PluginManifest = {
  id: 'example.med-genomics',
  name: 'Genomics Visualizer',
  nameI18n: { 'zh-CN': '基因组可视化器', 'en-US': 'Genomics Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Five-mode genomics viewer: GWAS Manhattan with QQ plot and genomic inflation, volcano plot of differential expression, LD (r2) heatmap, seeded preranked GSEA, and a Circos-style rearrangement map, with CSV export and per-mode statistical readouts.',
  descriptionI18n: {
    'zh-CN':
      '五种模式的基因组可视化：GWAS 曼哈顿图与 QQ 图（含基因组膨胀因子）、差异表达火山图、连锁不平衡 r² 热图、固定种子的预排序 GSEA 富集分析、Circos 风格染色体重排图；支持按模式导出 CSV 与统计指标输出。',
    'en-US':
      'Five-mode genomics viewer: GWAS Manhattan plot with QQ plot and genomic-inflation lambda, differential-expression volcano plot, LD (r2) heatmap, fixed-seed preranked GSEA, and a Circos-style chromosomal rearrangement map, with per-mode CSV export and statistical readouts.',
  },
  license: 'MIT',
  entry: 'example.med-genomics',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { position: 'bp' },
    reproducible: true,
    notes:
      'Bundled examples are seeded simulations; GWAS/QQ statistics (lambda, confidence band) and permutation p-values are asymptotic approximations intended for screening and teaching, not for clinical or association-study reporting.',
    notesI18n: {
      'zh-CN':
        '内置示例为固定种子的模拟数据；GWAS/QQ 统计量（λ、置信带）与置换 p 值均为渐近近似，适用于筛查与教学展示，不用于临床或正式关联分析报告。',
      'en-US':
        'Bundled examples are seeded simulations; GWAS/QQ statistics (lambda, confidence band) and permutation p-values are asymptotic approximations for screening and teaching, not for clinical or association-study reporting.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:b4c5b02139f0dd386dde3b8fe91cf966',
    sig: '4cbb6ad633e38d85d407aa7b4f798ffd6ec8681134331adc1448fdcea5537a0c13d3105dd8c98a3bbb600869ec54cd4e4a224be4559b914dc44ed4e0a4e6ef0c',
    signer: 'Ergalics Studio (med pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '25f660c62a9e6bb7d3108bb59667b99d49f7fa2a60df6308361226303a751e55',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'chr,pos,p / gene,log2fc,padj / LD matrix / circos anchors' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated tables with the same columns' },
  ],
};
