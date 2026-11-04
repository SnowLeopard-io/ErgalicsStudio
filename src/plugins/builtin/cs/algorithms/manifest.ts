import type { PluginManifest } from '@/types/plugin';

export const algorithmsManifest: PluginManifest = {
  id: 'example.algorithms',
  name: 'Algorithm Visualizer',
  nameI18n: { 'zh-CN': '算法可视化器', 'en-US': 'Algorithm Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Step-by-step animation of sorting, searching and graph traversal algorithms with comparison/swap counters and a side-by-side complexity comparison. Accepts a numeric CSV column as the input array.',
  descriptionI18n: {
    'zh-CN':
      '逐步动画演示排序、查找与图遍历算法，实时统计比较/交换次数，并并排比较不同算法在同一输入上的运算量。可导入单列数值 CSV 作为输入数组。',
    'en-US':
      'Step-by-step animation of sorting, searching and graph traversal algorithms with comparison/swap counters and a side-by-side complexity comparison. Accepts a numeric CSV column as the input array.',
  },
  license: 'MIT',
  entry: 'example.algorithms',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'educational',
    units: { comparisons: 'count', swaps: 'count', arrayIndex: 'index' },
    benchmarks: ['insertion-sorted', 'bubble-comparisons', 'binary-search-steps', 'bfs-order', 'dijkstra-shortest'],
    reproducible: true,
    notes:
      'Every frame is a pure snapshot of the array, the highlighted indices and the cumulative counters, so the same input always yields the same trace. Graph algorithms run on a fixed weighted example graph; the comparison table reports elementary comparisons/relaxations, not wall-clock time.',
    notesI18n: {
      'zh-CN':
        '每一帧都是数组、高亮下标与累计计数器的纯快照，同一输入必定得到同一轨迹。图算法运行在固定的带权示例图上；对比表统计的是基本比较/松弛次数，而非墙钟时间。',
      'en-US':
        'Every frame is a pure snapshot of the array, the highlighted indices and the cumulative counters, so the same input always yields the same trace. Graph algorithms run on a fixed weighted example graph; the comparison table reports elementary comparisons/relaxations, not wall-clock time.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'input array: one number per row (header optional)' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'whitespace/comma separated numbers, # comments allowed' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'e6b4409a9ca4a0aed2ff58a51b24298d396bfc3c19edba67c64789fa60a263c8fa3baeb3e462df27613f648981f54f9c2c601a9878e0112ce7073db697075b03',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
