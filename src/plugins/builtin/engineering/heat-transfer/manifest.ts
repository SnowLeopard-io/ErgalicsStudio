// ==========================================================================
// eng-heat — heat transfer analysis — manifest
//
// Five coupled workbenches: 2-D conduction (FTCS explicit / Peaceman-Rachford
// ADI with Dirichlet / insulated / convective edges, hot-spot source, marching
// -squares isotherms), convection correlations (flat plate, Dittus-Boelter
// tube, Churchill-Chu vertical plate), radiation (Stefan-Boltzmann / Wien /
// Planck spectrum, gray two-surface network with closed-form view factors),
// heat exchangers (LMTD cross-validated against eps-NTU, axial profiles) and
// series/parallel thermal-resistance networks with convection films.
// Validation documented in tests/eng-heat.test.ts.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const engHeatManifest: PluginManifest = {
  id: 'example.eng-heat',
  name: 'Heat Transfer Analysis',
  nameI18n: { 'zh-CN': '传热分析', 'en-US': 'Heat Transfer Analysis' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Heat-transfer toolkit: 2-D FD conduction (explicit FTCS / Peaceman-Rachford ADI, Dirichlet / insulated / convective edges, hot-spot source, marching-squares isotherms, steady-state max/min T with convergence metric), convection correlations (flat plate, Dittus-Boelter tube, Churchill-Chu natural) with regime classification, radiation (Stefan-Boltzmann, Wien, Planck spectrum, gray two-surface view-factor networks), LMTD vs eps-NTU heat exchangers with cross-validation and series/parallel resistance walls.',
  descriptionI18n: {
    'zh-CN':
      '传热分析工具箱：二维有限差分导热（显式 FTCS / Peaceman-Rachford ADI，Dirichlet / 绝热 / 对流边界，热点源，marching squares 等温线，稳态最高/最低温度与收敛指标）、对流换热关联式（平板外掠、Dittus-Boelter 管内、Churchill-Chu 自然对流）并自动判别流态、辐射换热（Stefan-Boltzmann、Wien、普朗克光谱、灰体两表面角系数网络）、LMTD 与 ε-NTU 换热器双法互验，以及串/并联热阻网络复合壁。',
    'en-US':
      'Heat-transfer toolkit: 2-D FD conduction (explicit FTCS / Peaceman-Rachford ADI, Dirichlet / insulated / convective edges, hot-spot source, marching-squares isotherms, steady-state max/min T with convergence metric), convection correlations (flat plate, Dittus-Boelter tube, Churchill-Chu natural) with regime classification, radiation (Stefan-Boltzmann, Wien, Planck spectrum, gray two-surface view-factor networks), LMTD vs eps-NTU heat exchangers with cross-validation and series/parallel resistance walls.',
  },
  license: 'MIT',
  entry: 'example.eng-heat',
  category: 'scientific',
  sandbox: 'trusted',
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:01aa50c0080b0becf17b99809b338c04',
    sig: '8c927f88fd60c93870a76df9de4a41d5fc1a83443f292fc578ce1585f62a47ab18f9cc9d14da42e938b8a0280161e0a4d9e79ad01a6775848128e6d696d69e0a',
    signer: 'Ergalics Studio (engineering suite pack)',
    signedAt: '2026-11-01T00:00:00.000Z',
    pub: '30bb575dc5976b695a64a51200067f2a3ae4939ec038f0eb3e543ccf6e31ad1c',
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'mode-specific parameter rows: u,len,ts,tinf,fluid | t1,t2,eps1,eps2 | thin,tcin,ch,cc,ua | area,dt,layers' },
  ],
  research: {
    tier: 'research',
    units: { length: 'm', time: 's', temperature: 'K', power: 'W', flux: 'W/m2', coefficient: 'W/(m2·K)', resistance: 'K/W', diffusivity: 'm2/s' },
    benchmarks: [
      'eng-heat-1d-steady-flux',
      'eng-heat-lumped-bi-fo',
      'eng-heat-churchill-chu',
      'eng-heat-stefan-wien-planck',
      'eng-heat-view-factors',
      'eng-heat-eps-ntu-lmtd-consistency',
      'eng-heat-resistance-series',
      'eng-heat-marching-squares',
    ],
    reproducible: true,
    notes:
      'Fully deterministic numeric core (no randomness, no I/O); grid capped at 128 x 128. Benchmarks (unified yardstick |computed - reference|/|reference|): 1-D steady conduction recovered by the 2-D solver with insulated faces — linear field and FD flux vs q = k*dT/L (< 0.1 %); lumped transient T/T0 = exp(-Bi*Fo) of the FTCS solver with convective edges at Bi ~ 0.02 (< 3 %, lumped validity O(Bi)); Churchill-Chu vs the simplified Nu = 0.59 Ra^0.25 mid-range spot checks (< 10 %); Stefan-Boltzmann constant 5.670374419e-8 exact, Planck-spectrum trapezoidal integral vs sigma*T^4 (< 0.5 %) and sampled Wien peak (< 0.5 %); coaxial-disk F12 = (3-sqrt(5))/2 at R_i = R_j = 1 (exact) and aligned-square F12 -> 1 as c -> 0; exchanger eps-NTU solved outlets satisfy the LMTD identity UA*LMTD = Q to < 0.1 % for counter/parallel flow, plus the parallel-flow closed-form eps; series-resistance wall vs q = k*A*dT/L (machine precision). Correlations per Incropera, DeWitt, Bergman & Lavine (Tables 8.4, 11.4, 13.1; Churchill & Chu 1975); ADI per Peaceman & Rachford (1955).',
    notesI18n: {
      'zh-CN':
        '完全确定性的数值核（无随机数、无 I/O）；网格上限 128 x 128。基准（统一相对误差口径 |计算−参考|/|参考|）：上下绝热时二维求解器退化为一维稳态导热——温度场线性、FD 热流对 q = k·ΔT/L（< 0.1%）；FTCS 对流边界小 Bi（≈0.02）下瞬态满足集总参数 T/T0 = exp(−Bi·Fo)（< 3%，集总有效性量级为 O(Bi)）；Churchill-Chu 对简化式 Nu = 0.59·Ra^0.25 的中段 Ra 抽检（< 10%）；Stefan-Boltzmann 常数 5.670374419e-8 精确，普朗克谱梯形积分对 σT⁴（< 0.5%）、采样维恩峰值（< 0.5%）；同轴圆盘 R_i = R_j = 1 时 F12 = (3−√5)/2（精确），对齐正方形 c→0 时 F12→1；换热器 ε-NTU 解出的出口温度满足 LMTD 恒等式 UA·ΔT_lm = Q（< 0.1%，逆流/顺流），另验顺流闭式 ε；串联热阻壁对 q = k·A·ΔT/L（机器精度）。关联式出自 Incropera、DeWitt、Bergman & Lavine（表 8.4、11.4、13.1；Churchill & Chu 1975）；ADI 格式出自 Peaceman & Rachford (1955)。',
      'en-US':
        'Fully deterministic numeric core (no randomness, no I/O); grid capped at 128 x 128. Benchmarks (unified yardstick |computed - reference|/|reference|): 1-D steady conduction recovered by the 2-D solver with insulated faces — linear field and FD flux vs q = k*dT/L (< 0.1 %); lumped transient T/T0 = exp(-Bi*Fo) of the FTCS solver with convective edges at Bi ~ 0.02 (< 3 %); Churchill-Chu vs simplified Nu = 0.59 Ra^0.25 mid-range spot checks (< 10 %); Stefan-Boltzmann constant exact, Planck integral vs sigma*T^4 (< 0.5 %) and sampled Wien peak (< 0.5 %); coaxial-disk F12 = (3-sqrt(5))/2 at R_i = R_j = 1 (exact) and aligned-square F12 -> 1 as c -> 0; LMTD identity UA*LMTD = Q at the eps-NTU outlets (< 0.1 %) plus the parallel-flow closed-form eps; series-resistance wall vs q = k*A*dT/L (machine precision). Correlations per Incropera, DeWitt, Bergman & Lavine (Tables 8.4, 11.4, 13.1; Churchill & Chu 1975); ADI per Peaceman & Rachford (1955).',
    },
  },
};
