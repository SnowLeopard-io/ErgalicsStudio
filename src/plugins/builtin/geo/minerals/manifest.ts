import type { PluginManifest } from '@/types/plugin';

export const mineralsManifest: PluginManifest = {
  id: 'example.geo-minerals',
  name: 'Mineral Identification Lab',
  nameI18n: { 'zh-CN': '矿物鉴定实验室', 'en-US': 'Mineral Identification Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Property-based mineral identification over a built-in 24-mineral reference database (CSV/TSV import swaps in your own collection), Mohs scratch tests, crystal-system classification from unit-cell parameters, hierarchical classification, and Michel-Lévy interference-colour simulation for 30-µm thin sections.',
  descriptionI18n: {
    'zh-CN':
      '基于内置 24 种矿物参考数据库的物性鉴定打分（可导入 CSV/TSV 替换为自己的矿物库）、莫氏硬度刻划测试、由晶胞参数判定晶系、矿物分类路径，以及 30 µm 标准薄片的米歇尔-列维干涉色模拟。',
    'en-US':
      'Property-based mineral identification over a built-in 24-mineral reference database (CSV/TSV import swaps in your own collection), Mohs scratch tests, crystal-system classification from unit-cell parameters, hierarchical classification, and Michel-Lévy interference-colour simulation for 30-µm thin sections.',
  },
  license: 'MIT',
  entry: 'example.geo-minerals',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { hardness: 'Mohs', density: 'g/cm³', birefringence: 'dimensionless', retardation: 'nm' },
    benchmarks: ['cell-cubic', 'cell-hexagonal', 'retardation-calcite', 'identify-quartz', 'database-sanity'],
    reproducible: true,
    notes:
      'The identification key scores each candidate over the supplied properties (hardness 25, cleavage 18, streak 15, specific gravity 16, crystal system 14, luster 12, class 10, colour 8) and normalises by the maximum attainable score; scores are an aid to, not a substitute for, optical microscopy. Retardation follows Γ = Δn·t with t = 30 µm (Γ in nm when Δn is dimensionless and t in µm). The interference-colour table is an approximate Michel-Lévy chart, not a measured spectral curve.',
    notesI18n: {
      'zh-CN':
        '鉴定打分对每个候选矿物按所给物性加权（硬度 25、解理 18、条痕 15、比重 16、晶系 14、光泽 12、矿物大类 10、颜色 8），硬度和比重在容差内按接近程度给部分分，并以理论上限归一化；结果仅供辅助，不能替代偏光显微镜观察。光程差按 Γ = Δn·t，标准薄片 t = 30 µm（Δn 无量纲、t 取 µm 时 Γ 单位为 nm）。干涉色表为近似米歇尔-列维色谱，并非实测光谱。',
      'en-US':
        'The identification key scores each candidate over the supplied properties (hardness 25, cleavage 18, streak 15, specific gravity 16, crystal system 14, luster 12, class 10, colour 8); hardness and specific gravity earn partial credit for closeness inside their tolerance windows, and the total is normalised by the maximum attainable score. Scores are an aid to, not a substitute for, optical microscopy. Retardation follows Γ = Δn·t with t = 30 µm. The interference-colour table is an approximate Michel-Lévy chart, not a measured spectral curve.',
    },
  },
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:56a1624d87866415cb414f66fc617688',
    sig: 'f14d1c701a1297c349feffacc8411e4f15b105ef948f2de66c7281a063437bb0008b082027a04088b91cd5532818993e36c64ab5be757f2adccef59ae5d86004',
    signer: 'Ergalics Studio (geology pack)',
    signedAt: '2026-10-27T00:00:00.000Z',
    pub: '18448430b7a6b103f1cf7269d9a562313e8642fbe0f08e78291e063dc3dd6787',
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'mineral database: name, hardness, sg, crystal_system, cleavage, luster, streak, color, class, formula',
    },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated mineral database' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'comma-separated mineral database with # comments' },
  ],
};
