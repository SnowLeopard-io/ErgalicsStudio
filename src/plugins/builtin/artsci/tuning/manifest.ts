import type { PluginManifest } from '@/types/plugin';

export const tuningManifest: PluginManifest = {
  id: 'example.tuning',
  name: 'Tuning System Calculator',
  nameI18n: { 'zh-CN': '音律系统计算器', 'en-US': 'Tuning System Calculator' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Twelve-chromatic-degree frequency, ratio and cent tables for 12-TET, 5-limit just intonation, Pythagorean tuning, quarter-comma meantone and Werckmeister III; MIDI→frequency mapping, cent-deviation charts, beat rates, seven diatonic modes and CSV import of custom tuning tables.',
  descriptionI18n: {
    'zh-CN':
      '十二平均律、五限纯律、毕达哥拉斯律、四分之一音差中全律与韦克迈斯特 III 的十二音级频率/比值/音分表；MIDI 音符→频率映射、音分偏差图、拍频、七种教会调式，以及自定义音律表 CSV 导入。',
    'en-US':
      'Twelve-chromatic-degree frequency, ratio and cent tables for 12-TET, 5-limit just intonation, Pythagorean tuning, quarter-comma meantone and Werckmeister III; MIDI→frequency mapping, cent-deviation charts, beat rates, seven diatonic modes and CSV import of custom tuning tables.',
  },
  license: 'MIT',
  entry: 'example.tuning',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { frequency: 'Hz', interval: 'cent', ratio: 'dimensionless' },
    benchmarks: [
      'octave-1200',
      '12tet-semitone-100',
      'just-fifth-701955',
      'syntonic-comma-21506',
      'pythagorean-comma-23460',
      'meantone-fifth-696578',
      'werckmeister-fifth-69609',
      'midi-a4-440',
    ],
    reproducible: true,
    notes:
      'Intervals use the exact definition cent = 1200·log2(f2/f1). 12-TET is generated as 2^(k/12); just intonation uses the standard 5-limit chromatic ratios (16/15 … 15/8); Pythagorean tuning stacks pure 3/2 fifths (wolf fifth 729/512); quarter-comma meantone and Werckmeister III use their published cent tables, converted to ratios with 2^(c/1200). Ratio spellings shown in the UI are best rational approximations with denominator ≤ 64, not the definitions.',
    notesI18n: {
      'zh-CN':
        '音程严格按 cent = 1200·log2(f2/f1) 计算。12-TET 由 2^(k/12) 生成；纯律采用标准五限半音比值（16/15 … 15/8）；毕达哥拉斯律由纯 3/2 五度叠置（狼五度 729/512）；中全律与韦克迈斯特 III 使用公开音分表并按 2^(c/1200) 转成比值。界面显示的分母 ≤ 64 的分数只是近似拼写，不是定义。',
      'en-US':
        'Intervals use the exact definition cent = 1200·log2(f2/f1). 12-TET is generated as 2^(k/12); just intonation uses the standard 5-limit chromatic ratios (16/15 … 15/8); Pythagorean tuning stacks pure 3/2 fifths (wolf fifth 729/512); quarter-comma meantone and Werckmeister III use their published cent tables, converted to ratios with 2^(c/1200). Ratio spellings shown in the UI are best rational approximations with denominator ≤ 64, not the definitions.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'bffb2dbb7bbf07b4d6844dcf97a42994460623b5863d65b7d591d3e48eebc1017f5378491283394bad8c2500a568e8f23161b83127d3c1be17d83308c9b38f08',
    signer: 'Ergalics Studio (artsci pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'custom tuning: degree, name, ratio, cents' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated tuning table' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma-separated tuning table with # comments' },
  ],
};
