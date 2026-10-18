// ==========================================================================
// Plugin discipline taxonomy (sidebar grouping).
//
// The marketplace `category` (scientific / fun / utility) is too coarse for
// browsing, so the sidebar groups the registry into disciplines — charts,
// statistics, physics, chemistry, geography, data & AI, and fun & utility.
// The mapping is by plugin id and lives here as the single source of truth;
// unmapped ids fall back to the charts group so third-party plugins always
// show up.
// ==========================================================================

export type PluginDiscipline =
  | 'charts'
  | 'stats'
  | 'math'
  | 'physics'
  | 'engineering'
  | 'astro'
  | 'fx'
  | 'chem'
  | 'bio'
  | 'geo'
  | 'env'
  | 'materials'
  | 'econ'
  | 'psych'
  | 'data'
  | 'fun';

export interface DisciplineInfo {
  id: PluginDiscipline;
  nameI18n: Record<string, string>;
}

/** Sidebar group order (display order top → bottom): analysis & math first,
 * then the natural sciences as one contiguous block, then applied sciences,
 * data tooling, and finally rendering / fun utilities. */
export const PLUGIN_DISCIPLINES: DisciplineInfo[] = [
  { id: 'charts', nameI18n: { 'zh-CN': '图表可视化', 'en-US': 'Charts' } },
  { id: 'stats', nameI18n: { 'zh-CN': '数学统计', 'en-US': 'Statistics' } },
  { id: 'math', nameI18n: { 'zh-CN': '数学方法', 'en-US': 'Mathematics' } },
  { id: 'physics', nameI18n: { 'zh-CN': '物理模拟', 'en-US': 'Physics' } },
  { id: 'chem', nameI18n: { 'zh-CN': '化学', 'en-US': 'Chemistry' } },
  { id: 'bio', nameI18n: { 'zh-CN': '生物学', 'en-US': 'Biology' } },
  { id: 'geo', nameI18n: { 'zh-CN': '地理', 'en-US': 'Geography' } },
  { id: 'env', nameI18n: { 'zh-CN': '环境', 'en-US': 'Environmental' } },
  { id: 'astro', nameI18n: { 'zh-CN': '天文', 'en-US': 'Astronomy' } },
  { id: 'materials', nameI18n: { 'zh-CN': '材料学', 'en-US': 'Materials' } },
  { id: 'engineering', nameI18n: { 'zh-CN': '工程仿真', 'en-US': 'Engineering' } },
  { id: 'econ', nameI18n: { 'zh-CN': '经济与金融', 'en-US': 'Economics' } },
  { id: 'psych', nameI18n: { 'zh-CN': '心理与行为', 'en-US': 'Psychology' } },
  { id: 'data', nameI18n: { 'zh-CN': '数据与智能', 'en-US': 'Data & AI' } },
  { id: 'fx', nameI18n: { 'zh-CN': '特效渲染', 'en-US': 'Visual FX' } },
  { id: 'fun', nameI18n: { 'zh-CN': '趣味工具', 'en-US': 'Fun & Utility' } },
];

/** Discipline per plugin id (built-ins). Unmapped ids default to 'charts'. */
export const DISCIPLINE_BY_PLUGIN: Record<string, PluginDiscipline> = {
  // Charts & visualisation
  'example.scatter': 'charts',
  'example.timeseries': 'charts',
  'example.heatmap': 'charts',
  'example.contour': 'charts',
  'example.surface-3d': 'charts',
  'example.voxel-3d': 'charts',
  'example.bar_chart': 'charts',
  'example.bubble': 'charts',
  'example.polar': 'charts',
  'example.network': 'charts',
  'example.sankey': 'charts',
  'example.treemap': 'charts',
  'example.parallel': 'charts',
  'example.point-cloud': 'charts',
  'example.point-cloud-3d': 'charts',
  'example.model3d': 'charts',
  'example.image': 'charts',

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
  'example.fluid3d': 'physics',
  'example.wave': 'physics',
  'example.pendulum': 'physics',
  'example.electromag': 'physics',
  'example.optics': 'physics',
  'example.em-eigensolver': 'physics',
  'example.fluid-cfd-coupler': 'physics',
  'example.physics-schrodinger': 'physics',
  'example.physics-ising': 'physics',
  'example.physics-heatengine': 'physics',
  'example.physics-diffusion': 'physics',
  'example.physics-diffraction': 'physics',
  'example.physics-trajectory': 'physics',

  // Astronomy (research CCD pipeline + research-grade kernels)
  'astro.pipeline': 'astro',
  'example.astro-transit': 'astro',
  'example.astro-hrdiagram': 'astro',

  // Visual FX (GPU ray tracing / fluid rendering)
  'fx.blackhole': 'fx',
  'fx.water': 'fx',
  'fx.cloud': 'fx',
  'fx.sky': 'fx',
  'fx.stars': 'fx',
  'fx.ocean': 'fx',
  'fx.misty': 'fx',

  // Chemistry
  'example.chem-crystal': 'chem',
  'example.chem-reaction': 'chem',
  'example.chem-titration': 'chem',
  'example.chem-reaction-order': 'chem',
  'example.chem-turing': 'chem',

  // Geography
  'example.geomap': 'geo',
  'example.geo-solar': 'geo',
  'example.geo-climograph': 'geo',
  'example.geo-pop-pyramid': 'geo',
  'example.geo-interp': 'geo',
  'example.geo-measure': 'geo',
  'example.geo-tissot': 'geo',
  'example.geo-terrain': 'geo',
  'example.geo-gpx': 'geo',
  'example.geo-globe': 'geo',
  'example.geo-carbondating': 'geo',
  'example.geo-soilwater': 'geo',
  'example.geo-hydrology': 'geo',

  // Environmental science
  'example.env-aqi': 'env',
  'example.env-water': 'env',
  'example.env-greenhouse': 'env',
  'example.env-carbon': 'env',
  'example.env-biodiversity': 'env',
  'example.env-plume': 'env',
  'example.env-earth3d': 'env',
  'example.env-predator-prey': 'env',

  // Materials science
  'example.mats-xrd': 'materials',
  'example.mats-mech': 'materials',
  'example.mats-thermal': 'materials',

  // Engineering
  'example.structure': 'engineering',
  'example.eng-circuit': 'engineering',
  'example.eng-truss': 'engineering',
  'example.eng-control': 'engineering',

  // Biology
  'example.protein': 'bio',
  'example.bio-enzyme': 'bio',
  'example.bio-epidemic': 'bio',
  'example.bio-seqalign': 'bio',
  'example.bio-popgen': 'bio',
  'example.bio-pk': 'bio',
  'example.bio-mendel': 'bio',
  'example.bio-neuron': 'bio',

  // Data & AI
  'example.ai-training': 'data',
  'example.data-imageproc': 'data',

  // Mathematics (research-grade kernels)
  'example.math-fourier': 'math',
  'example.math-domaincolor': 'math',
  'example.math-odefield': 'math',

  // Statistics (research-grade kernels)
  'example.stats-clt': 'stats',
  'example.stats-markov': 'stats',
  'example.stats-zipf': 'stats',

  // Economics & psychology (research-grade kernels)
  'example.econ-blackscholes': 'econ',
  'example.econ-evogame': 'econ',
  'example.psych-sdt': 'psych',
  'example.psych-rt': 'psych',

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
