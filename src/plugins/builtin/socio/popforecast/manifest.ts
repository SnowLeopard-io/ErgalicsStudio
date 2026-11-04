// ==========================================================================
// socio-popforecast — Leslie matrix population projection, manifest
//
// Deterministic demographic projection: an age-classified female-dominant
// Leslie matrix built from fertility and survival schedules, projected
// forward year by year with optional net migration. Exposes growth rate
// (dominant eigenvalue), age-structure indicators and the UN 65+ aging
// classification under high/medium/low fertility scenarios.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const popForecastManifest: PluginManifest = {
  id: 'example.socio-popforecast',
  name: 'Population Forecasting',
  nameI18n: { 'zh-CN': '人口预测模型', 'en-US': 'Population Forecasting' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Leslie matrix population projection: age-classified fertility and survival schedules assembled into a Leslie matrix and stepped forward year by year with optional net migration and high/medium/low fertility scenarios. Reports total population, dominant-eigenvalue growth rate, dependency ratio, median age and the 65+ aging classification.',
  descriptionI18n: {
    'zh-CN':
      'Leslie 矩阵人口预测：由分年龄组生育率与存活率构成 Leslie 投影矩阵，逐年迭代外推，支持高/中/低生育情景与每年净迁移向量；输出总人口时间序列、主导特征值增长率、抚养比、中位年龄近似与 65 岁以上占比的老龄化判据（联合国标准）。',
    'en-US':
      'Leslie matrix population projection: age-classified fertility and survival schedules assembled into a Leslie matrix and stepped forward year by year with optional net migration and high/medium/low fertility scenarios. Reports total population, dominant-eigenvalue growth rate, dependency ratio, median age and the 65+ aging classification (UN convention).',
  },
  license: 'MIT',
  entry: 'example.socio-popforecast',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:93ae587f53fe1e4427b8a52f74e5eef4',
    sig: '3bdc8aeb8d18ea5ae6ce9ee722d6842db87d2ba8d697dcb6ec8e57fa344664150b977e31e71d1080118b05a566db19e5a895c380fafcd46b1675446c00850b08',
    signer: 'Ergalics Studio (socio pack)',
    signedAt: '2026-10-29T00:00:00.000Z',
    pub: '0e9a8aa057857b1cfb49699cac982814e4e9774450958794e8aaad8c1fcec3ec',
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'Population time series or age distribution with columns: age, population',
    },
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Full projection state: schedules, Leslie matrix, per-year age vectors and indicators',
    },
  ],
  research: {
    tier: 'quasi-research',
    benchmarks: ['leslie-eigen-growth'],
    reproducible: true,
    notes:
      'Kernel validated against (a) the dominant eigenvalue of a fixed 3-class Leslie matrix whose value is known in closed form from its characteristic cubic lambda^3 - 2 lambda - 2.7 = 0 (Cardano), (b) convergence of the projected age composition to the stable age distribution (dominant eigenvector), (c) geometric extinction under zero fertility, (d) the exact cumulative-sum shift of totals under net migration with a survival-only matrix, and (e) seed determinism. Growth rate is computed by power iteration with a fixed iteration count; aging verdicts follow the UN 65+ convention (young < 7%, aging 7-14%, aged > 14%). Sources: P. H. Leslie (1945), "On the use of matrices in certain population mathematics", Biometrika 33:183-213; UN World Population Prospects methodology (cohort-component projection) as the qualitative reference for scenario design.',
    notesI18n: {
      'zh-CN':
        '基准：①固定 3 阶 Leslie 矩阵的主特征值与其特征方程 λ³−2λ−2.7=0 的卡尔丹诺闭式解对照；②投影年龄构成收敛到稳定年龄分布（优势特征向量）；③零生育率下的几何式消亡；④纯存活矩阵下净迁移使总量按累加和精确平移；⑤固定种子完全确定性。增长率由固定迭代次数的幂法计算；老龄化判据按联合国 65+ 标准划分（<7% 年轻型、7–14% 老龄化型、>14% 老年型）。出处：Leslie (1945), "On the use of matrices in certain population mathematics", Biometrika 33:183–213；联合国世界人口展望（队列要素法）作为情景设计的定性参照。',
      'en-US':
        'Benchmarks: (1) dominant eigenvalue of a fixed 3-class Leslie matrix checked against the closed-form Cardano root of its characteristic cubic lambda^3 - 2 lambda - 2.7 = 0; (2) projected age composition converges to the stable age distribution (dominant eigenvector); (3) geometric extinction under zero fertility; (4) net migration shifts totals by the exact cumulative sum under a survival-only matrix; (5) full seed determinism. Growth rate uses power iteration with a fixed iteration count; aging verdicts follow the UN 65+ convention (young < 7%, aging 7-14%, aged > 14%). Sources: P. H. Leslie (1945), "On the use of matrices in certain population mathematics", Biometrika 33:183-213; UN World Population Prospects (cohort-component method) as the qualitative reference for scenario design.',
    },
  },
};
