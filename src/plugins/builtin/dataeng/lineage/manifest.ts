// ==========================================================================
// Data Lineage Visualizer manifest — pure data, split from the plugin file
// so a host registry can import it statically without dragging the plugin
// implementation (and its React dependency graph) into the first-screen
// bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const lineageManifest: PluginManifest = {
  id: 'data.lineage',
  name: 'Data Lineage Visualizer',
  nameI18n: { 'zh-CN': '数据血缘图', 'en-US': 'Data Lineage Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  license: 'MIT',
  entry: 'data.lineage',
  category: 'scientific',
  sandbox: 'trusted',
  description:
    'Data lineage explorer over the project file and run-record DAG: layered graph rendering, upstream/downstream impact analysis (BFS with depths), git commit version annotation for data files, JSON and GraphML export, and structured scientific outputs (node/edge/file/run counts, longest chain depth).',
  descriptionI18n: {
    'zh-CN':
      '面向项目文件与运行记录 DAG 的数据血缘浏览器：分层图渲染、上游溯源/下游影响分析（BFS 带深度）、数据文件的 Git 提交版本标注、JSON 与 GraphML 导出，以及结构化科学输出（节点/边/文件/运行计数、最长链路深度）。',
    'en-US':
      'Data lineage explorer over the project file and run-record DAG: layered graph rendering, upstream/downstream impact analysis (BFS with depths), git commit version annotation for data files, JSON and GraphML export, and structured scientific outputs (node/edge/file/run counts, longest chain depth).',
  },
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes:
      'Kernel is deterministic given the same files/runs/commits; version annotation depends on the git history available at read time.',
  },
};
