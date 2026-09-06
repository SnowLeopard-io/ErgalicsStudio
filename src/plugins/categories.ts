// ==========================================================================
// Plugin discipline taxonomy (sidebar grouping).
//
// The marketplace `category` (scientific / fun / utility) is too coarse for
// browsing, so the sidebar groups the registry into disciplines — charts,
// statistics, physics, geography, data & AI, and fun & utility. The mapping
// is by plugin id and lives here as the single source of truth; unmapped
// ids fall back to the charts group so third-party plugins always show up.
// ==========================================================================

export type PluginDiscipline = 'charts' | 'stats' | 'physics' | 'geo' | 'data' | 'fun';

export interface DisciplineInfo {
  id: PluginDiscipline;
  nameI18n: Record<string, string>;
}

/** Sidebar group order (display order top → bottom). */
export const PLUGIN_DISCIPLINES: DisciplineInfo[] = [
  { id: 'charts', nameI18n: { 'zh-CN': '图表可视化', 'en-US': 'Charts' } },
  { id: 'stats', nameI18n: { 'zh-CN': '数学统计', 'en-US': 'Statistics' } },
  { id: 'physics', nameI18n: { 'zh-CN': '物理模拟', 'en-US': 'Physics' } },
  { id: 'geo', nameI18n: { 'zh-CN': '地理', 'en-US': 'Geography' } },
  { id: 'data', nameI18n: { 'zh-CN': '数据与智能', 'en-US': 'Data & AI' } },
  { id: 'fun', nameI18n: { 'zh-CN': '趣味工具', 'en-US': 'Fun & Utility' } },
];

/** Discipline per plugin id (built-ins). Unmapped ids default to 'charts'. */
export const DISCIPLINE_BY_PLUGIN: Record<string, PluginDiscipline> = {
  // Charts & visualisation
  'example.scatter': 'charts',
  'example.timeseries': 'charts',
  'example.heatmap': 'charts',
  'example.contour': 'charts',
  'example.bar_chart': 'charts',
  'example.bubble': 'charts',
  'example.polar': 'charts',
  'example.network': 'charts',
  'example.sankey': 'charts',
  'example.treemap': 'charts',
  'example.parallel': 'charts',

  // Statistics & math
  'example.histogram': 'stats',
  'example.boxplot': 'stats',
  'example.violin': 'stats',
  'example.qqplot': 'stats',
  'example.errorband': 'stats',

  // Physics & simulation
  'example.particles': 'physics',
  'example.nbody': 'physics',
  'example.fluid': 'physics',
  'example.wave': 'physics',
  'example.pendulum': 'physics',

  // Geography
  'example.geomap': 'geo',

  // Data & AI
  'example.point-cloud': 'data',
  'example.point-cloud-3d': 'data',
  'example.image': 'data',
  'example.protein': 'data',
  'example.ai-training': 'data',

  // Fun & utility
  'fun.mandelbrot': 'fun',
  'fun.spirograph': 'fun',
  'fun.lissajous': 'fun',
  'fun.life': 'fun',
  'fun.harmonograph': 'fun',
  'fun.palette': 'fun',
  'fun.koch': 'fun',
  'fun.barnsley': 'fun',
  'fun.fireworks': 'fun',
  'fun.truchet': 'fun',
};

/** Discipline for a plugin id (unknown / third-party ids land in 'charts'). */
export function disciplineOf(pluginId: string): PluginDiscipline {
  return DISCIPLINE_BY_PLUGIN[pluginId] ?? 'charts';
}
