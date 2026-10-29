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
  | 'math'
  | 'physics'
  | 'engineering'
  | 'astro'
  | 'fx'
  | 'chem'
  | 'bio'
  | 'med'
  | 'geo'
  | 'env'
  | 'materials'
  | 'econ'
  | 'psych'
  | 'socio'
  | 'artsci'
  | 'cs'
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
  { id: 'math', nameI18n: { 'zh-CN': '数学与统计', 'en-US': 'Mathematics & Statistics' } },
  { id: 'physics', nameI18n: { 'zh-CN': '物理模拟', 'en-US': 'Physics' } },
  { id: 'chem', nameI18n: { 'zh-CN': '化学', 'en-US': 'Chemistry' } },
  { id: 'bio', nameI18n: { 'zh-CN': '生物学', 'en-US': 'Biology' } },
  { id: 'med', nameI18n: { 'zh-CN': '医学与公共卫生', 'en-US': 'Medicine & Public Health' } },
  { id: 'geo', nameI18n: { 'zh-CN': '地理', 'en-US': 'Geography' } },
  { id: 'env', nameI18n: { 'zh-CN': '环境', 'en-US': 'Environmental' } },
  { id: 'astro', nameI18n: { 'zh-CN': '天文', 'en-US': 'Astronomy' } },
  { id: 'materials', nameI18n: { 'zh-CN': '材料学', 'en-US': 'Materials' } },
  { id: 'engineering', nameI18n: { 'zh-CN': '工程仿真', 'en-US': 'Engineering' } },
  { id: 'econ', nameI18n: { 'zh-CN': '经济与金融', 'en-US': 'Economics' } },
  { id: 'psych', nameI18n: { 'zh-CN': '心理与行为', 'en-US': 'Psychology' } },
  { id: 'socio', nameI18n: { 'zh-CN': '社会科学', 'en-US': 'Social Science' } },
  { id: 'artsci', nameI18n: { 'zh-CN': '音乐与艺术科学', 'en-US': 'Music & Art Science' } },
  { id: 'cs', nameI18n: { 'zh-CN': '计算机科学', 'en-US': 'Computer Science' } },
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
  'example.histogram': 'charts',
  'example.boxplot': 'charts',
  'example.violin': 'charts',
  'example.qqplot': 'charts',
  'example.errorband': 'charts',

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
  'example.geo-seismic': 'geo',
  'example.geo-minerals': 'geo',
  'example.geo-hydrogeology': 'geo',

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
  'example.fem-lab': 'engineering',

  // Biology
  'example.protein': 'bio',
  'example.bio-enzyme': 'bio',
  'example.bio-seqalign': 'bio',
  'example.bio-popgen': 'bio',
  'example.bio-mendel': 'bio',
  'example.bio-neuron': 'bio',

  // Medicine & public health (research-grade kernels)
  'example.bio-epidemic': 'med',
  'example.bio-pk': 'med',
  'example.med-ecg': 'med',
  'example.med-imaging': 'med',
  'example.med-biostat': 'med',
  'example.med-genomics': 'med',

  // Data & AI
  'example.ai-training': 'data',
  'example.data-imageproc': 'data',
  'ai.automl': 'data',
  'ai.nlp': 'data',
  'ai.recsys': 'data',
  'ai.rl': 'data',
  'ai.xai': 'data',
  'ai.vectordb': 'data',

  // Mathematics & statistics (research-grade kernels). The former separate
  // "statistical analysis" group now lives here too.
  'example.math-fourier': 'math',
  'example.math-domaincolor': 'math',
  'example.math-odefield': 'math',
  'example.math-linalg': 'math',
  'example.math-dist': 'math',
  'example.math-numerics': 'math',
  'example.math-graph': 'math',
  'example.math-topology': 'math',
  'example.math-game': 'math',
  'example.stats-clt': 'math',
  'example.stats-markov': 'math',
  'example.stats-zipf': 'math',
  'example.stats-doe': 'math',
  'example.stats-timeseries': 'math',
  'example.stats-multivariate': 'math',
  'example.stats-nonparametric': 'math',
  'example.stats-survival': 'math',
  'example.stats-meta': 'math',
  'example.stats-bayes': 'math',

  // Economics & psychology (research-grade kernels)
  'example.econ-blackscholes': 'econ',
  'example.econ-evogame': 'econ',
  'example.psych-sdt': 'psych',
  'example.psych-rt': 'psych',

  // Social science (research-grade kernels: demography / political science /
  // sociology)
  'example.socio-popforecast': 'socio',
  'example.socio-voting': 'socio',
  'example.socio-sna': 'socio',
  'example.socio-inequality': 'socio',
  'example.socio-opinion': 'socio',

  // Music & art science (interdisciplinary)
  'example.acoustics': 'artsci',
  'example.tuning': 'artsci',
  'example.synth': 'artsci',
  'example.color-science': 'artsci',

  // Computer science & software engineering
  'example.algorithms': 'cs',
  'example.datastructures': 'cs',
  'example.automata': 'cs',
  'example.crypto': 'cs',
  'example.neuralviz': 'cs',
  'example.complexity': 'cs',
  'example.netproto': 'cs',

  // General-purpose simulation engines
  'example.sim-montecarlo': 'math',
  'example.sim-abm': 'physics',
  'example.sim-sd': 'engineering',
  'example.sim-des': 'engineering',

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
