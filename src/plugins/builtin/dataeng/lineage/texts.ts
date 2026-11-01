// ==========================================================================
// Data Lineage Visualizer — embedded bilingual strings (plugin-local i18n).
// Deliberately NOT wired into the global i18n files: the strings ship with
// the plugin so third-party-style packages stay self-contained.
// ==========================================================================

export interface LineageTexts {
  title: string;
  subtitle: string;
  refresh: string;
  refreshing: string;
  exportJson: string;
  exportGraphml: string;
  empty: string;
  loading: string;
  hint: string;
  selection: string;
  upstream: string;
  downstream: string;
  none: string;
  version: string;
  versionMissing: string;
  files: string;
  runs: string;
  nodes: string;
  edges: string;
  depth: string;
  versioned: string;
  gitModeOn: string;
  gitModeOff: string;
  exportDone: string;
}

/** zh/en string table; `pick` resolves by locale flag. */
export const LINEAGE_TEXTS: Record<keyof LineageTexts, { zh: string; en: string }> = {
  title: { zh: '数据血缘图', en: 'Data Lineage' },
  subtitle: {
    zh: '文件与运行记录的有向无环图；点击节点追溯数据来源与受影响输出',
    en: 'DAG of project files and run records; click a node to trace sources and affected outputs',
  },
  refresh: { zh: '刷新', en: 'Refresh' },
  refreshing: { zh: '刷新中', en: 'Refreshing' },
  exportJson: { zh: '导出 JSON', en: 'Export JSON' },
  exportGraphml: { zh: '导出 GraphML', en: 'Export GraphML' },
  empty: { zh: '当前项目暂无数据文件或运行记录', en: 'No data files or run records in the current project' },
  loading: { zh: '正在构建血缘图…', en: 'Building lineage graph…' },
  hint: { zh: '点击图中节点以分析其上游数据来源与下游受影响输出', en: 'Click a node to analyse its upstream sources and downstream impact' },
  selection: { zh: '当前节点', en: 'Selected node' },
  upstream: { zh: '上游数据来源', en: 'Upstream sources' },
  downstream: { zh: '下游受影响输出', en: 'Affected outputs' },
  none: { zh: '无', en: 'None' },
  version: { zh: '版本', en: 'Version' },
  versionMissing: { zh: '未匹配到 Git 提交', en: 'No matching git commit' },
  files: { zh: '文件', en: 'Files' },
  runs: { zh: '运行', en: 'Runs' },
  nodes: { zh: '节点', en: 'Nodes' },
  edges: { zh: '边', en: 'Edges' },
  depth: { zh: '最长链路深度', en: 'Longest chain' },
  versioned: { zh: '已标注版本文件', en: 'Versioned files' },
  gitModeOn: { zh: 'Git 版本：已启用', en: 'Git versions: on' },
  gitModeOff: { zh: 'Git 版本：不可用（无提交历史）', en: 'Git versions: unavailable (no history)' },
  exportDone: { zh: '血缘图已导出', en: 'Lineage exported' },
};

/** Resolve one embedded string by locale flag. */
export function tx(key: keyof LineageTexts, zh: boolean): string {
  const entry = LINEAGE_TEXTS[key];
  return zh ? entry.zh : entry.en;
}
