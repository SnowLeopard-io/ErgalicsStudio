import type { PluginManifest } from '@/types/plugin';

export const simDesManifest: PluginManifest = {
  id: 'example.sim-des',
  name: 'Discrete Event Simulator',
  nameI18n: { 'zh-CN': '离散事件仿真', 'en-US': 'Discrete Event Simulator' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Discrete-event queueing-network simulator: binary-heap event scheduler, FIFO stations with multiple servers and optional finite queue capacity (blocking/loss), probabilistic routing with rework loops, per-station utilization / time-weighted queue length / mean wait / throughput metrics with Little\u2019s-law checks, M/M/1 and M/M/c (Erlang-C) analytic references and bottleneck identification. Templates: bank branch, hospital triage, call center with blocking, production line with rework.',
  descriptionI18n: {
    'zh-CN':
      '离散事件排队网络仿真器：二叉堆事件调度器、多服务器 FIFO 工位与可选有限队列容量（阻塞/丢失）、支持返工环路的概率路由、逐工位利用率/时间加权队列长度/平均等待/吞吐量指标及 Little 定律核验、M/M/1 与 M/M/c（Erlang-C）解析参照和瓶颈识别。模板：银行网点、医院分诊、带阻塞的呼叫中心、带返工的生产线。',
    'en-US':
      'Discrete-event queueing-network simulator: binary-heap event scheduler, FIFO stations with multiple servers and optional finite queue capacity (blocking/loss), probabilistic routing with rework loops, per-station utilization / time-weighted queue length / mean wait / throughput metrics with Little\u2019s-law checks, M/M/1 and M/M/c (Erlang-C) analytic references and bottleneck identification. Templates: bank branch, hospital triage, call center with blocking, production line with rework.',
  },
  license: 'MIT',
  entry: 'example.sim-des',
  category: 'scientific',
  research: {
    tier: 'quasi-research',
    units: { time: 'model time unit' },
    reproducible: true,
    notes:
      'Fixed-seed mulberry32 PRNG; every random draw (inter-arrival and service times) comes from inverse-transform sampling of a single uniform variate, so identical seeds reproduce the event trace bit-for-bit. The event loop is a binary min-heap ordered by (time, insertion sequence). Queue lengths and jobs-in-system are integrated over event intervals (time-weighted means), so Little\u2019s law L = lambda*W holds within sampling error on stable runs. Utilization is busy time / (servers * horizon) and is clamped at 1 only for jobs still in service at the horizon. The M/M/c reference uses the standard Erlang-C delay formula; agreement with simulation is statistical, not exact.',
    notesI18n: {
      'zh-CN':
        '固定种子的 mulberry32 伪随机数；所有随机抽样（到达间隔与服务时间）均由单个均匀变量经逆变换法产生，相同种子可逐位复现事件轨迹。事件循环为按（时间，插入序）排序的二叉最小堆。队列长度与系统内逗留数按事件区间积分（时间加权均值），故稳定运行时 Little 定律 L = λW 在抽样误差内成立。利用率为忙时/(服务器数×时长)，仅为在地平线处仍在服务的作业截断到 1。M/M/c 解析参照采用标准 Erlang-C 延迟公式；与仿真的吻合是统计意义上的。',
      'en-US':
        'Fixed-seed mulberry32 PRNG; every random draw (inter-arrival and service times) comes from inverse-transform sampling of a single uniform variate, so identical seeds reproduce the event trace bit-for-bit. The event loop is a binary min-heap ordered by (time, insertion sequence). Queue lengths and jobs-in-system are integrated over event intervals (time-weighted means), so Little\u2019s law L = lambda*W holds within sampling error on stable runs. Utilization is busy time / (servers * horizon) and is clamped at 1 only for jobs still in service at the horizon. The M/M/c reference uses the standard Erlang-C delay formula; agreement with simulation is statistical, not exact.',
    },
  },
  formats: [{ extension: '.csv', mimeTypes: ['text/csv'], description: 'Station metrics export' }],
};
