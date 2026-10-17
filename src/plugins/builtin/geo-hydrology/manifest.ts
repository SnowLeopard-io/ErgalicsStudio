import type { PluginManifest } from '@/types/plugin';

export const hydrologyManifest: PluginManifest = {
  id: 'example.geo-hydrology',
  name: 'SCS Runoff Event',
  nameI18n: { 'zh-CN': 'SCS 降雨径流模型', 'en-US': 'SCS Runoff Event' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'SCS curve-number rainfall excess (S = 25400/CN - 254, Q = (P-0.2S)^2/(P+0.8S)) convolved with an SCS synthetic unit hydrograph (triangular Tb=2.67Tp or the NOHRSC dimensionless curvilinear table) to produce direct runoff hydrographs with exact mass balance.',
  descriptionI18n: {
    'zh-CN':
      'SCS 曲线数法划分有效降雨（S=25400/CN−254、Q=(P−0.2S)²/(P+0.8S)），再与 SCS 合成单位线（三角形 Tb=2.67Tp 或 NOHRSC 无因次曲表）卷积得到直接径流过程线，体积守恒达到机器精度。',
    'en-US':
      'SCS curve-number rainfall excess (S = 25400/CN - 254, Q = (P-0.2S)^2/(P+0.8S)) convolved with an SCS synthetic unit hydrograph (triangular Tb=2.67Tp or the NOHRSC dimensionless curvilinear table) to produce direct runoff hydrographs with exact mass balance.',
  },
  license: 'MIT',
  entry: 'example.geo-hydrology',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { rainfall: 'mm', area: 'km²', time: 'h', discharge: 'm³/s', volume: 'm³' },
    benchmarks: ['scs-cn-handcalc', 'scs-uh-peak', 'scs-mass-conservation', 'scs-superposition'],
    reproducible: true,
    notes:
      'Validation: closed-form CN check (CN=80, P=50 mm -> S=63.5, Ia=12.7, Q=13.8025 mm, relErr <1e-12); renormalized UH peak vs qp=0.208*A/Tp within 1% at dt=Tp/100 for both shapes; runoff volume vs excess volume relative residual <1e-9 (discrete renormalization k=1000*A/(3600*dt*sum(u))); discrete convolution superposition identity <1e-12. The curvilinear shape is the NOHRSC/NWS dimensionless table with its small (0.2%) tabulated-volume deficit absorbed by renormalization. Relative-error convention |computed-analytic|/|analytic|.',
    notesI18n: {
      'zh-CN':
        '验证基准：CN 闭式解核对（CN=80、P=50 mm → S=63.5、Ia=12.7、Q=13.8025 mm，相对误差<1e-12）；dt=Tp/100 时重归一化单位线峰值与 qp=0.208·A/Tp 偏差<1%（两种线型）；径流体积与有效降雨体积相对残差<1e-9（离散重归一化 k=1000·A/(3600·dt·Σu)）；离散卷积叠加恒等<1e-12。曲表采用 NOHRSC/NWS 无因次表，其约 0.2% 的表格体积亏损由重归一化吸收。统一相对误差口径 |计算−解析|/|解析|。',
      'en-US':
        'Validation: closed-form CN check (CN=80, P=50 mm -> S=63.5, Ia=12.7, Q=13.8025 mm, relErr <1e-12); renormalized UH peak vs qp=0.208*A/Tp within 1% at dt=Tp/100 for both shapes; runoff volume vs excess volume relative residual <1e-9 (discrete renormalization k=1000*A/(3600*dt*sum(u))); discrete convolution superposition identity <1e-12. The curvilinear shape is the NOHRSC/NWS dimensionless table with its small (0.2%) tabulated-volume deficit absorbed by renormalization.',
    },
  },
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'hyetograph: time_h,rain_mm columns (or a single rain_mm column), # comments allowed',
    },
    { extension: '.tsv', mimeTypes: ['text/tab-separated-values'], description: 'tab-separated time / rain columns' },
    {
      extension: '.txt',
      mimeTypes: ['text/plain'],
      description: 'whitespace or comma separated incremental rainfall depths (mm)',
    },
  ],
};
