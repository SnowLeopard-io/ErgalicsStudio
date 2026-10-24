// ==========================================================================
// Ergalics Studio — sample block pipelines (block system)
//
// Sample pipelines live as .clproj project files under examples/projects/, so
// the graph is data (not code) and remains importable through the normal
// project loader too. Display names/descriptions are localized here (data in
// examples, presentation in code); adding a new sample only requires dropping
// a `block-<NN>-<slug>.clproj` file plus an entry in SAMPLE_META.
// ==========================================================================

import type { Locale } from '@/i18n';
import { deserializeProject } from '@/types/project';
import type { BlockGraphState } from '@/types/block';

export interface SamplePipeline {
  id: string;
  nameI18n: Record<Locale, string>;
  descriptionI18n: Record<Locale, string>;
  graph: BlockGraphState;
}

const SAMPLE_META: Record<
  string,
  { name: Record<Locale, string>; description: Record<Locale, string> }
> = {
  'signal-analysis': {
    name: { 'zh-CN': '信号分析', 'en-US': 'Signal Analysis' },
    description: {
      'zh-CN': '正弦信号 → 归一化 → 直方图，外加散点图与统计摘要两个分支。',
      'en-US': 'Sine signal → normalize → histogram, plus scatter and summary branches.',
    },
  },
  'random-distribution': {
    name: { 'zh-CN': '随机分布', 'en-US': 'Random Distribution' },
    description: {
      'zh-CN': '500 个均匀随机数 → 直方图 + 统计摘要。',
      'en-US': '500 uniform random numbers → histogram + summary.',
    },
  },
  'grid-scatter': {
    name: { 'zh-CN': '网格散点', 'en-US': 'Grid Scatter' },
    description: {
      'zh-CN': '20×20 均匀网格坐标 → 二维散点图。',
      'en-US': '20×20 uniform grid coordinates → 2D scatter plot.',
    },
  },
  'range-filter': {
    name: { 'zh-CN': '范围过滤', 'en-US': 'Range Filter' },
    description: {
      'zh-CN': '正弦信号 → 按数值区间过滤 → 散点图。',
      'en-US': 'Sine signal → filter by numeric range → scatter plot.',
    },
  },
  'dual-pipeline': {
    name: { 'zh-CN': '双列过滤流水线', 'en-US': 'Dual Pipeline' },
    description: {
      'zh-CN': '正弦信号 → 分两路：归一化→散点图、范围过滤→折线图。',
      'en-US': 'Sine signal → forked: normalize→scatter, range-filter→line chart.',
    },
  },
  'topk-pipeline': {
    name: { 'zh-CN': 'Top-K 排序流水线', 'en-US': 'Top-K Pipeline' },
    description: {
      'zh-CN': '1000 个随机数 → 添加常量列 → Top-20 最大值直方图 + 全量统计摘要。',
      'en-US': '1000 random numbers → add constant column → top-20 largest histogram + summary.',
    },
  },
  'binning-stats': {
    name: { 'zh-CN': '分箱统计流水线', 'en-US': 'Binning Stats' },
    description: {
      'zh-CN': '2000 个随机数 → 50 箱直方图统计 → 折线图 + 散点图双视图。',
      'en-US': '2000 random numbers → 50-bin histogram → line + scatter dual view.',
    },
  },
  'normalize-grid': {
    name: { 'zh-CN': '归一化网格散点', 'en-US': 'Normalized Grid Scatter' },
    description: {
      'zh-CN': '30×30 网格 → x/y 双列归一化 → 2D 点云可视化。',
      'en-US': '30×30 grid → normalize x/y columns → 2D point cloud.',
    },
  },
};

const rawModules = import.meta.glob('../../examples/projects/block-*.clproj', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Derive a stable, human-readable id from the file path. */
function slugOf(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/^block-\d+-/, '').replace(/\.clproj$/, '');
}

function toSample([path, raw]: [string, string]): SamplePipeline | null {
  const id = slugOf(path);
  const meta = SAMPLE_META[id];
  if (!meta) return null;
  try {
    const graph = deserializeProject(raw).state.blockGraph;
    if (!graph) return null;
    return { id, nameI18n: meta.name, descriptionI18n: meta.description, graph };
  } catch {
    return null;
  }
}

export const SAMPLE_PIPELINES: SamplePipeline[] = Object.entries(rawModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(toSample)
  .filter((s): s is SamplePipeline => s !== null);

export function sampleName(sample: SamplePipeline, locale: Locale): string {
  return sample.nameI18n[locale] ?? sample.id;
}

export function sampleDescription(sample: SamplePipeline, locale: Locale): string {
  return sample.descriptionI18n[locale] ?? '';
}
