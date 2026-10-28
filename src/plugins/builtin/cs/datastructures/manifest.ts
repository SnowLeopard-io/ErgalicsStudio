import type { PluginManifest } from '@/types/plugin';

export const dataStructuresManifest: PluginManifest = {
  id: 'example.datastructures',
  name: 'Data Structure Lab',
  nameI18n: { 'zh-CN': '数据结构实验室', 'en-US': 'Data Structure Lab' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Interactive binary search tree, AVL tree, binary heap and separate-chaining hash table: insert, delete and search with rotation traces, tree layout and per-operation complexity annotations. CSV operation scripts drive the same engine used by Block/Flow.',
  descriptionI18n: {
    'zh-CN':
      '交互式二叉搜索树、AVL 树、二叉堆与链地址哈希表：插入、删除与查找，附旋转轨迹、树形布局和每次操作的时间复杂度标注。CSV 操作脚本驱动与 Block/Flow 相同的引擎。',
    'en-US':
      'Interactive binary search tree, AVL tree, binary heap and separate-chaining hash table: insert, delete and search with rotation traces, tree layout and per-operation complexity annotations. CSV operation scripts drive the same engine used by Block/Flow.',
  },
  license: 'MIT',
  entry: 'example.datastructures',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'educational',
    units: { key: 'value', height: 'levels', probes: 'count' },
    benchmarks: ['bst-inorder', 'avl-height-bound', 'heap-property', 'hash-distribution'],
    reproducible: true,
    notes:
      'Trees store distinct integer keys. AVL rebalancing uses the standard four rotations with height annotations; the height bound checked is h ≤ 1.4405·log2(n+2) − 0.3277 for AVL trees. The hash table uses separate chaining with a fixed bucket count, so its probe counts are illustrative rather than amortised asymptotics.',
    notesI18n: {
      'zh-CN':
        '树存储互不相同的整数键。AVL 平衡使用标准四种旋转并标注高度；校验的高度上界为 AVL 树的 h ≤ 1.4405·log2(n+2) − 0.3277。哈希表采用固定桶数的链地址法，探测次数用于演示，不代表摊还渐近复杂度。',
      'en-US':
        'Trees store distinct integer keys. AVL rebalancing uses the standard four rotations with height annotations; the height bound checked is h ≤ 1.4405·log2(n+2) − 0.3277 for AVL trees. The hash table uses separate chaining with a fixed bucket count, so its probe counts are illustrative rather than amortised asymptotics.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'operations: op, value (op = insert | delete | search)' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'one op per line, # comments allowed' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'e0c03b62b4a7cbce7526bca7aca2a0b77bc64935f0f105bec9ba9a6b93ae2496af1d400fb1464fe0cd2392494193f56f7f4d1f5502a0e713bedbe1e40d4ff203',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
