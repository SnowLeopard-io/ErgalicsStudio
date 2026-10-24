import type { PluginManifest } from '@/types/plugin';

export const carbonDatingManifest: PluginManifest = {
  id: 'example.geo-carbondating',
  name: 'Radiocarbon Dating Lab',
  nameI18n: { 'zh-CN': '放射性碳定年实验室', 'en-US': 'Radiocarbon Dating Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Radiocarbon dating laboratory: Libby conventional ages (5568 yr half-life, BP = 1950), likelihood-profile calibration against the IntCal20 atmospheric curve with combined measurement + curve uncertainty, and inverse-variance multi-sample combination.',
  descriptionI18n: {
    'zh-CN':
      '放射性碳定年实验室：Libby 常规年龄（5568 年半衰期，BP=1950）、对 IntCal20 大气校准曲线做似然剖面校准（合并测量与曲线不确定度，χ² 最小点 + 1σ/2σ 区间），以及多样品逆方差加权合并。',
    'en-US':
      'Radiocarbon dating laboratory: Libby conventional ages (5568 yr half-life, BP = 1950), likelihood-profile calibration against the IntCal20 atmospheric curve (χ² minimum + 1σ/2σ ranges with combined measurement + curve uncertainty), and inverse-variance multi-sample combination.',
  },
  license: 'MIT',
  entry: 'example.geo-carbondating',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { radiocarbonAge: 'yr BP', calendarAge: 'cal yr BP', f14c: 'dimensionless' },
    benchmarks: ['libby-age', 'intcal20-anchor', 'interp-monotone'],
    reproducible: true,
    notes:
      'Validation: Libby law t(0.5)=5568 yr (<0.1%); IntCal20 anchor cal BP 3050 <-> 14C age 2897±18 round-trip <0.1%; interpolation monotonicity/grid round-trip. Curve source: IntCal20 excerpt (Reimer et al. 2020, Radiocarbon 62, doi:10.1017/RDC.2020.41, open access), 0-14 cal ka BP sampled every 50 yr from the official grid; relative-error convention |computed-analytic|/|analytic|. Calibration ranges from Δχ²<=1 / <=4 profile thresholds; plateaus may yield several disjoint ranges by design.',
    notesI18n: {
      'zh-CN':
        '验证基准：Libby 公式 t(0.5)=5568 年（相对误差<0.1%）；IntCal20 锚点 cal BP 3050 ↔ 14C 年龄 2897±18 回代<0.1%；插值单调性与网格回代。曲线来源：IntCal20 节选（Reimer et al. 2020, Radiocarbon 62, doi:10.1017/RDC.2020.41，开放获取），0-14 cal ka BP 按官方网格每 50 年取样；统一相对误差口径 |计算−解析|/|解析|。校准区间按 Δχ²≤1 / ≤4 剖面阈值；平台期可出现多段不连续区间。',
      'en-US':
        'Validation: Libby law t(0.5)=5568 yr (<0.1%); IntCal20 anchor cal BP 3050 <-> 14C age 2897±18 round-trip <0.1%; interpolation monotonicity/grid round-trip. Curve source: IntCal20 excerpt (Reimer et al. 2020, Radiocarbon 62, doi:10.1017/RDC.2020.41, open access), 0-14 cal ka BP sampled every 50 yr from the official grid; relative-error convention |computed-analytic|/|analytic|. Ranges from Δχ²<=1 / <=4 profile thresholds; plateaus may yield several disjoint ranges.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'cal BP, 14C age, sigma calibration curve' },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated cal BP / 14C age / sigma' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace or comma curve rows, # comments allowed' },
  ],
};
