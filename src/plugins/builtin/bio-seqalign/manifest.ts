import type { PluginManifest } from '@/types/plugin';

export const bioSeqalignManifest: PluginManifest = {
  id: 'example.bio-seqalign',
  name: 'Sequence Alignment',
  nameI18n: { 'zh-CN': '序列比对与分析', 'en-US': 'Sequence Alignment' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'BLOSUM62 / DNA nucleotide pairwise alignment (global Needleman-Wunsch or local Smith-Waterman, affine gaps) plus composition, GC / GC1-3 and sliding-window GC profiling.',
  descriptionI18n: {
    'zh-CN':
      'BLOSUM62 / 核酸打分矩阵的双序列比对（全局 Needleman-Wunsch 或局部 Smith-Waterman，仿射空位罚分），以及碱基组成、GC / GC1-3 密码子 GC 和滑动窗口 GC 分析，支持 FASTA 数据。',
    'en-US':
      'BLOSUM62 / nucleotide pairwise alignment (global Needleman-Wunsch or local Smith-Waterman with affine gaps), plus base-composition, GC / codon GC1-3, sliding-window GC profiling and FASTA support.',
  },
  license: 'MIT',
  entry: 'example.bio-seqalign',
  category: 'scientific',
  formats: [{ extension: '.fasta', mimeTypes: ['text/plain', 'text/fasta'], description: 'FASTA nucleotide/protein sequences' }],
};