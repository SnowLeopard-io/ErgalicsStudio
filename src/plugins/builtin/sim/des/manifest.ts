import type { PluginManifest } from '@/types/plugin';

export const simDesManifest: PluginManifest = {
  id: 'example.sim-des',
  name: 'Discrete Event Simulation',
  nameI18n: { 'zh-CN': '离散事件仿真引擎', 'en-US': 'Discrete Event Simulation' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Seeded discrete-event simulation of queueing networks: stations with parallel servers, FIFO/LIFO/priority queues and probabilistic/rework routing, reporting time-averaged queue lengths, utilization, wait/sojourn times, throughput, Little\'s-law checks and Erlang-C comparisons.',
  descriptionI18n: {
    'zh-CN':
      '基于种子的排队网络离散事件仿真：多服务器工站、FIFO/LIFO/优先级排队与概率/返工路由，输出时间加权队列长度、利用率、等待/逗留时间、吞吐率、Little 定律检验与 Erlang-C 理论对比，含流程图、时序曲线、指标表与等待分布四类视图。',
    'en-US':
      'Seeded discrete-event simulation of queueing networks: multi-server stations, FIFO/LIFO/priority queues and probabilistic/rework routing, with time-averaged queue lengths, utilization, wait/sojourn times, throughput, Little\'s-law checks and Erlang-C comparisons across flow-map, time-series, table and histogram views.',
  },
  license: 'MIT',
  entry: 'example.sim-des',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'tu', count: 'entities' },
    reproducible: true,
    benchmarks: ['mm1-half-utilization', 'deterministic-dd1-schedule', 'serial-line-bottleneck'],
    notes:
      'Future-event simulation with a mulberry32 PRNG; time-averaged statistics use exact area-under-curve accumulation over event change-points, so utilization and queue-length means are integration-exact for the sampled trajectory (statistical error only, no discretization bias). Little\'s law is reported as a consistency residual |L − λW|/L of measured quantities, not a fitted quantity. Analytical M/M/1 and M/M/c (Erlang-C) references apply only to exponential arrival/service stations; templates with mixed distributions are simulated, not solved.',
    notesI18n: {
      'zh-CN':
        '基于 mulberry32 随机数的前向事件仿真；时间平均统计通过对事件变更点的精确面积积分得到，利用率与队列均值对采样轨迹无离散化偏差（仅含统计误差）。Little 定律以实测量的相容性残差 |L − λW|/L 报告，而非拟合量。解析 M/M/1 与 M/M/c（Erlang-C）参考仅适用于指数到达/服务的工站；混合分布模板为仿真结果而非解析解。',
      'en-US':
        'Future-event simulation with a mulberry32 PRNG; time-averaged statistics integrate event change-points exactly, so utilization and queue-length means carry no discretization bias for the sampled trajectory (statistical error only). Little\'s law is reported as the consistency residual |L − λW|/L of measured quantities. Analytical M/M/1 and M/M/c (Erlang-C) references apply only to exponential stations; mixed-distribution templates are simulated, not solved.',
    },
  },
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'DES network model JSON (source + stations)' },
  ],
};
