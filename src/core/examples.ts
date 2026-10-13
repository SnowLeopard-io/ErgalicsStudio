// ==========================================================================
// Built-in sample data (spec §5.1 "示例数据").
// Sample files live in examples/data/ and are bundled at build time via
// Vite `?raw` imports so they load instantly without a network request.
// Binary assets (e.g. images) are embedded as base64 (see exampleAssets.ts).
// ==========================================================================

import type { Locale } from '@/i18n/types';
import type { PluginDiscipline } from '@/plugins/categories';

import crystalXyz from '../../examples/data/crystal.xyz?raw';
import telemetryCsv from '../../examples/data/telemetry.csv?raw';
import datasetJson from '../../examples/data/dataset.json?raw';
import barDataCsv from '../../examples/data/bar-data.csv?raw';
import radarDataCsv from '../../examples/data/radar-data.csv?raw';
import networkEdgesCsv from '../../examples/data/network-edges.csv?raw';
import bubbleDataCsv from '../../examples/data/bubble-data.csv?raw';
import violinDataCsv from '../../examples/data/violin-data.csv?raw';
import sankeyDataCsv from '../../examples/data/sankey-data.csv?raw';
import boxplotDataCsv from '../../examples/data/boxplot-data.csv?raw';
import parallelDataCsv from '../../examples/data/parallel-data.csv?raw';
import errorbandDataCsv from '../../examples/data/errorband-data.csv?raw';
import treemapDataCsv from '../../examples/data/treemap-data.csv?raw';
import qqDataDat from '../../examples/data/qq-data.dat?raw';
import choroplethGeojson from '../../examples/data/choropleth-sample.geojson?raw';
import waveTwinJson from '../../examples/data/wave-twin.json?raw';
import waveSlitJson from '../../examples/data/wave-slit.json?raw';
import pendulumChaosJson from '../../examples/data/pendulum-chaos.json?raw';
import pendulumFlipJson from '../../examples/data/pendulum-flip.json?raw';
import electromagCyclotronJson from '../../examples/data/electromag-cyclotron.json?raw';
import electromagQuadrupoleJson from '../../examples/data/electromag-quadrupole.json?raw';
import opticsConvexJson from '../../examples/data/optics-convex-imaging.json?raw';
import opticsConcaveJson from '../../examples/data/optics-concave-diverging.json?raw';
import opticsPrismJson from '../../examples/data/optics-prism-dispersion.json?raw';
import structureTrussJson from '../../examples/data/structure-truss-bridge.json?raw';
import structureRopeJson from '../../examples/data/structure-rope-bridge.json?raw';
import chemNaclCif from '../../examples/data/chem-nacl.cif?raw';
import chemQuartzCif from '../../examples/data/chem-quartz.cif?raw';
import chemCalciteCif from '../../examples/data/chem-calcite.cif?raw';
import chemFluoriteCif from '../../examples/data/chem-fluorite.cif?raw';
import chemRutileCif from '../../examples/data/chem-rutile.cif?raw';
import chemPyriteCif from '../../examples/data/chem-pyrite.cif?raw';
import reactionCuoH2 from '../../examples/data/reaction-cuo-h2.json?raw';
import reactionCh4O2 from '../../examples/data/reaction-ch4-o2.json?raw';
import reactionCaco3Cao from '../../examples/data/reaction-caco3-cao.json?raw';
import reactionZnHcl from '../../examples/data/reaction-zn-hcl.json?raw';
import reactionHclNaoh from '../../examples/data/reaction-hcl-naoh.json?raw';
import reactionAgno3Nacl from '../../examples/data/reaction-agno3-nacl.json?raw';
import reactionNaclElectrolysis from '../../examples/data/reaction-nacl-electrolysis.json?raw';
import reactionC2h4Br2 from '../../examples/data/reaction-c2h4-br2.json?raw';
import reactionEsterification from '../../examples/data/reaction-esterification.json?raw';
import reactionC2h5ohO2 from '../../examples/data/reaction-c2h5oh-o2.json?raw';
import reactionC2h5ohC2h4 from '../../examples/data/reaction-c2h5oh-c2h4.json?raw';
import reactionCh4Cl2 from '../../examples/data/reaction-ch4-cl2.json?raw';
import reactionC6h6H2 from '../../examples/data/reaction-c6h6-h2.json?raw';
import reactionC7h8Kmno4 from '../../examples/data/reaction-c7h8-kmno4.json?raw';
import matsXrdSilicon from '../../examples/data/mats-xrd-silicon.xy?raw';
import matsXrdNacl from '../../examples/data/mats-xrd-nacl.xy?raw';
import matsXrdCopper from '../../examples/data/mats-xrd-copper.xy?raw';
import matsMechSteel from '../../examples/data/mats-mech-mild-steel.csv?raw';
import matsMechAluminum from '../../examples/data/mats-mech-aluminum.csv?raw';
import matsMechCopper from '../../examples/data/mats-mech-copper.csv?raw';
import matsThermalDsc from '../../examples/data/mats-thermal-dsc-polystyrene.csv?raw';
import matsThermalTga from '../../examples/data/mats-thermal-tga-caco3.csv?raw';

import geoClimateBeijing from '../../examples/data/geo-climate-beijing.csv?raw';
import geoClimateSingapore from '../../examples/data/geo-climate-singapore.csv?raw';
import geoClimateLondon from '../../examples/data/geo-climate-london.csv?raw';
import geoClimateCairo from '../../examples/data/geo-climate-cairo.csv?raw';
import geoPopChina from '../../examples/data/geo-pop-china.csv?raw';
import geoPopJapan from '../../examples/data/geo-pop-japan.csv?raw';
import geoPopNigeria from '../../examples/data/geo-pop-nigeria.csv?raw';
import geoInterpStations from '../../examples/data/geo-interp-stations.csv?raw';
import geoMeasurePoints from '../../examples/data/geo-measure-points.json?raw';
import bioEnzymeMildCsv from '../../examples/data/bio-enzyme-mild.csv?raw';
import bioEpidemicMeaslesJson from '../../examples/data/bio-epidemic-measles.json?raw';
import bioEpidemicInfluenzaCsv from '../../examples/data/bio-epidemic-influenza.csv?raw';
import bioSeqalignHemoglobinFasta from '../../examples/data/bio-seqalign-hemoglobin.fasta?raw';
import bioPopgenHweCsv from '../../examples/data/bio-popgen-hwe.csv?raw';
import bioPopgenExampleVcf from '../../examples/data/bio-popgen-example.vcf?raw';
import envAqiWeekCsv from '../../examples/data/env-aqi-week.csv?raw';
import envWaterRiverCsv from '../../examples/data/env-water-river.csv?raw';
import envBiodiversitySitesCsv from '../../examples/data/env-biodiversity-sites.csv?raw';
import envCarbonPoolsCsv from '../../examples/data/env-carbon-pools.csv?raw';
import chemN2o5Csv from '../../examples/data/chem-n2o5-decomp.csv?raw';
import physProjectileCsv from '../../examples/data/phys-projectile-45deg.csv?raw';
import engLadderNetlistJson from '../../examples/data/eng-ladder-netlist.json?raw';
import engTrussBridgeJson from '../../examples/data/eng-truss-bridge.json?raw';
import mendelF2Csv from '../../examples/data/mendel-f2-seven-traits.csv?raw';
import hudsonBayCsv from '../../examples/data/hudson-bay-lynx-hare.csv?raw';
import geoIntcal20ExcerptCsv from '../../examples/data/intcal20-excerpt.csv?raw';
import geoVgSandRetentionCsv from '../../examples/data/vg-sand-retention.csv?raw';
import geoStormHyetographCsv from '../../examples/data/usgs-storm-hyetograph.csv?raw';
import markovPagerankWebCsv from '../../examples/data/markov-pagerank-web.csv?raw';
import gutenbergEmmaCh1Txt from '../../examples/data/gutenberg-emma-ch1.txt?raw';
import transitLightcurveCsv from '../../examples/data/astro-transit-lightcurve.csv?raw';
import yaleBscBrightCsv from '../../examples/data/yale-bsc-bright.csv?raw';
import { IMAGEPROC_SUBJECT_PNG_BASE64, TEST_PATTERN_PNG_BASE64 } from './exampleAssets';

// AI Training samples (linear / nonlinear / logistic / MNIST) live under
// examples/data/ai/. MNIST alone is ~670 KB, so these are loaded lazily via a
// build-time glob instead of eager `?raw` imports — they stay out of the main
// bundle and only download when a user picks one from the sample dialog.
const aiExampleModules = import.meta.glob('../../examples/data/ai/*.csv', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function aiExampleContent(name: string): Promise<string> {
  const hit = Object.entries(aiExampleModules).find(([key]) => key.endsWith(`/${name}`));
  if (!hit) {
    throw new Error(
      `AI sample "${name}" is not bundled (glob keys: ${Object.keys(aiExampleModules).join(', ') || 'none'})`,
    );
  }
  return hit[1]();
}

// Large sample datasets (geojson/terrain/point clouds/matrices…) are loaded
// lazily via a build-time glob, exactly like the AI samples above, so they
// never enter the first-screen bundle (FR-06). Each file becomes its own lazy
// chunk that only downloads when the user opens that sample; small samples
// keep their eager static `?raw` imports above instead.
const exampleModules = import.meta.glob('../../examples/data/*', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function exampleContent(name: string): Promise<string> {
  const hit = Object.entries(exampleModules).find(([key]) => key.endsWith(`/${name}`));
  if (!hit) {
    throw new Error(
      `Sample "${name}" is not bundled (glob keys: ${Object.keys(exampleModules).join(', ') || 'none'})`,
    );
  }
  return hit[1]();
}

/**
 * Optional grouping key for a built-in sample. 'chem' pins the chemistry
 * suite to the top of the "示例" dialog's dataset tab; otherwise samples
 * inherit their plugin's sidebar discipline.
 */
export type ExampleGroup = 'lab' | 'chem' | PluginDiscipline;

export interface BuiltinExample {
  id: string;
  filename: string;
  format: string;
  mimeType: string;
  pluginId: string;
  /** Optional section this sample belongs to. Omit for general datasets. */
  group?: ExampleGroup;
  /** Text content for raw (text) assets. */
  content?: string;
  /** Base64 content for binary assets. */
  contentBase64?: string;
  /** Lazy content loader for large text samples kept out of the main bundle. */
  loadContent?: () => Promise<string>;
  nameI18n: Record<Locale, string>;
  descriptionI18n: Record<Locale, string>;
}

export const BUILTIN_EXAMPLES: BuiltinExample[] = [
  {
    id: 'em-cavity-degenerate',
    filename: 'em-cavity-degenerate.mtx',
    format: 'mtx',
    mimeType: 'text/plain',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-cavity-degenerate.mtx'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 简并腔体阵列（重特征值）',
      'en-US': 'EM Resonance · Degenerate Cavity Array',
    },
    descriptionI18n: {
      'zh-CN':
        '600 阶厄密腔体矩阵：3 组不同参数的 10×10 谐振腔各重复两次；受 10×10 网格谱内部简并影响，实测特征值重数分布为 2 / 4 / 20（均为偶数重）。加载后点击「运行求解」以稠密直解模式计算，查看谱、残差与收敛轨迹。',
      'en-US':
        'A 600-order Hermitian cavity matrix: three 10×10 cavity blocks repeated twice; measured eigenvalue multiplicities are 2 / 4 / 20 (the 10×10 grid spectrum itself is degenerate). Load it and press Solve for an instant dense-path run with spectrum, residuals and convergence.',
    },
  },
  {
    id: 'em-sample-cavity-small',
    filename: 'em-sample-cavity-small.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-sample-cavity-small.json'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 谐振腔 30×30（小规模冒烟）',
      'en-US': 'EM Resonance · Cavity 30×30 (Smoke Test)',
    },
    descriptionI18n: {
      'zh-CN':
        '900 阶 2D 谐振腔（30×30 五点差分），谱分布在 [0.5, 8.5]。推荐求极值谱（k=6），秒级收敛，适合低内存环境与小规模冒烟测试。加载后点击「运行求解」。',
      'en-US':
        'A 900-unknown 2D cavity (30×30 five-point stencil), spectrum in [0.5, 8.5]. Recommended for extreme eigenvalues (k=6), converging in seconds — the low-memory smoke-test scale. Load it and press Solve.',
    },
  },
  {
    id: 'em-sample-cluster-zero',
    filename: 'em-sample-cluster-zero.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-sample-cluster-zero.json'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 零附近密集谱（近奇异位移）',
      'en-US': 'EM Resonance · Dense Spectrum near Zero',
    },
    descriptionI18n: {
      'zh-CN':
        '720 阶矩阵（6 条窄带 × 120），数百个特征值挤在零的 ±0.2 邻域；位移 σ=0 落在簇内（近奇异位移 + 谱内共振提取），自动路由到 Jacobi-Davidson。加载后点击「运行求解」。',
      'en-US':
        'A 720-order matrix (6 narrow bands of 120) with hundreds of eigenvalues crowding ±0.2 around zero; shift σ=0 sits inside the cluster (near-singular shift + interior extraction), auto-routing to Jacobi-Davidson. Load it and press Solve.',
    },
  },
  {
    id: 'em-sample-degenerate-pair',
    filename: 'em-sample-degenerate-pair.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-sample-degenerate-pair.json'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 重特征值样例',
      'en-US': 'EM Resonance · Degenerate Pair',
    },
    descriptionI18n: {
      'zh-CN':
        '300 阶矩阵（两条完全相同带 + 一条独立带），第一条带的每个特征值恰好二重简并；推荐 σ=−1，验证块 LOBPCG 对重特征值的解算。加载后点击「运行求解」。',
      'en-US':
        'A 300-order matrix (two identical bands plus an independent one) where every eigenvalue of the first band is exactly doubly degenerate; recommended σ=−1 exercises block LOBPCG on repeated eigenvalues. Load it and press Solve.',
    },
  },
  {
    id: 'em-sample-cavity-complex',
    filename: 'em-sample-cavity-complex.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-sample-cavity-complex.json'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 复厄密谐振腔 24×24',
      'en-US': 'EM Resonance · Complex Hermitian Cavity 24×24',
    },
    descriptionI18n: {
      'zh-CN':
        '576 阶复厄密矩阵（带磁偏置相位耦合），谱分布在 ~[1, 9]；推荐 σ=1.2，验证复厄密路径（实部/虚部统一处理）。加载后点击「运行求解」。',
      'en-US':
        'A 576-order complex Hermitian matrix (magnetic-bias-like phase on the coupling), spectrum in ~[1, 9]; recommended σ=1.2 exercises the complex-Hermitian path. Load it and press Solve.',
    },
  },
  {
    id: 'em-sample-cavity-large',
    filename: 'em-sample-cavity-large.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.em-eigensolver',
    loadContent: () => exampleContent('em-sample-cavity-large.json'),
    nameI18n: {
      'zh-CN': '电磁谐振 · 谐振腔 320×320（约十万阶）',
      'en-US': 'EM Resonance · Cavity 320×320 (~1e5)',
    },
    descriptionI18n: {
      'zh-CN':
        '102400 阶 2D 谐振腔（320×320 五点差分），内存受限的大规模能力验证。推荐求极值谱（k=6），约 25 s 收敛；在插件中可调低 basisDim 控制内存。加载后点击「运行求解」。',
      'en-US':
        'A 102400-order 2D cavity (320×320 five-point stencil) for the memory-bound large-scale capability check. Recommended for extreme eigenvalues (k=6), converging in ~25 s; lower basisDim to cap memory. Load it and press Solve.',
    },
  },
  {
    id: 'fluid-cfd-case-a',
    filename: 'fluid-cfd-case-a.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid-cfd-coupler',
    loadContent: () => exampleContent('fluid-cfd-case-a.json'),
    nameI18n: {
      'zh-CN': '1D-3D 耦合 · 定常壅塞流（Case A）',
      'en-US': '1D-3D Coupling · Steady Choked Flow (Case A)',
    },
    descriptionI18n: {
      'zh-CN':
        '一个 60 L 气室经喷管向 3-D 场排气的双向耦合算例：加载后自动运行 Case A，临界流量与解析解误差为 0，并绘制 1-D 出流与 3-D 背压时间序列。',
      'en-US':
        'Bidirectional coupling of a 60 L plenum venting through a nozzle into a 3-D box: loads and runs Case A automatically — choked-flow error vs analytic is 0 — plotting the 1-D outlet flow and 3-D back pressure.',
    },
  },
  {
    id: 'fluid-cfd-case-b',
    filename: 'fluid-cfd-case-b.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid-cfd-coupler',
    loadContent: () => exampleContent('fluid-cfd-case-b.json'),
    nameI18n: {
      'zh-CN': '1D-3D 耦合 · 毫秒级阀门控制（Case B）',
      'en-US': '1D-3D Coupling · ms Valve Control (Case B)',
    },
    descriptionI18n: {
      'zh-CN':
        '阀门在 40 ms 阶跃关闭至 20%、90 ms 重新全开的毫秒级控制算例：加载后自动运行 Case B，节流比约 0.80、控制同步误差为 0，演示控制逻辑与时间网格的对齐。',
      'en-US':
        'Millisecond valve step (to 20 % at 40 ms, reopen at 90 ms): loads and runs Case B automatically — throttle ratio ≈ 0.80, control-sync error 0 — showing how control triggers align to the 1-D grid.',
    },
  },
  {
    id: 'fluid-cfd-case-c',
    filename: 'fluid-cfd-case-c.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid-cfd-coupler',
    loadContent: () => exampleContent('fluid-cfd-case-c.json'),
    nameI18n: {
      'zh-CN': '1D-3D 耦合 · 高扩散能量通道（Case C）',
      'en-US': '1D-3D Coupling · High-Diffusion Energy Channel (Case C)',
    },
    descriptionI18n: {
      'zh-CN':
        'Case A 的场类型/边界变体：提高 3-D 侧扩散系数并加压差，映射航空航天/能源通道类多物理场景。加载后选中 Case C 预设，点击「运行耦合」——反向耦合分支实质性参与，背压抬升 18.15 kPa（Case A 仅约 0.5 Pa），而壅塞流量误差仍为 0，认证断言全部通过。',
      'en-US':
        'A field-type/boundary variant of Case A with higher 3-D diffusivity and a larger pressure difference, mapping energy-channel multi-physics. Load Case C, press Run Coupling: the reverse-coupling branch genuinely engages — an 18.15 kPa back-pressure rise (Case A only ~0.5 Pa) while the choked-flow error stays 0 and every certification assertion passes.',
    },
  },
  {
    id: 'fluid-cfd-case-d',
    filename: 'fluid-cfd-case-d.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid-cfd-coupler',
    loadContent: () => exampleContent('fluid-cfd-case-d.json'),
    nameI18n: {
      'zh-CN': '1D-3D 耦合 · 亚临界非壅塞流（Case D）',
      'en-US': '1D-3D Coupling · Subsonic Non-Choked Flow (Case D)',
    },
    descriptionI18n: {
      'zh-CN':
        '补上壅塞算例之外的非壅塞工况：反向耦合把背压抬到压比 r = 0.5954（落在临界压比 0.5283 与 1 之间），喷嘴工作在亚临界区，出口流量对背压强敏感。加载后选中 Case D 预设并点击「运行耦合」，出口流量与文献等熵关系误差 0.107%，背压敏感度 −1.83（背压升 → 流量降），亚临界区间逐点对照最大误差 0.0%。',
      'en-US':
        'The non-choked counterpart of the choked cases: reverse coupling holds the back pressure at r = 0.5954 (between the critical 0.5283 and 1), so the nozzle runs subsonic where the outlet flow is strongly back-pressure sensitive. Load Case D and press Run Coupling: flow matches the literature isentropic relation to 0.107%, the sensitivity dln m/dln r is −1.83, and the subsonic sweep reproduces the formula to 0.0%.',
    },
  },
  {
    id: 'diamond-sphere',
    filename: 'diamond.xyz',
    format: 'xyz',
    mimeType: 'text/plain',
    pluginId: 'example.point-cloud',
    loadContent: () => exampleContent('diamond.xyz'),
    nameI18n: {
      'zh-CN': '斐波那契球面点云',
      'en-US': 'Fibonacci Sphere Cloud',
    },
    descriptionI18n: {
      'zh-CN': '2000 个均匀分布的球面点，演示点云渲染与参数调节。',
      'en-US': '2000 uniformly distributed sphere points; point-cloud rendering demo.',
    },
  },
  {
    id: 'crystal-lattice',
    filename: 'crystal.xyz',
    format: 'xyz',
    mimeType: 'text/plain',
    pluginId: 'example.point-cloud',
    content: crystalXyz,
    nameI18n: {
      'zh-CN': '简立方晶体点阵',
      'en-US': 'Cubic Crystal Lattice',
    },
    descriptionI18n: {
      'zh-CN': '512 个原子构成的简立方晶格，适合结构观察类示例。',
      'en-US': '512-atom simple-cubic lattice for structure viewing demos.',
    },
  },
  {
    id: 'tornado-vortex',
    filename: 'tornado.xyz',
    format: 'xyz',
    mimeType: 'text/plain',
    pluginId: 'example.point-cloud-3d',
    loadContent: () => exampleContent('tornado.xyz'),
    nameI18n: {
      'zh-CN': '龙卷风螺旋点云',
      'en-US': 'Tornado Helix Cloud',
    },
    descriptionI18n: {
      'zh-CN': '2000 点螺旋漏斗状点云，3D 点云渲染 + 高度着色示例。',
      'en-US': '2000-point helical funnel cloud; 3D point cloud + height coloring demo.',
    },
  },
  {
    id: 'galaxy-particles',
    filename: 'galaxy.dat',
    format: 'dat',
    mimeType: 'application/octet-stream',
    pluginId: 'example.particles',
    loadContent: () => exampleContent('galaxy.dat'),
    nameI18n: {
      'zh-CN': '星系粒子数据',
      'en-US': 'Galaxy Particle Data',
    },
    descriptionI18n: {
      'zh-CN': '6000 个粒子的四列数据（位置 + 速度），驱动粒子模拟。',
      'en-US': '6000-particle 4-column data (position + velocity) for particle simulation.',
    },
  },
  {
    id: 'turbine-telemetry',
    filename: 'telemetry.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.timeseries',
    content: telemetryCsv,
    nameI18n: {
      'zh-CN': '涡轮遥测时间序列',
      'en-US': 'Turbine Telemetry Time Series',
    },
    descriptionI18n: {
      'zh-CN': '240 行遥测（温度 / 压力 / 流量），时间序列绘图示例。',
      'en-US': '240-row telemetry (temp/pressure/flow); time-series plotting demo.',
    },
  },
  {
    id: 'json-dataset',
    filename: 'dataset.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.histogram',
    content: datasetJson,
    nameI18n: {
      'zh-CN': '结构化测量数据集',
      'en-US': 'Structured Measurement JSON',
    },
    descriptionI18n: {
      'zh-CN': '带元数据与质量信息的 JSON 数据集，JSON 解析示例。',
      'en-US': 'JSON dataset with metadata and quality info; JSON parsing demo.',
    },
  },
  {
    id: 'mixture-distribution',
    filename: 'distribution.dat',
    format: 'dat',
    mimeType: 'application/octet-stream',
    pluginId: 'example.histogram',
    loadContent: () => exampleContent('distribution.dat'),
    nameI18n: {
      'zh-CN': '混合分布样本',
      'en-US': 'Mixture Distribution Samples',
    },
    descriptionI18n: {
      'zh-CN': '2400 个双高斯混合样本，直方图分箱与对数刻度示例。',
      'en-US': '2400 two-gaussian mixture samples; histogram binning demo.',
    },
  },
  {
    id: 'scatter-clusters',
    filename: 'scatter-clusters.dat',
    format: 'dat',
    mimeType: 'application/octet-stream',
    pluginId: 'example.scatter',
    loadContent: () => exampleContent('scatter-clusters.dat'),
    nameI18n: {
      'zh-CN': '三簇散点数据',
      'en-US': 'Cluster Scatter Data',
    },
    descriptionI18n: {
      'zh-CN': '960 点三高斯簇（x y 强度），散点图颜色通道示例。',
      'en-US': '960 points in three gaussian clusters (x y intensity); scatter color-channel demo.',
    },
  },
  {
    id: 'vortex-field',
    filename: 'field.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.heatmap',
    loadContent: () => exampleContent('field.json'),
    nameI18n: {
      'zh-CN': '涡旋场（48×48）',
      'en-US': 'Vortex Field (48x48)',
    },
    descriptionI18n: {
      'zh-CN': '48×48 二维数值场，热力图配色与网格线示例。',
      'en-US': '48x48 2-D numeric field; heatmap palette demo.',
    },
  },
  {
    id: 'test-pattern',
    filename: 'test-pattern.png',
    format: 'png',
    mimeType: 'image/png',
    pluginId: 'example.image',
    contentBase64: TEST_PATTERN_PNG_BASE64,
    nameI18n: {
      'zh-CN': '测试图案图像',
      'en-US': 'Test Pattern Image',
    },
    descriptionI18n: {
      'zh-CN': '128×128 测试图案（渐变 + 圆环 + 网格），图像查看示例。',
      'en-US': '128x128 test pattern (gradient + ring + grid); image viewer demo.',
    },
  },
  {
    id: 'imageproc-subject',
    filename: 'imageproc-subject.png',
    format: 'png',
    mimeType: 'image/png',
    pluginId: 'example.data-imageproc',
    contentBase64: IMAGEPROC_SUBJECT_PNG_BASE64,
    nameI18n: {
      'zh-CN': '图像处理测试图（种子 20261011）',
      'en-US': 'Image-Processing Test Subject (seed 20261011)',
    },
    descriptionI18n: {
      'zh-CN': '256×256 固定种子生成图（渐变 + 圆盘 + 条纹 + 高斯噪声），图像处理插件的基准被摄对象。',
      'en-US': '256x256 seeded synthetic subject (gradient + disc + stripes + gaussian noise); reference subject for the image-processing plugin.',
    },
  },
  {
    id: 'nbody-galaxy',
    filename: 'nbody.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.nbody',
    loadContent: () => exampleContent('nbody.json'),
    nameI18n: {
      'zh-CN': '立体环形 N 体初始条件',
      'en-US': 'Torus N-Body Initial Conditions',
    },
    descriptionI18n: {
      'zh-CN': '4096 个天体构成的立体环形（环面），绕中心质量运行，驱动 3D 全配对引力计算。',
      'en-US': '4096 bodies on a 3-D torus ring orbiting a central mass; 3-D all-pairs gravity demo.',
    },
  },
  {
    id: 'ppi-network',
    filename: 'protein.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.protein',
    loadContent: () => exampleContent('protein.json'),
    nameI18n: {
      'zh-CN': '蛋白质交互网络',
      'en-US': 'Protein Interaction Network',
    },
    descriptionI18n: {
      'zh-CN': '560 个蛋白、约 1700 条加权交互的模块化网络，力导向布局计算示例。',
      'en-US': '560 proteins, ~1700 weighted interactions in a modular network; force-directed layout demo.',
    },
  },
  {
    id: 'bio-enzyme-invertase',
    filename: 'bio-enzyme-mild.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bio-enzyme',
    group: 'bio',
    content: bioEnzymeMildCsv,
    nameI18n: {
      'zh-CN': '酶动力学 · 蔗糖酶初速度测定',
      'en-US': 'Enzyme Kinetics · Invertase v0 Assay',
    },
    descriptionI18n: {
      'zh-CN':
        '蔗糖酶（β-呋喃果糖苷酶）在不同底物浓度下的初速度（[E]₀=1.2 n·M，1 min，含近似噪声）。加载后用 Levenberg-Marquardt 拟合 Michaelis-Menten，反解 Vmax 与 Km。',
      'en-US':
        'Invertase initial rates across a substrate dilution series ([E]0 = 1.2 nM, 1 min, approximate noise). Load it and a Levenberg-Marquardt fit recovers Vmax and Km from the Michaelis-Menten curve.',
    },
  },
  {
    id: 'bio-epidemic-measles',
    filename: 'bio-epidemic-measles.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.bio-epidemic',
    group: 'bio',
    content: bioEpidemicMeaslesJson,
    nameI18n: {
      'zh-CN': '传染病模型 · 麻疹 SEIR 暴发参数',
      'en-US': 'Epidemic · Measles SEIR Outbreak',
    },
    descriptionI18n: {
      'zh-CN':
        'R₀=2.8、潜伏期 4 天、传染期 6 天、10 万人的 SEIR 设置（≈麻疹流行学特征）。加载后自动积分曲线上叠加 R_eff，查看峰值、群体免疫阈值与总感染率。',
      'en-US':
        'An SEIR setup (R₀=2.8, 4-day latent, 6-day infectious, 100k population) close to measles epidemiology. It auto-runs with an R_eff overlay to inspect peak timing, herd immunity and attack rate.',
    },
  },
  {
    id: 'bio-epidemic-influenza',
    filename: 'bio-epidemic-influenza.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bio-epidemic',
    group: 'bio',
    content: bioEpidemicInfluenzaCsv,
    nameI18n: {
      'zh-CN': '传染病模型 · 流感逐日新增病例',
      'en-US': 'Epidemic · Influenza Daily New Cases',
    },
    descriptionI18n: {
      'zh-CN':
        '一个温带国家冬季流感样疾病（ILI）逐日新增病例序列（约 5 周）。加载后作为蓝色的观测折线叠加在 SIR/SEIR 模拟曲线上，直观比较模型峰值与真实流行波形。',
      'en-US':
        'A ~5-week daily new-case series of influenza-like illness (ILI) in a temperate country. Loaded it renders as a blue observed-polyline over the SIR/SEIR model curve, comparing the modelled peak with the real epidemic waveform.',
    },
  },
  {
    id: 'bio-seqalign-hemoglobin',
    filename: 'bio-seqalign-hemoglobin.fasta',
    format: 'fasta',
    mimeType: 'text/plain',
    pluginId: 'example.bio-seqalign',
    group: 'bio',
    content: bioSeqalignHemoglobinFasta,
    nameI18n: {
      'zh-CN': '序列比对 · 人血红蛋白 α/β 亚基',
      'en-US': 'Sequence Alignment · Human Hb a/b',
    },
    descriptionI18n: {
      'zh-CN':
        '人血红蛋白 α 与 β 亚基的蛋白质序列（UniProt P69905 / P68871）。用 BLOSUM62 做全局或局部比对，查看同源区、替换与 GC/组成分析；示范真实同源蛋白的比对。',
      'en-US':
        'Human haemoglobin alpha vs beta subunit sequences (UniProt P69905 / P68871). Align with BLOSUM62 globally or locally and run composition / GC analysis — a real homologous-protein demo.',
    },
  },
  {
    id: 'bio-popgen-hwe',
    filename: 'bio-popgen-hwe.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bio-popgen',
    group: 'bio',
    content: bioPopgenHweCsv,
    nameI18n: {
      'zh-CN': '群体遗传 · 哈代-温伯格基因型示例',
      'en-US': 'Population Genetics · HWE Genotype Sample',
    },
    descriptionI18n: {
      'zh-CN':
        '一个双等位基因位点的基因型计数（AA=52，Aa=96，aa=50，n=198，p≈0.505）。加载后自动执行 HWE 卡方检验并绘图；再用「漂变」视图模拟同一群体的遗传漂变。',
      'en-US':
        'Genotype counts at one locus (AA=52, Aa=96, aa=50; n=198, p≈0.505). Loading runs the Hardy-Weinberg chi-square test and plots observed vs expected; switch to the drift view to simulate the same population.',
    },
  },
  {
    id: 'bio-popgen-vcf',
    filename: 'bio-popgen-example.vcf',
    format: 'vcf',
    mimeType: 'text/plain',
    pluginId: 'example.bio-popgen',
    group: 'bio',
    content: bioPopgenExampleVcf,
    nameI18n: {
      'zh-CN': '群体遗传 · VCF 基因型计数',
      'en-US': 'Population Genetics · VCF Genotype Call',
    },
    descriptionI18n: {
      'zh-CN':
        '一段示例 VCF（两个位点的双等位基因 GT 调用）。从 VCF 的 FORMAT/GT 字段统计 0/0、0/1 与 1/1 基因型，获得 AA/Aa/aa 计数后执行哈代-温伯格检验。',
      'en-US':
        'An example VCF (biallelic GT calls at two records). Counts 0/0, 0/1 and 1/1 genotypes from the FORMAT/GT field to obtain AA/Aa/aa counts and then runs the Hardy-Weinberg test.',
    },
  },
  {
    id: 'env-aqi-week',
    filename: 'env-aqi-week.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.env-aqi',
    content: envAqiWeekCsv,
    nameI18n: {
      'zh-CN': '环境 · 某城一周空气质量监测（AQI）',
      'en-US': 'Environmental · One-week Air Quality Records (AQI)',
    },
    descriptionI18n: {
      'zh-CN':
        '7 天六参数监测数据（SO₂/NO₂/PM2.5/PM10/CO/O₃，CO 为 mg/m³，其余 μg/m³）：day3 为 PM2.5 主导的中度污染日，day4 为 O₃ 主导日。加载后自动计算中国标准（HJ 633-2012）AQI，可切换美标（2024 US EPA）对照。',
      'en-US':
        'Seven days of six-pollutant records (SO₂/NO₂/PM2.5/PM10/CO/O₃; CO in mg/m³, rest μg/m³): day3 is a PM2.5-driven polluted day, day4 is O₃-driven. Loading computes CN (HJ 633-2012) AQI; switch to the 2024 US EPA standard for comparison.',
    },
  },
  {
    id: 'env-water-river',
    filename: 'env-water-river.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.env-water',
    content: envWaterRiverCsv,
    nameI18n: {
      'zh-CN': '环境 · 河流四个断面水质监测',
      'en-US': 'Environmental · River Water-quality at Four Sections',
    },
    descriptionI18n: {
      'zh-CN':
        '同一条河流 4 个断面的 pH/溶解氧/高锰酸盐指数/BOD₅/氨氮/总磷：R1 清洁、R2 Ⅲ 类、R3 受排污影响劣化为 Ⅴ 类、R4 湖心对照。加载后按 GB 3838-2002 单因子法逐项定类并计算 WQI，可用雷达图对照 Ⅲ 类限值。',
      'en-US':
        'pH/DO/COD/BOD₅/NH₃-N/TP at four sections of one river: R1 clean, R2 Class Ⅲ, R3 degraded to Class Ⅴ below the outfall, R4 lake-center reference. Loading classifies each indicator per GB 3838-2002 (single-factor), computes WQI, and can radar-plot against Class Ⅲ limits.',
    },
  },
  {
    id: 'env-biodiversity-sites',
    filename: 'env-biodiversity-sites.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.env-biodiversity',
    content: envBiodiversitySitesCsv,
    nameI18n: {
      'zh-CN': '环境 · 三样点底栖动物丰度矩阵',
      'en-US': 'Environmental · Benthos Abundance at Three Sites',
    },
    descriptionI18n: {
      'zh-CN':
        '12 个类群 × 3 样点的计数矩阵：site_1 为清洁林间溪流（种类多且均匀），site_2 农田排水渠，site_3 城镇池塘（摇蚊高度占优）。加载后计算 Shannon H′/Simpson/Pielou 均匀度与优势度，展示典型的多样性梯度。',
      'en-US':
        'A 12-taxa × 3-site count matrix: site_1 a clean forest stream (rich and even), site_2 a farm ditch, site_3 an urban pond dominated by chironomids. Loading computes Shannon H′/Simpson/Pielou evenness and dominance — a textbook diversity gradient.',
    },
  },
  {
    id: 'env-carbon-pools',
    filename: 'env-carbon-pools.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.env-carbon',
    content: envCarbonPoolsCsv,
    nameI18n: {
      'zh-CN': '环境 · 自定义碳库与人为扰动通量',
      'en-US': 'Environmental · Custom Carbon Pools & Forcing Fluxes',
    },
    descriptionI18n: {
      'zh-CN':
        '四库初始库存（大气 590 / 植被 550 / 土壤 2000 / 海洋 38000 GtC）与人为净通量：大气 +9 GtC/yr（化石+工业排放），植被 −1.5 GtC/yr（毁林）。在插件的「自定义 CSV」情景中选择此文件运行，查看扰动下的库演化与守恒残差。',
      'en-US':
        'Four-pool initial stocks (atmosphere 590 / vegetation 550 / soil 2000 / ocean 38000 GtC) with human net fluxes: +9 GtC/yr into the atmosphere (fossil+industry), −1.5 GtC/yr from vegetation (deforestation). Pick it as the plugin\'s custom-CSV scenario to run the perturbed evolution and check conservation residuals.',
    },
  },
  {
    id: 'monthly-revenue-bars',
    filename: 'bar-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bar_chart',
    content: barDataCsv,
    nameI18n: {
      'zh-CN': '月度收支柱状图',
      'en-US': 'Monthly Revenue Bars',
    },
    descriptionI18n: {
      'zh-CN': '12 个月营收/成本/利润，柱状图方向切换与配色示例。',
      'en-US': '12-month revenue/costs/profit; bar chart orientation and palette demo.',
    },
  },
  {
    id: 'product-radar',
    filename: 'radar-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.polar',
    content: radarDataCsv,
    nameI18n: {
      'zh-CN': '产品对比雷达图',
      'en-US': 'Product Comparison Radar',
    },
    descriptionI18n: {
      'zh-CN': '4 款产品的 6 维度对比，多系列雷达图填充与透明度示例。',
      'en-US': '4 products across 6 dimensions; multi-series radar fill demo.',
    },
  },
  {
    id: 'social-network',
    filename: 'network-edges.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.network',
    content: networkEdgesCsv,
    nameI18n: {
      'zh-CN': '社交网络图',
      'en-US': 'Social Network Graph',
    },
    descriptionI18n: {
      'zh-CN': '15 节点 24 条加权连接，力导向布局与节点大小映射示例。',
      'en-US': '15 nodes, 24 weighted edges; force-directed layout with degree-based sizing.',
    },
  },
  {
    id: 'temperature-bubbles',
    filename: 'bubble-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bubble',
    content: bubbleDataCsv,
    nameI18n: {
      'zh-CN': '温度气泡散点',
      'en-US': 'Temperature Bubbles',
    },
    descriptionI18n: {
      'zh-CN': '30 个三维数据点（位置 + 大小 + 颜色），气泡大小与颜色通道示例。',
      'en-US': '30 points (x, y, size, color); bubble sizing and color-channel demo.',
    },
  },
  {
    id: 'grouped-density',
    filename: 'violin-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.violin',
    content: violinDataCsv,
    nameI18n: {
      'zh-CN': '四组密度分布',
      'en-US': 'Four-Group Density',
    },
    descriptionI18n: {
      'zh-CN': '4 组 × 20 个数值的高斯分布，核密度估计与箱线图叠加示例。',
      'en-US': '4 groups × 20 values each; kernel density estimation with box-plot overlay.',
    },
  },
  {
    id: 'energy-flow',
    filename: 'sankey-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.sankey',
    content: sankeyDataCsv,
    nameI18n: {
      'zh-CN': '能源流向桑基图',
      'en-US': 'Energy Flow Sankey',
    },
    descriptionI18n: {
      'zh-CN': '20 条能源流向边，桑基图节点排列与流量比例带宽示例。',
      'en-US': '20 energy-flow edges; Sankey node layout with proportional ribbon sizing.',
    },
  },
  {
    id: 'group-boxplot',
    filename: 'boxplot-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.boxplot',
    content: boxplotDataCsv,
    nameI18n: {
      'zh-CN': '四组箱线分布',
      'en-US': 'Four-Group Box Plot',
    },
    descriptionI18n: {
      'zh-CN': '4 组各 20 个数值，含离群点，箱线图四分位与须线示例。',
      'en-US': '4 groups × 20 values with outliers; box plot quartile/whisker demo.',
    },
  },
  {
    id: 'iris-parallel',
    filename: 'parallel-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.parallel',
    content: parallelDataCsv,
    nameI18n: {
      'zh-CN': '鸢尾花多维数据',
      'en-US': 'Iris Multi-variate',
    },
    descriptionI18n: {
      'zh-CN': '3 类 × 4 特征的多维数据，平行坐标图按类别着色示例。',
      'en-US': '3 classes × 4 features; parallel coordinates with categorical coloring.',
    },
  },
  {
    id: 'sine-errorband',
    filename: 'errorband-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.errorband',
    content: errorbandDataCsv,
    nameI18n: {
      'zh-CN': '带误差的正弦测量',
      'en-US': 'Sine Measurement with Error',
    },
    descriptionI18n: {
      'zh-CN': '21 个带非均匀误差的测量点，误差带图随 x 增宽示例。',
      'en-US': '21 measurements with growing uncertainty; error-band chart demo.',
    },
  },
  {
    id: 'project-treemap',
    filename: 'treemap-data.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.treemap',
    content: treemapDataCsv,
    nameI18n: {
      'zh-CN': '项目目录体积',
      'en-US': 'Project Directory Sizes',
    },
    descriptionI18n: {
      'zh-CN': '源码库层级目录与体积占比，矩形树图层级布局示例。',
      'en-US': 'Hierarchical repository directory sizes; treemap layout demo.',
    },
  },
  {
    id: 'skewed-qq',
    filename: 'qq-data.dat',
    format: 'dat',
    mimeType: 'application/octet-stream',
    pluginId: 'example.qqplot',
    content: qqDataDat,
    nameI18n: {
      'zh-CN': '右偏态样本 QQ 图',
      'en-US': 'Right-Skewed QQ Samples',
    },
    descriptionI18n: {
      'zh-CN': '240 个对数正态样本，QQ 图显示明显的右尾偏离。',
      'en-US': '240 log-normal samples; QQ plot shows clear right-tail deviation.',
    },
  },
  {
    id: 'twin-peaks-contour',
    filename: 'contour-data.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.contour',
    loadContent: () => exampleContent('contour-data.json'),
    nameI18n: {
      'zh-CN': '双峰等高线场',
      'en-US': 'Twin-Peak Contour Field',
    },
    descriptionI18n: {
      'zh-CN': '64×64 双高斯峰 + 波脊场，等高线追踪与配色示例。',
      'en-US': '64x64 field with twin gaussian peaks and a wavy ridge; contour demo.',
    },
  },

  // ---- 3-D visualization (surface / voxel) --------------------------------
  {
    id: 'surface-sine',
    filename: 'surface-ripple.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.surface-3d',
    loadContent: () => exampleContent('surface-ripple.json'),
    nameI18n: {
      'zh-CN': '3D 表面 · 正弦起伏',
      'en-US': '3D Surface · Sine Ripple',
    },
    descriptionI18n: {
      'zh-CN': '64×64 高度网格 z = sin(2πx)·cos(2πy)，加载后呈现经典波纹表面，可切换线框或导出网格 CSV。',
      'en-US': 'A 64x64 height grid z = sin(2πx)·cos(2πy) that renders the classic ripple surface; toggle wireframe or export the mesh CSV.',
    },
  },
  {
    id: 'voxel-sphere',
    filename: 'voxel-sphere.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.voxel-3d',
    loadContent: () => exampleContent('voxel-sphere.json'),
    nameI18n: {
      'zh-CN': '3D 体素 · 高斯球',
      'en-US': '3D Voxel · Gaussian Sphere',
    },
    descriptionI18n: {
      'zh-CN': '24×24×24 高斯径向标量场，等值面显示为球壳，切换半透明体素模式可观察内部采样密度。',
      'en-US': 'A 24x24x24 gaussian radial scalar field; the isosurface reads as a shell and translucent-voxel mode reveals interior sampling density.',
    },
  },

  {
    id: 'fluid-obstacle-plate',
    filename: 'fluid-obstacle.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid',
    loadContent: () => exampleContent('fluid-obstacle.json'),
    nameI18n: {
      'zh-CN': 'LBM 机翼绕流掩膜',
      'en-US': 'LBM Airfoil Mask',
    },
    descriptionI18n: {
      'zh-CN': '384×224 二值障碍掩膜（1 = 固壁）：NACA 2412 翼型、10° 迎角，驱动流体模拟展示翼型绕流与尾涡。',
      'en-US': '384x224 binary obstacle mask (1 = solid): NACA 2412 airfoil at 10 deg angle of attack; airfoil flow + wake vortex demo.',
    },
  },
  {
    id: 'choropleth-regions',
    filename: 'choropleth-sample.geojson',
    format: 'geojson',
    mimeType: 'application/geo+json',
    pluginId: 'example.geomap',
    content: choroplethGeojson,
    nameI18n: {
      'zh-CN': '抽象分区 GeoJSON',
      'en-US': 'Abstract Regions GeoJSON',
    },
    descriptionI18n: {
      'zh-CN': '18 个抽象分区 + 路线 + 站点的合成演示数据（非真实行政边界），含数值属性可用于分级设色。',
      'en-US': 'Synthetic demo geometry: 18 abstract regions, a route and stations (not real boundaries) with numeric properties for choropleth shading.',
    },
  },

  {
    id: 'china-provinces',
    filename: 'china-provinces.geojson',
    format: 'geojson',
    mimeType: 'application/geo+json',
    pluginId: 'example.geomap',
    loadContent: () => exampleContent('china-provinces.geojson'),
    nameI18n: {
      'zh-CN': '中国省级行政区划',
      'en-US': 'China Province Boundaries',
    },
    descriptionI18n: {
      'zh-CN': '34 个省级行政区 + 九段线的标准边界数据（审图号 GS(2024)0650 号 · 数据来源：阿里云 DataV.GeoAtlas），可按 adcode 着色或以轮廓模式查看。',
      'en-US': 'Standard boundaries of 34 province-level regions plus the nine-dash line (source: DataV.GeoAtlas); color by adcode or view as outlines.',
    },
  },
  {
    id: 'geo-climate-beijing',
    filename: 'geo-climate-beijing.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-climograph',
    content: geoClimateBeijing,
    nameI18n: {
      'zh-CN': '气候直方图 · 北京',
      'en-US': 'Climatograph · Beijing',
    },
    descriptionI18n: {
      'zh-CN': '北京 1991-2020 气候标准值（月均温/月降水，数值取自公开记录的近似值）：雨热同期夏雨型，温带季风气候代表。',
      'en-US': 'Beijing 1991-2020 climate normals (monthly mean temp/precip, approximate public record): summer-wet monsoon signature.',
    },
  },
  {
    id: 'geo-climate-singapore',
    filename: 'geo-climate-singapore.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-climograph',
    content: geoClimateSingapore,
    nameI18n: {
      'zh-CN': '气候直方图 · 新加坡',
      'en-US': 'Climatograph · Singapore',
    },
    descriptionI18n: {
      'zh-CN': '新加坡 1991-2020 气候标准值（近似公开记录）：全年高温多雨，热带雨林气候（柯本 Af）代表。',
      'en-US': 'Singapore 1991-2020 climate normals (approximate public record): hot and wet year-round — tropical rainforest (Köppen Af).',
    },
  },
  {
    id: 'geo-climate-london',
    filename: 'geo-climate-london.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-climograph',
    content: geoClimateLondon,
    nameI18n: {
      'zh-CN': '气候直方图 · 伦敦',
      'en-US': 'Climatograph · London',
    },
    descriptionI18n: {
      'zh-CN': '伦敦 1991-2020 气候标准值（近似公开记录）：冬温夏凉、降水全年均匀，温带海洋性气候（Cfb）代表。',
      'en-US': 'London 1991-2020 climate normals (approximate public record): mild winters, even precipitation — oceanic (Köppen Cfb).',
    },
  },
  {
    id: 'geo-climate-cairo',
    filename: 'geo-climate-cairo.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-climograph',
    content: geoClimateCairo,
    nameI18n: {
      'zh-CN': '气候直方图 · 开罗',
      'en-US': 'Climatograph · Cairo',
    },
    descriptionI18n: {
      'zh-CN': '开罗 1991-2020 气候标准值（近似公开记录）：全年干旱少雨，热带沙漠气候（BWh）代表。',
      'en-US': 'Cairo 1991-2020 climate normals (approximate public record): arid all year — hot desert (Köppen BWh).',
    },
  },
  {
    id: 'geo-pop-china',
    filename: 'geo-pop-china.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-pop-pyramid',
    content: geoPopChina,
    nameI18n: {
      'zh-CN': '人口金字塔 · 中国（2020）',
      'en-US': 'Population Pyramid · China (2020)',
    },
    descriptionI18n: {
      'zh-CN': '中国 2020 七普年龄结构（近似公开数据，千人）：底部收窄、中部隆起，向稳定型/缩减型过渡的金字塔。',
      'en-US': 'China 2020 census age structure (approximate public data, thousands): narrowing base and mid-age bulge — stabilising pyramid.',
    },
  },
  {
    id: 'geo-pop-japan',
    filename: 'geo-pop-japan.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-pop-pyramid',
    content: geoPopJapan,
    nameI18n: {
      'zh-CN': '人口金字塔 · 日本（2020）',
      'en-US': 'Population Pyramid · Japan (2020)',
    },
    descriptionI18n: {
      'zh-CN': '日本 2020 总务省年龄结构（近似公开数据，千人）：塔顶宽、塔基窄的典型缩减型（老龄化）金字塔。',
      'en-US': 'Japan 2020 age structure (Statistics Bureau, approximate public data, thousands): wide top, narrow base — classic contractive (ageing) pyramid.',
    },
  },
  {
    id: 'geo-pop-nigeria',
    filename: 'geo-pop-nigeria.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-pop-pyramid',
    content: geoPopNigeria,
    nameI18n: {
      'zh-CN': '人口金字塔 · 尼日利亚（2020）',
      'en-US': 'Population Pyramid · Nigeria (2020)',
    },
    descriptionI18n: {
      'zh-CN': '尼日利亚 2020 联合国 WPP 年龄结构（近似公开数据，千人）：底座极宽的典型增长型（扩张型）金字塔。',
      'en-US': 'Nigeria 2020 age structure (UN WPP, approximate public data, thousands): very broad base — classic expansive pyramid.',
    },
  },
  {
    id: 'geo-interp-stations',
    filename: 'geo-interp-stations.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-interp',
    content: geoInterpStations,
    nameI18n: {
      'zh-CN': '空间插值 · 中国主要城市年降水量',
      'en-US': 'Spatial Interpolation · Annual Precipitation',
    },
    descriptionI18n: {
      'zh-CN': '31 个主要城市的经纬度与年均降水量（近似公开气候标准值）：东南向西北递减，试 IDW 与克里金两种网格化方法。',
      'en-US': '31 major cities with lon/lat and mean annual precipitation (approximate public normals): NW-drying gradient to grid with IDW or kriging.',
    },
  },
  {
    id: 'geo-measure-points',
    filename: 'geo-measure-points.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.geo-measure',
    content: geoMeasurePoints,
    nameI18n: {
      'zh-CN': '量算示例 · 长江沿线航点',
      'en-US': 'Measure Demo · Yangtze Waypoints',
    },
    descriptionI18n: {
      'zh-CN': '长江沿线 6 个城市航点（上海—宜宾）：导入后自动适配视图，查看逐段大圆距离与累计里程。',
      'en-US': 'Six waypoints along the Yangtze (Shanghai–Yibin): auto-fitted view with per-segment great-circle distances.',
    },
  },
  {
    id: 'geo-terrain-demo',
    filename: 'geo-terrain-demo-synthetic.asc',
    format: 'asc',
    mimeType: 'text/plain',
    pluginId: 'example.geo-terrain',
    loadContent: () => exampleContent('geo-terrain-demo-synthetic.asc'),
    nameI18n: {
      'zh-CN': 'DEM 地形 · 合成分形山体',
      'en-US': 'DEM · Synthetic Fractal Terrain',
    },
    descriptionI18n: {
      'zh-CN': '256×256 确定性合成 DEM（SYNTHETIC，多倍频值噪声 + 山脊 + 盆地，30 m 像元，高程约 250-2900 m），演示山体阴影/坡度/坡向/等高线。',
      'en-US': '256×256 deterministic synthetic DEM (SYNTHETIC, fBm value noise + ridge + basin, 30 m cells, ~250-2900 m) for hillshade/slope/aspect/contours.',
    },
  },
  {
    id: 'geo-gpx-fells-loop',
    filename: 'geo-fells-loop.gpx',
    format: 'gpx',
    mimeType: 'application/gpx+xml',
    pluginId: 'example.geo-gpx',
    loadContent: () => exampleContent('geo-fells-loop.gpx'),
    nameI18n: {
      'zh-CN': 'GPX 轨迹 · Fells Loop（样例）',
      'en-US': 'GPX Track · Fells Loop (sample)',
    },
    descriptionI18n: {
      'zh-CN': 'TopoGrafix 官方样例轨迹（Middlesex Fells 环线）：含海拔与时间，查看里程、累计爬升/下降与海拔剖面。',
      'en-US': 'The official TopoGrafix sample track (Middlesex Fells Loop) with elevation and timestamps: distance, ascent/descent and profile.',
    },
  },
  {
    id: 'geo-tissot-world-land',
    filename: 'geo-world-110m-land.json',
    format: 'geojson',
    mimeType: 'application/geo+json',
    pluginId: 'example.geo-tissot',
    loadContent: () => exampleContent('geo-world-110m-land.json'),
    nameI18n: {
      'zh-CN': 'Tissot 投影 · 世界海岸线',
      'en-US': 'Tissot · World Coastlines',
    },
    descriptionI18n: {
      'zh-CN': 'Natural Earth 110m 陆地轮廓（公有领域）：作为投影变形演示的海岸线图层（插件内置同款数据，此条目供自定义复载）。',
      'en-US': 'Natural Earth 110m land polygons (public domain): the coastline layer for the distortion demo (the plugin bundles the same data; this entry allows reloading).',
    },
  },
  {
    id: 'geo-globe-earth',
    filename: 'geo-world-110m-land.json',
    format: 'geojson',
    mimeType: 'application/geo+json',
    pluginId: 'example.geo-globe',
    loadContent: () => exampleContent('geo-world-110m-land.json'),
    nameI18n: {
      'zh-CN': '交互地球仪 · 世界海岸线',
      'en-US': 'Globe · World Coastlines',
    },
    descriptionI18n: {
      'zh-CN': 'Natural Earth 110m 陆地轮廓（公有领域）：加载后贴到三维球面，拖拽旋转、滚轮缩放，并在真实球面上观察 Tissot 变形圆。',
      'en-US': 'Natural Earth 110m land polygons (public domain): draped on the 3D sphere — drag to spin, scroll to zoom, and watch the Tissot circles on the true globe.',
    },
  },
  {
    id: 'wave-pulse',
    filename: 'wave-pulse.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.wave',
    loadContent: () => exampleContent('wave-pulse.json'),
    nameI18n: {
      'zh-CN': '波动 · 高斯脉冲',
      'en-US': 'Wave · Gaussian Pulse',
    },
    descriptionI18n: {
      'zh-CN': '初始位移场（高斯波包），驱动波动方程模拟展示圆形波前的传播与反射。',
      'en-US': 'Initial displacement grid (gaussian blob); drives the wave-equation circular-wavefront demo.',
    },
  },
  {
    id: 'wave-twin-sources',
    filename: 'wave-twin.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.wave',
    content: waveTwinJson,
    nameI18n: {
      'zh-CN': '波动 · 双源干涉',
      'en-US': 'Wave · Twin Sources',
    },
    descriptionI18n: {
      'zh-CN': '两个连续点源的 drive 布局，展示干涉条纹的形成。',
      'en-US': 'Two continuous point sources (drive layout); interference-fringe demo.',
    },
  },
  {
    id: 'wave-double-slit',
    filename: 'wave-slit.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.wave',
    content: waveSlitJson,
    nameI18n: {
      'zh-CN': '波动 · 双缝衍射',
      'en-US': 'Wave · Double Slit',
    },
    descriptionI18n: {
      'zh-CN': '平面波源 + 双缝挡板的 drive 布局，展示衍射图样（drive < 0 挡板，> 0 波源）。',
      'en-US': 'Plane-wave source + double-slit wall (drive layout); diffraction demo (drive < 0 barrier, > 0 source).',
    },
  },
  {
    id: 'pendulum-chaos',
    filename: 'pendulum-chaos.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.pendulum',
    content: pendulumChaosJson,
    nameI18n: {
      'zh-CN': '双摆 · 经典混沌初始条件',
      'en-US': 'Pendulum · Classic Chaos IC',
    },
    descriptionI18n: {
      'zh-CN': 'θ1=120°、θ2=−10° 的初始条件，幽灵摆快速发散，混沌敏感依赖演示。',
      'en-US': 'th1=120, th2=-10 initial conditions; the ghost twin diverges quickly — sensitive-dependence demo.',
    },
  },
  {
    id: 'pendulum-flip',
    filename: 'pendulum-flip.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.pendulum',
    content: pendulumFlipJson,
    nameI18n: {
      'zh-CN': '双摆 · 翻越初始条件',
      'en-US': 'Pendulum · Flip IC',
    },
    descriptionI18n: {
      'zh-CN': 'θ1=θ2=170° 的高势能初始条件，外摆臂能翻越顶点，轨迹高度混沌。',
      'en-US': 'th1=th2=170 high-potential initial conditions; the outer arm flips over the top, wildly chaotic.',
    },
  },

  // ---- Interactive physics / optics labs --------------------------------
  {
    id: 'electromag-cyclotron',
    filename: 'electromag-cyclotron.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.electromag',
    content: electromagCyclotronJson,
    nameI18n: {
      'zh-CN': '电磁场 · 磁场中的回旋运动',
      'en-US': 'EM · Cyclotron in a B Field',
    },
    descriptionI18n: {
      'zh-CN':
        '均匀磁场 B=1.8 中三个同号电荷同时射入：洛伦兹力把它们偏成圆弧，而彼此的库仑斥力让轨迹明显相互推开——一张图同时看到两种力的作用。',
      'en-US':
        'Three like charges enter a uniform B = 1.8 field together: the Lorentz force bends them into arcs while Coulomb repulsion visibly drives their paths apart — both forces in one view.',
    },
  },
  {
    id: 'electromag-quadrupole',
    filename: 'electromag-quadrupole.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.electromag',
    content: electromagQuadrupoleJson,
    nameI18n: {
      'zh-CN': '电磁场 · 四极静电场',
      'en-US': 'EM · Quadrupole Field',
    },
    descriptionI18n: {
      'zh-CN': '两个正电荷与两个负电荷构成的四极场（无磁场），松手后观察库仑力下的振荡与逃逸，可用于演示离子阱原理。',
      'en-US': 'Two positive and two negative charges form a quadrupole (no B field); release them to watch Coulomb oscillation and escape.',
    },
  },
  {
    id: 'optics-convex-imaging',
    filename: 'optics-convex-imaging.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.optics',
    content: opticsConvexJson,
    nameI18n: {
      'zh-CN': '光学 · 凸透镜成像',
      'en-US': 'Optics · Convex Lens Imaging',
    },
    descriptionI18n: {
      'zh-CN': '点光源在凸透镜前 2f 位置（f=120px），光线经薄透镜汇聚，光屏恰好落在成像面上，可直接拖动透镜/光屏观察像距变化。',
      'en-US': 'A point source sits 2f in front of a convex lens (f = 120 px); rays converge and the screen sits exactly on the image plane. Drag the lens or screen to change it.',
    },
  },
  {
    id: 'optics-prism-dispersion',
    filename: 'optics-prism-dispersion.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.optics',
    content: opticsPrismJson,
    nameI18n: {
      'zh-CN': '光学 · 三棱镜色散',
      'en-US': 'Optics · Prism Dispersion',
    },
    descriptionI18n: {
      'zh-CN': '白光射入等边三棱镜，前后两个面按斯涅尔定律折射，折射率随波长变化，光屏上散开成彩色光谱。',
      'en-US': 'White light enters an equilateral prism and refracts twice via Snell\'s law with a wavelength-dependent index, fanning into a spectrum on the screen.',
    },
  },
  {
    id: 'optics-concave-diverging',
    filename: 'optics-concave-diverging.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.optics',
    content: opticsConcaveJson,
    nameI18n: {
      'zh-CN': '光学 · 凹透镜发散',
      'en-US': 'Optics · Concave Lens Diverging',
    },
    descriptionI18n: {
      'zh-CN': '凹透镜（f<0）使平行/发散光束更加发散，虚焦点位于透镜前方，可与凸透镜成像对比。',
      'en-US': 'A concave lens (f < 0) spreads the beam further; the virtual focus lies in front of the lens — compare with the convex case.',
    },
  },
  {
    id: 'structure-truss-bridge',
    filename: 'structure-truss-bridge.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.structure',
    content: structureTrussJson,
    nameI18n: {
      'zh-CN': '结构 · 钢桁架桥承重',
      'en-US': 'Structure · Steel Truss Bridge',
    },
    descriptionI18n: {
      'zh-CN': '13 根钢杆件组成的下承式桁架桥，两个重物从空中落下加载。点击「运行」开始，杆件颜色随轴力由材料色变红，超限即断裂并发生垮塌；可调重力与负载质量加重加载。',
      'en-US': 'A 13-member steel truss bridge with two weights dropped on it. Press Run; members turn red as their axial force approaches the limit, overload snaps them and the bridge collapses. Raise gravity or the load mass to push it further.',
    },
  },
  {
    id: 'structure-rope-bridge',
    filename: 'structure-rope-bridge.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.structure',
    content: structureRopeJson,
    nameI18n: {
      'zh-CN': '结构 · 缆索吊桥（只受拉）',
      'en-US': 'Structure · Rope Bridge (tension-only)',
    },
    descriptionI18n: {
      'zh-CN': '缆索只能承受拉力（受压时以松弛虚线显示），重物从上方落下后悬链下垂。点击「运行」开始，可调重力与负载质量观察下垂与断裂。',
      'en-US': 'Rope cannot push — slack members are drawn dashed. A weight drops onto the deck and the catenary sags. Press Run; raise gravity or the load mass to watch it sag and snap.',
    },
  },

  {
    id: 'chem-nacl',
    filename: 'chem-nacl.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemNaclCif,
    nameI18n: {
      'zh-CN': '化学 · 氯化钠晶胞（NaCl）',
      'en-US': 'Chemistry · Halite unit cell (NaCl)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 收录的真实岩盐结构（Fm-3m，a≈5.62 Å）：Cl⁻ 立方面心堆积、Na⁺ 占据全部八面体空隙，对称展开出 4 Na + 4 Cl，配位数 6:6，可切换球棍 / 空间填充并查看 3D 结构。',
      'en-US':
        'Real halite from COD (Fm-3m, a≈5.62 Å): ccp Cl⁻ with Na⁺ in all octahedral holes; symmetry-expanded to 4 Na + 4 Cl with 6:6 coordination; switch ball-stick / space-filling.',
    },
  },
  {
    id: 'chem-quartz',
    filename: 'chem-quartz.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemQuartzCif,
    nameI18n: {
      'zh-CN': '化学 · α-石英晶胞（SiO₂）',
      'en-US': 'Chemistry · α-Quartz unit cell (SiO₂)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 开放晶体数据库收录的真实 α-石英结构（三方 P3₂21，a≈4.91 Å、γ=120°）：按对称操作自动展开出完整晶胞 3 Si + 6 O，统计化学式 SiO₂ 与理论密度约 2.65 g/cm³。',
      'en-US':
        'Real α-quartz from the Crystallography Open Database (trigonal P3₂21, a≈4.91 Å, γ=120°); symmetry-expanded to 3 Si + 6 O with the SiO₂ ratio and ~2.65 g/cm³ density.',
    },
  },
  {
    id: 'chem-calcite',
    filename: 'chem-calcite.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemCalciteCif,
    nameI18n: {
      'zh-CN': '化学 · 方解石晶胞（CaCO₃）',
      'en-US': 'Chemistry · Calcite unit cell (CaCO₃)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 收录的真实方解石结构（R-3c 菱方原始晶胞，a≈6.36 Å、α≈46°）：经典菱面体晶胞，展开出 2 Ca + 2 C + 6 O，配位数为平面三角形碳酸根与 6 配位钙。',
      'en-US':
        'Real calcite from COD (R-3c rhombohedral primitive cell, a≈6.36 Å, α≈46°): the classic cleavage rhombohedron, expanded to 2 Ca + 2 C + 6 O with trigonal carbonate groups.',
    },
  },
  {
    id: 'chem-fluorite',
    filename: 'chem-fluorite.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemFluoriteCif,
    nameI18n: {
      'zh-CN': '化学 · 萤石晶胞（CaF₂）',
      'en-US': 'Chemistry · Fluorite unit cell (CaF₂)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 收录的真实萤石结构（Fm-3m，a≈5.46 Å）：Ca²⁺ 立方面心堆积、F⁻ 占据全部四面体空隙，192 个对称操作展开出 4 Ca + 8 F，配位数 8:4。',
      'en-US':
        'Real fluorite from COD (Fm-3m, a≈5.46 Å): ccp Ca²⁺ with F⁻ in all tetrahedral holes; 192 symmetry ops expand to 4 Ca + 8 F, 8:4 coordination.',
    },
  },
  {
    id: 'chem-rutile',
    filename: 'chem-rutile.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemRutileCif,
    nameI18n: {
      'zh-CN': '化学 · 金红石晶胞（TiO₂）',
      'en-US': 'Chemistry · Rutile unit cell (TiO₂)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 收录的真实金红石结构（四方 P4₂/mnm，a≈4.61 Å、c≈2.97 Å）：Ti 配位 6、O 配位 3 的典型 AB₂ 型结构，展开出 2 Ti + 4 O。',
      'en-US':
        'Real rutile from COD (tetragonal P4₂/mnm, a≈4.61 Å, c≈2.97 Å): the prototype AB₂ structure with 6-coordinated Ti and 3-coordinated O, expanded to 2 Ti + 4 O.',
    },
  },
  {
    id: 'chem-pyrite',
    filename: 'chem-pyrite.cif',
    format: 'cif',
    mimeType: 'text/plain',
    pluginId: 'example.chem-crystal',
    group: 'chem',
    content: chemPyriteCif,
    nameI18n: {
      'zh-CN': '化学 · 黄铁矿晶胞（FeS₂）',
      'en-US': 'Chemistry · Pyrite unit cell (FeS₂)',
    },
    descriptionI18n: {
      'zh-CN':
        'COD 收录的真实黄铁矿结构（Pa-3，a≈5.42 Å）：Fe 六配位、S 以二硫阴离子 S₂²⁻ 成对出现，展开出 4 Fe + 8 S。',
      'en-US':
        'Real pyrite from COD (Pa-3, a≈5.42 Å): octahedral Fe with paired S₂²⁻ disulfide anions, expanded to 4 Fe + 8 S.',
    },
  },

  // ---- Materials science · XRD pattern analysis (mats-xrd) -------------------
  {
    id: 'mats-xrd-silicon',
    filename: 'mats-xrd-silicon.xy',
    format: 'xy',
    mimeType: 'text/plain',
    pluginId: 'example.mats-xrd',
    group: 'materials',
    content: matsXrdSilicon,
    nameI18n: {
      'zh-CN': '材料 · 硅粉末衍射谱（NIST SRM 640）',
      'en-US': 'Materials · Silicon powder pattern (NIST SRM 640)',
    },
    descriptionI18n: {
      'zh-CN':
        '硅标样粉末衍射谱（Cu Kα1，Fd-3m，a≈5.431 Å）：六条主要衍射峰（111/220/311/400/331/422），用于突出度峰检出、d 间距换算与立方晶格常数精修验证。载入后插件自动检出 6 个峰并精修 a。',
      'en-US':
        'Silicon standard powder pattern (Cu Kα1, Fd-3m, a≈5.431 Å): six major reflections (111/220/311/400/331/422) for prominence-based peak detection, Bragg d-spacing and cubic lattice refinement. Load it — the plugin auto-detects 6 peaks and refines a.',
    },
  },
  {
    id: 'mats-xrd-nacl',
    filename: 'mats-xrd-nacl.xy',
    format: 'xy',
    mimeType: 'text/plain',
    pluginId: 'example.mats-xrd',
    group: 'materials',
    content: matsXrdNacl,
    nameI18n: {
      'zh-CN': '材料 · 氯化钠粉末衍射谱（ICDD 05-0628）',
      'en-US': 'Materials · Halite powder pattern (ICDD 05-0628)',
    },
    descriptionI18n: {
      'zh-CN':
        '岩盐 NaCl 粉末衍射谱（Fm-3m，a≈5.640 Å）：八条衍射峰（111/200/220/311/222/400/420/422），面心立方消光规律下首峰对应 s=3。载入后可验证 F-心立方精修并与参考物相匹配。',
      'en-US':
        'Halite NaCl powder pattern (Fm-3m, a≈5.640 Å): eight reflections (111/200/220/311/222/400/420/422); under F-centring absences the first peak maps to s=3. Load it to exercise F-centred refinement and phase matching.',
    },
  },
  {
    id: 'mats-xrd-copper',
    filename: 'mats-xrd-copper.xy',
    format: 'xy',
    mimeType: 'text/plain',
    pluginId: 'example.mats-xrd',
    group: 'materials',
    content: matsXrdCopper,
    nameI18n: {
      'zh-CN': '材料 · 铜粉末衍射谱（ICDD 04-0836）',
      'en-US': 'Materials · Copper powder pattern (ICDD 04-0836)',
    },
    descriptionI18n: {
      'zh-CN':
        '纯铜粉末衍射谱（Fm-3m，a≈3.615 Å）：四条衍射峰（111/200/220/311），高角度 2θ 范围内峰位稀疏，适合验证小晶胞参数精修与 2θ-峰匹配。',
      'en-US':
        'Pure copper powder pattern (Fm-3m, a≈3.615 Å): four reflections (111/200/220/311) at high 2θ, exercising small-cell refinement and 2θ peak matching.',
    },
  },
  // ---- Materials science · stress-strain analysis (mats-mech) ---------------
  {
    id: 'mats-mech-mild-steel',
    filename: 'mats-mech-mild-steel.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.mats-mech',
    group: 'materials',
    content: matsMechSteel,
    nameI18n: {
      'zh-CN': '材料 · 低碳钢应力-应变曲线（ASTM A36）',
      'en-US': 'Materials · Mild steel stress-strain (ASTM A36)',
    },
    descriptionI18n: {
      'zh-CN':
        '低碳钢拉伸曲线（E≈210 GPa、σ₀.₂≈280 MPa、UTS≈430 MPa、断后伸长率≈28%、n≈0.18）：弹性段回归、0.2% 偏置屈服、Hollomon 应变硬化拟合与韧性积分一键输出。载入后插件自动计算全部力学指标。',
      'en-US':
        'Mild-steel tensile curve (E≈210 GPa, σ₀.₂≈280 MPa, UTS≈430 MPa, ε_f≈28%, n≈0.18): elastic-region regression, 0.2% offset yield, Hollomon hardening fit and toughness integration all auto-computed. Load it for the full tensile index set.',
    },
  },
  {
    id: 'mats-mech-aluminum',
    filename: 'mats-mech-aluminum.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.mats-mech',
    group: 'materials',
    content: matsMechAluminum,
    nameI18n: {
      'zh-CN': '材料 · 铝合金 6061-O 应力-应变曲线',
      'en-US': 'Materials · Aluminum 6061-O stress-strain',
    },
    descriptionI18n: {
      'zh-CN':
        '退火铝合金 6061-O 拉伸曲线（E≈70 GPa、σ₀.₂≈95 MPa、UTS≈180 MPa、n≈0.22）：低模量高延展金属典型曲线，可对比低碳钢的硬化行为差异。',
      'en-US':
        'Annealed Al 6061-O tensile curve (E≈70 GPa, σ₀.₂≈95 MPa, UTS≈180 MPa, n≈0.22): a low-modulus, high-ductility metal — compare its hardening against mild steel.',
    },
  },
  {
    id: 'mats-mech-copper',
    filename: 'mats-mech-copper.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.mats-mech',
    group: 'materials',
    content: matsMechCopper,
    nameI18n: {
      'zh-CN': '材料 · 退火铜应力-应变曲线',
      'en-US': 'Materials · Annealed copper stress-strain',
    },
    descriptionI18n: {
      'zh-CN':
        '退火纯铜拉伸曲线（E≈110 GPa、σ₀.₂≈70 MPa、UTS≈220 MPa、断后伸长率≈45%、n≈0.40）：高应变硬化指数的典型高延展金属，Hollomon 双对数线性段清晰。',
      'en-US':
        'Annealed copper tensile curve (E≈110 GPa, σ₀.₂≈70 MPa, UTS≈220 MPa, ε_f≈45%, n≈0.40): a high-ductility metal with a high strain-hardening exponent and a clear Hollomon log-log linear region.',
    },
  },
  // ---- Materials science · thermal analysis (mats-thermal) -----------------
  {
    id: 'mats-thermal-dsc-polystyrene',
    filename: 'mats-thermal-dsc-polystyrene.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.mats-thermal',
    group: 'materials',
    content: matsThermalDsc,
    nameI18n: {
      'zh-CN': '材料 · 聚苯乙烯 DSC 曲线（玻璃化转变 + 熔融）',
      'en-US': 'Materials · Polystyrene DSC (Tg + melting)',
    },
    descriptionI18n: {
      'zh-CN':
        '聚苯乙烯 DSC 升温曲线：约 100°C 玻璃化转变（热流阶跃下降）与约 250°C 熔融吸热峰。载入后插件自动检出转变、给出外推起始温度、峰值温度与基线校正积分。',
      'en-US':
        'Polystyrene DSC heating curve: a glass transition (heat-flow step) near 100°C and a melting endotherm near 250°C. Load it to auto-detect transitions with extrapolated onset, peak temperature and baseline-corrected integral.',
    },
  },
  {
    id: 'mats-thermal-tga-caco3',
    filename: 'mats-thermal-tga-caco3.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.mats-thermal',
    group: 'materials',
    content: matsThermalTga,
    nameI18n: {
      'zh-CN': '材料 · 碳酸钙 TGA 曲线（热分解失重）',
      'en-US': 'Materials · Calcium carbonate TGA (decomposition)',
    },
    descriptionI18n: {
      'zh-CN':
        '碳酸钙 CaCO₃ 热重曲线：约 85°C 水分脱附（≈2%）与约 710°C 脱碳分解 CaCO₃→CaO+CO₂（理论失重 44%）。载入后切换到 TGA 模式，插件自动分解失重台阶、输出起始温度、DTG 峰值与残重。',
      'en-US':
        'Calcium carbonate TGA curve: moisture desorption near 85°C (≈2%) and decarbonation CaCO₃→CaO+CO₂ near 710°C (theoretical 44% loss). Switch to TGA mode — the plugin steps off mass-loss segments with onset, DTG peak and residual mass.',
    },
  },

  // ---- Reaction mechanism 3D examples (chem-reaction) -------------------
  {
    id: 'chem-rxn-cuo-h2',
    filename: 'reaction-cuo-h2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionCuoH2,
    nameI18n: {
      'zh-CN': '化学 · 氢气还原氧化铜（动力学）',
      'en-US': 'Chemistry · H₂ + CuO redox dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '打开自由反应动力学 3D：CuO + H₂ → Cu + H₂O。设置温度与是否加催化剂，按「运行」后内置分子动力学引擎让 Cu–O 越过势垒断开、H–H 断裂并重组为 H₂O，原子随机热运动真实演化。',
      'en-US':
        'Opens the free-reaction-MD 3D lab for CuO + H₂ → Cu + H₂O. Set temperature and catalyst, press Run: the embedded engine fractures Cu–O past the barrier, severs H–H and recombines H₂O from genuine thermal motion.',
    },
  },
  {
    id: 'chem-rxn-ch4-o2',
    filename: 'reaction-ch4-o2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionCh4O2,
    nameI18n: {
      'zh-CN': '化学 · 甲烷燃烧（动力学）',
      'en-US': 'Chemistry · CH₄ combustion dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '甲烷完全燃烧：CH₄ + 2O₂ → CO₂ + 2H₂O。高温下 C–H、O=O 键随机断裂，碎片重组；反应完成后自动松弛，产物舒展为直线 CO₂ 与折角 H₂O。',
      'en-US':
        'Methane combustion: CH₄ + 2O₂ → CO₂ + 2H₂O. C–H and O=O bonds fracture at random at high temperature and fragments recombine; a final relaxation unfolds the products into linear CO₂ and bent H₂O.',
    },
  },
  {
    id: 'chem-rxn-caco3-cao',
    filename: 'reaction-caco3-cao.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionCaco3Cao,
    nameI18n: {
      'zh-CN': '化学 · 碳酸钙高温分解（动力学）',
      'en-US': 'Chemistry · CaCO₃ decomposition dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '碳酸钙高温分解：CaCO₃ → CaO + CO₂。Ca–O 与碳酸根的 C–O 键在高温下断裂，CO₂ 释放并松弛为直线构型，CaO 留在原处。',
      'en-US':
        'Calcium carbonate decomposition: CaCO₃ → CaO + CO₂. The carbonate C–O bond fractures at high temperature, CO₂ is released and relaxes to linear geometry, leaving solid CaO.',
    },
  },
  {
    id: 'chem-rxn-zn-hcl',
    filename: 'reaction-zn-hcl.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionZnHcl,
    nameI18n: {
      'zh-CN': '化学 · 锌与稀盐酸置换氢气（动力学）',
      'en-US': 'Chemistry · Zn + HCl single-replacement dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '单置换反应：Zn + 2HCl → ZnCl₂ + H₂。H–Cl 断裂、释放的 H 自由基两两捕获重组为 H₂ 逸出，Zn 与 Cl 结合成 ZnCl₂；高温下过程更剧烈。',
      'en-US':
        'Single-replacement: Zn + 2HCl → ZnCl₂ + H₂. H–Cl severs, the freed H radicals capture each other into H₂ gas while Zn binds Cl; fiercer at higher temperature.',
    },
  },
  {
    id: 'chem-rxn-hcl-naoh',
    filename: 'reaction-hcl-naoh.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionHclNaoh,
    nameI18n: {
      'zh-CN': '化学 · 盐酸中和氢氧化钠（动力学）',
      'en-US': 'Chemistry · HCl + NaOH neutralisation dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '中和反应：HCl + NaOH → NaCl + H₂O。H–Cl 与 Na–O 断裂交换，H、OH 自由基重组为 H₂O，Na、Cl 结合成 NaCl。',
      'en-US':
        'Neutralisation: HCl + NaOH → NaCl + H₂O. H–Cl and Na–O exchange partners; H and OH recombine into H₂O while Na and Cl form NaCl.',
    },
  },
  {
    id: 'chem-rxn-agno3-nacl',
    filename: 'reaction-agno3-nacl.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionAgno3Nacl,
    nameI18n: {
      'zh-CN': '化学 · 硝酸银与氯化钠沉淀（动力学）',
      'en-US': 'Chemistry · AgNO₃ + NaCl precipitation dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '沉淀反应：AgNO₃ + NaCl → AgCl↓ + NaNO₃。Ag–O 与 Na–Cl 断裂交换，Ag 与 Cl 结合析出 AgCl，Na 与 NO₃ 结合为 NaNO₃。',
      'en-US':
        'Precipitation: AgNO₃ + NaCl → AgCl↓ + NaNO₃. Ag–O and Na–Cl swap partners, Ag and Cl precipitate AgCl while Na and NO₃ combine into NaNO₃.',
    },
  },
  {
    id: 'chem-rxn-nacl-electrolysis',
    filename: 'reaction-nacl-electrolysis.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionNaclElectrolysis,
    nameI18n: {
      'zh-CN': '化学 · 熔融氯化钠电解（动力学）',
      'en-US': 'Chemistry · molten NaCl electrolysis dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '电解分解：2NaCl → 2Na + Cl₂。高温下两条 Na–Cl 键断裂，两个 Cl 自由基捕获重组为 Cl₂ 逸出，Na 原子留下。',
      'en-US':
        'Electrolysis decomposition: 2NaCl → 2Na + Cl₂. Both Na–Cl bonds fracture at high temperature, the two Cl radicals recombine into Cl₂ gas while Na atoms remain.',
    },
  },
  {
    id: 'chem-rxn-c2h4-br2',
    filename: 'reaction-c2h4-br2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionC2h4Br2,
    nameI18n: {
      'zh-CN': '化学 · 乙烯与溴加成（动力学）',
      'en-US': 'Chemistry · C₂H₄ + Br₂ addition dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '加成反应：C₂H₄ + Br₂ → C₂H₄Br₂。乙烯的 π 键与 Br–Br 断裂，两个 Br 各接到一个碳上生成 1,2-二溴乙烷；产物自动松弛展直。',
      'en-US':
        'Addition reaction: C₂H₄ + Br₂ → C₂H₄Br₂. The alkene π bond and Br–Br sever and one Br adds to each carbon, giving 1,2-dibromoethane; the product relaxes flat.',
    },
  },
  {
    id: 'chem-rxn-esterification',
    filename: 'reaction-esterification.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionEsterification,
    nameI18n: {
      'zh-CN': '化学 · 乙酸乙酯的酯化合成（动力学）',
      'en-US': 'Chemistry · esterification dynamics (EtOAc)',
    },
    descriptionI18n: {
      'zh-CN':
        '酯化反应：C₂H₅OH + CH₃COOH → CH₃COOC₂H₅ + H₂O。乙醇的羟基氢与乙酸的羧基在高温下酯化，析出乙酸乙酯并脱去一分子水。',
      'en-US':
        'Esterification: C₂H₅OH + CH₃COOH → CH₃COOC₂H₅ + H₂O. The hydroxy H of ethanol couples with the carboxyl of acetic acid to give ethyl acetate and split off water.',
    },
  },
  {
    id: 'chem-rxn-c2h5oh-o2',
    filename: 'reaction-c2h5oh-o2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionC2h5ohO2,
    nameI18n: {
      'zh-CN': '化学 · 乙醇催化氧化为乙醛（动力学）',
      'en-US': 'Chemistry · ethanol → acetaldehyde dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '催化氧化：2C₂H₅OH + O₂ → 2CH₃CHO + 2H₂O。高温下 O–H 与 C–H 脱氢、O=O 断裂，乙醇转为乙醛并放出水。',
      'en-US':
        'Catalytic oxidation: 2C₂H₅OH + O₂ → 2CH₃CHO + 2H₂O. O–H / C–H dehydrogenation with O=O cleavage turns ethanol into acetaldehyde plus water.',
    },
  },
  {
    id: 'chem-rxn-c2h5oh-c2h4',
    filename: 'reaction-c2h5oh-c2h4.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionC2h5ohC2h4,
    nameI18n: {
      'zh-CN': '化学 · 乙醇脱水制乙烯（动力学）',
      'en-US': 'Chemistry · ethanol dehydration → ethene',
    },
    descriptionI18n: {
      'zh-CN':
        '消去/脱水：C₂H₅OH → C₂H₄ + H₂O。浓硫酸催化下高温脱水，C–O 与 C–H 键断裂脱去一分子水，生成烯烃 C₂H₄。',
      'en-US':
        'Elimination/dehydration: C₂H₅OH → C₂H₄ + H₂O. Conc. H₂SO₄ catalysis at high T severs C–O and C–H, eliminating water to give the alkene ethene.',
    },
  },
  {
    id: 'chem-rxn-ch4-cl2',
    filename: 'reaction-ch4-cl2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionCh4Cl2,
    nameI18n: {
      'zh-CN': '化学 · 甲烷与氯气取代（动力学）',
      'en-US': 'Chemistry · methane chlorination dynamics',
    },
    descriptionI18n: {
      'zh-CN':
        '取代反应：CH₄ + Cl₂ → CH₃Cl + HCl。光照/高温下 C–H 与 Cl–Cl 断裂，一个 Cl 取代氢生成氯甲烷，另一 Cl 与 H 结合为 HCl。',
      'en-US':
        'Substitution: CH₄ + Cl₂ → CH₃Cl + HCl. Photochemically C–H and Cl–Cl sever; one Cl displaces a hydrogen to give chloromethane while the other pairs with H into HCl.',
    },
  },
  {
    id: 'chem-rxn-c6h6-h2',
    filename: 'reaction-c6h6-h2.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionC6h6H2,
    nameI18n: {
      'zh-CN': '化学 · 苯与氢气加成制环己烷（动力学）',
      'en-US': 'Chemistry · benzene + H₂ → cyclohexane',
    },
    descriptionI18n: {
      'zh-CN':
        '加成反应：C₆H₆ + 3H₂ → C₆H₁₂。Ni 催化、高温高压下苯环的 π 键逐条断裂，六分子 H₂ 加氢成饱和环己烷。',
      'en-US':
        'Addition: C₆H₆ + 3H₂ → C₆H₁₂. Ni-catalysed hydrogenation under heat/pressure saturates the aromatic ring with six added H into cyclohexane.',
    },
  },
  {
    id: 'chem-rxn-c7h8-kmno4',
    filename: 'reaction-c7h8-kmno4.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.chem-reaction',
    group: 'chem',
    content: reactionC7h8Kmno4,
    nameI18n: {
      'zh-CN': '化学 · 甲苯被高锰酸钾氧化为苯甲酸（动力学）',
      'en-US': 'Chemistry · toluene + KMnO₄ → benzoate',
    },
    descriptionI18n: {
      'zh-CN':
        '氧化：C₆H₅CH₃ + 2KMnO₄ → C₆H₅COOK + 2MnO₂ + KOH + H₂O。侧链甲基被氧化成羧基，MnO₄⁻ 还原为 MnO₂ 沉淀，演示芳环侧链的氧化。',
      'en-US':
        'Oxidation: C₆H₅CH₃ + 2KMnO₄ → C₆H₅COOK + 2MnO₂ + KOH + H₂O. The benzylic methyl is oxidised to a carboxyl while MnO₄⁻ reduces to MnO₂ — classic side-chain oxidation of an arene.',
    },
  },

  // ---- AI Training samples (served from examples/data/ai/) --------------
  {
    id: 'ai-linear',
    filename: 'ai-linear.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.ai-training',
    loadContent: () => aiExampleContent('ai-linear.csv') ?? Promise.resolve(''),
    nameI18n: { 'zh-CN': 'AI 训练 · 线性回归', 'en-US': 'AI Train · Linear Regression' },
    descriptionI18n: {
      'zh-CN': '120 行 y=2.4x+1+噪声样本，线性回归入门示例。',
      'en-US': '120 rows of y=2.4x+1+noise; linear regression starter sample.',
    },
  },
  {
    id: 'ai-nonlinear',
    filename: 'ai-nonlinear.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.ai-training',
    loadContent: () => aiExampleContent('ai-nonlinear.csv') ?? Promise.resolve(''),
    nameI18n: { 'zh-CN': 'AI 训练 · 非线性回归', 'en-US': 'AI Train · Nonlinear Regression' },
    descriptionI18n: {
      'zh-CN': '140 行三次 + 正弦曲线样本，神经网络拟合演示。',
      'en-US': '140 rows of cubic + sine; neural-net fit demo.',
    },
  },
  {
    id: 'ai-logistic',
    filename: 'ai-logistic.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.ai-training',
    loadContent: () => aiExampleContent('ai-logistic.csv') ?? Promise.resolve(''),
    nameI18n: { 'zh-CN': 'AI 训练 · 逻辑回归', 'en-US': 'AI Train · Logistic Regression' },
    descriptionI18n: {
      'zh-CN': '160 行二分类双高斯团样本，决策边界演示。',
      'en-US': '160 rows of two gaussian blobs; decision-boundary demo.',
    },
  },
  {
    id: 'ai-mnist',
    filename: 'ai-mnist.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.ai-training',
    loadContent: () => aiExampleContent('ai-mnist.csv') ?? Promise.resolve(''),
    nameI18n: { 'zh-CN': 'AI 训练 · MNIST 分类', 'en-US': 'AI Train · MNIST CNN' },
    descriptionI18n: {
      'zh-CN': '200 张 28×28 手写数字（十类）精简集，卷积网络入门。',
      'en-US': '200 compact 28x28 digits (10 classes); CNN intro sample.',
    },
  },
  // ---- Visual FX presets -----------------------------------------------------
  {
    id: 'fx-blackhole-m87',
    filename: 'fx-blackhole-m87.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.blackhole',
    loadContent: () => exampleContent('fx-blackhole-m87.json'),
    nameI18n: {
      'zh-CN': '特效 · 黑洞 M87*（EHT 目标，6.5×10⁹ M☉）',
      'en-US': 'FX · Black hole M87* (EHT target)',
    },
    descriptionI18n: {
      'zh-CN':
        '事件视界望远镜成像目标 M87*：6.5×10⁹ M☉、距离约 16.8 Mpc。加载后逐像素积分史瓦西零测地线，观察阴影、光子环与多普勒集束吸积盘；科学输出栏给出可与 EHT 对比的阴影角直径。',
      'en-US':
        'The EHT imaging target M87*: 6.5×10⁹ M☉ at ≈16.8 Mpc. Loads per-pixel Schwarzschild geodesic tracing with shadow, photon ring and Doppler-beamed disk; the science strip shows the shadow angle comparable to EHT.',
    },
  },
  {
    id: 'fx-blackhole-sgra',
    filename: 'fx-blackhole-sgra.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.blackhole',
    loadContent: () => exampleContent('fx-blackhole-sgra.json'),
    nameI18n: {
      'zh-CN': '特效 · 黑洞 Sgr A*（银河系中心，4.3×10⁶ M☉）',
      'en-US': 'FX · Black hole Sgr A* (Milky Way centre)',
    },
    descriptionI18n: {
      'zh-CN':
        '银河系中心黑洞人马座 A*：4.3×10⁶ M☉、约 8.15 kpc。预报阴影角直径约 50 μas 量级，与 EHT 2022 年观测同量级；星空密度调高以模拟银心方向。',
      'en-US':
        'Sgr A*: 4.3×10⁶ M☉ at ≈8.15 kpc. The predicted shadow diameter is tens of μas, same order as the 2022 EHT measurement; star density raised for the galactic-centre sky.',
    },
  },
  {
    id: 'fx-blackhole-cygnus',
    filename: 'fx-blackhole-cygnus.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.blackhole',
    loadContent: () => exampleContent('fx-blackhole-cygnus.json'),
    nameI18n: {
      'zh-CN': '特效 · 黑洞 Cygnus X-1（恒星级，21 M☉）',
      'en-US': 'FX · Black hole Cygnus X-1 (stellar-mass)',
    },
    descriptionI18n: {
      'zh-CN':
        '著名恒星级黑洞天鹅座 X-1：21 M☉、约 2.2 kpc。盘温度升至 4×10⁴ K（X 射线双星薄盘量级，呈蓝白色）；科学输出栏的阴影角直径缩小到纳角秒级，直观展示质量-尺度关系。',
      'en-US':
        'The famous stellar-mass black hole Cygnus X-1: 21 M☉ at ≈2.2 kpc. Disk raised to 4×10⁴ K (X-ray-binary thin-disk scale, blue-white); the shadow angle drops to nano-arcseconds — a direct feel for the mass–size scaling.',
    },
  },
  {
    id: 'fx-water-interference',
    filename: 'fx-water-interference.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.water',
    loadContent: () => exampleContent('fx-water-interference.json'),
    nameI18n: {
      'zh-CN': '特效 · 双源水波干涉（λ=8 格点，d=16 格点）',
      'en-US': 'FX · Two-source water-wave interference',
    },
    descriptionI18n:
    {
      'zh-CN':
        'GPU 求解波动方程的连续双点源干涉：λ=8、d=16 格点，节线满足 sinθ=(n+½)λ/d，第一条节线约 14.5°。科学输出栏给出波长与节线角；水面稳定后可清晰看到相消/相长条纹。',
      'en-US':
        'Continuous two-point-source interference on the GPU wave-equation solver: λ=8, d=16 cells; nodal lines follow sinθ=(n+½)λ/d with the first at ≈14.5°. The science strip lists wavelength and nodal angle.',
    },
  },
  {
    id: 'fx-water-rain',
    filename: 'fx-water-rain.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.water',
    loadContent: () => exampleContent('fx-water-rain.json'),
    nameI18n: {
      'zh-CN': '特效 · 雨落池面（FDTD 波动方程）',
      'en-US': 'FX · Rain over the pool (FDTD wave equation)',
    },
    descriptionI18n: {
      'zh-CN':
        '随机雨滴持续激发波动方程 FDTD 求解器（256² 网格、浅水波速 √(g·h)）：吸收边界无反射回波，池底焦散随波面曲率实时变化。也可直接点击水面自行滴落。',
      'en-US':
        'Random rain continuously excites the FDTD wave-equation solver (256² grid, shallow-water speed √(g·h)) with sponge absorbing boundaries and curvature-driven floor caustics. Click the surface to add your own drops.',
    },
  },
  {
    id: 'fx-water-seastate4',
    filename: 'fx-water-seastate4.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.water',
    loadContent: () => exampleContent('fx-water-seastate4.json'),
    nameI18n: {
      'zh-CN': '特效 · 4 级海况（U=8 m/s，Gerstner 频谱）',
      'en-US': 'FX · Sea state 4 (U = 8 m/s Gerstner spectrum)',
    },
    descriptionI18n: {
      'zh-CN':
        '8 m/s 风速的充分成长海况：Pierson–Moskowitz 峰值 λ_p≈56 m、H_s≈1.4 m，26 列 Gerstner 波列按精确深水色散 ω²=g·k 叠加；波峰翻卷处按雅可比行列式生成白沫。',
      'en-US':
        'A fully developed sea for U=8 m/s: Pierson–Moskowitz peak λ_p≈56 m, H_s≈1.4 m; 26 Gerstner trains summed on the exact deep-water dispersion ω²=g·k with Jacobian-based foam at folding crests.',
    },
  },
  {
    id: 'fx-cloud-noon-cumulus',
    filename: 'fx-cloud-noon-cumulus.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.cloud',
    loadContent: () => exampleContent('fx-cloud-noon-cumulus.json'),
    nameI18n: {
      'zh-CN': '特效 · 体积云 正午积云（北京，夏至）',
      'en-US': 'FX · Volumetric clouds — noon cumulus (Beijing)',
    },
    descriptionI18n: {
      'zh-CN':
        '夏至北京地方时正午（UTC 4.25 h）的积云场景：太阳高度约 73°，云底 650 m、厚 800 m，西南风 6 m/s 平流；自然日光照明下云体受 Beer–Lambert 消光与 HG 散射，科学输出栏给出太阳高度/方位与光学深度 τ。',
      'en-US':
        'Noon cumulus at the summer solstice in Beijing (UTC 4.25 h, solar altitude ≈73°): cloud base 650 m, 800 m thick, advected by a 6 m/s south-wester; natural daylight with Beer–Lambert extinction and HG scattering.',
    },
  },
  {
    id: 'fx-cloud-sunset-stratus',
    filename: 'fx-cloud-sunset-stratus.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.cloud',
    loadContent: () => exampleContent('fx-cloud-sunset-stratus.json'),
    nameI18n: {
      'zh-CN': '特效 · 体积云 黄昏层云（北京，夏至）',
      'en-US': 'FX · Volumetric clouds — sunset stratus (Beijing)',
    },
    descriptionI18n: {
      'zh-CN':
        '夏至北京日落前的层云场景（UTC 10.8 h，太阳低角度）：78% 云量、云底 500 m，暖色低角度阳光产生银边与霞光；西风 9 m/s 平流。可开启自动昼夜观察黄昏入夜的全过程。',
      'en-US':
        'Low-sun stratus before sunset at the summer solstice in Beijing (UTC 10.8 h): 78% coverage, base 500 m, warm grazing sunlight with silver linings; 9 m/s westerly advection.',
    },
  },
  {
    id: 'fx-cloud-starry-night',
    filename: 'fx-cloud-starry-night.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.cloud',
    loadContent: () => exampleContent('fx-cloud-starry-night.json'),
    nameI18n: {
      'zh-CN': '特效 · 体积云 月夜孤峰云海（莫纳克亚）',
      'en-US': 'FX · Volumetric clouds — moonlit night (Mauna Kea)',
    },
    descriptionI18n: {
      'zh-CN':
        '夏至夜莫纳克亚天文台（北纬 19.8°）上空的散云：深空蓝夜空底色，月光按月相照亮云顶；云底 1100 m、西北风 12 m/s。',
      'en-US':
        'Broken cumulus above Mauna Kea (lat 19.8°N) on a solstice night: deep-space blue sky with moonlight scaled by lunar phase; cloud base 1100 m, 12 m/s north-wester.',
    },
  },
  // ---- Astronomy presets -----------------------------------------------------
  {
    id: 'astro-sim-deep-field',
    filename: 'astro-sim-deep-field.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'astro.pipeline',
    loadContent: () => exampleContent('astro-sim-deep-field.json'),
    nameI18n: {
      'zh-CN': '天文 · V 波段深场仿真（512²，140 星，Moffat β=2.5）',
      'en-US': 'Astro · V-band deep field (512², 140 stars)',
    },
    descriptionI18n: {
      'zh-CN':
        '300 s 曝光的仿真深场：140 颗幂律流量分布恒星经 Moffat 星象（β=2.5，FWHM 3.2 px）成像，含天光 180 e⁻、暗流 0.02 e⁻/s、读出噪声 5 e⁻、渐晕平场与 18 个宇宙线事例；加载后自动完成校准、6σ 宇宙线剔除、恒星检测与孔径测光，科学输出栏给出流量回收比例。',
      'en-US':
        'Simulated 300 s deep exposure: 140 power-law stars imaged through a Moffat PSF (β=2.5, FWHM 3.2 px) with 180 e⁻ sky, dark current, 5 e⁻ read noise, vignetting and 18 cosmic rays; the full pipeline (calibration, CR clipping, detection, aperture photometry) runs on load.',
    },
  },
  {
    id: 'astro-benchmark-photometry',
    filename: 'astro-benchmark-photometry.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'astro.pipeline',
    loadContent: () => exampleContent('astro-benchmark-photometry.json'),
    nameI18n: {
      'zh-CN': '天文 · 测光基准（注入流量回收 ≤5% 容差）',
      'en-US': 'Astro · Photometric benchmark (≤5% flux-recovery)',
    },
    descriptionI18n: {
      'zh-CN':
        '端到端测光基准帧：45 颗已知注入流量的恒星（400–90000 e⁻）、2.8 px FWHM、6σ 检测阈值与 2.2×FWHM 孔径；科学输出栏的「Flux recovery」对比最亮注入源与孔径测光回收值，超过 ±5% 会转为警告色。',
      'en-US':
        'End-to-end photometric benchmark: 45 stars with known injected fluxes (400–90000 e⁻), 2.8 px FWHM, 6σ detection and a 2.2×FWHM aperture; the science strip reports flux recovery of the brightest injected star, warning beyond ±5%.',
    },
  },
  {
    id: 'astro-sim-noisy-short',
    filename: 'astro-sim-noisy-short.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'astro.pipeline',
    loadContent: () => exampleContent('astro-sim-noisy-short.json'),
    nameI18n: {
      'zh-CN': '天文 · 高噪声短曝光（SNR 压力测试，256²）',
      'en-US': 'Astro · Noisy short exposure (SNR stress test)',
    },
    descriptionI18n: {
      'zh-CN':
        '10 s 高噪声帧：天光 900 e⁻、读出噪声 9 e⁻、增益 2.4 e⁻/ADU、FWHM 4.5 px、25 个宇宙线；用于检验 CCD 方程信噪比与低信噪比极限下的检测表现，科学输出栏给出背景 σ 与最亮源 SNR。',
      'en-US':
        'A noisy 10 s frame: 900 e⁻ sky, 9 e⁻ read noise, gain 2.4 e⁻/ADU, FWHM 4.5 px and 25 cosmic rays; stresses CCD-equation SNR and low-SNR detection. The science strip reports background σ and peak-source SNR.',
    },
  },
  // ---- Daylight sky presets ---------------------------------------------------
  {
    id: 'fx-sky-noon-clear',
    filename: 'fx-sky-noon-clear.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.sky',
    loadContent: () => exampleContent('fx-sky-noon-clear.json'),
    nameI18n: {
      'zh-CN': '特效 · 日光天空 正午晴空（北京）',
      'en-US': 'FX · Daylight sky — clear noon (Beijing)',
    },
    descriptionI18n: {
      'zh-CN':
        '北京正午（太阳高度约 70°）：低浑浊度（2.5）下的 Rayleigh 蓝天，太阳盘面临边昏暗；科学输出栏给出 Kasten–Young 气团 ≈ 1.45 与「白昼」晨昏蒙影分类。',
      'en-US':
        'Beijing noon (sun ~70° high): Rayleigh blue sky at low turbidity (2.5) with a limb-darkened sun disk; the science strip reports Kasten–Young air mass ≈ 1.45 and the "day" twilight band.',
    },
  },
  {
    id: 'fx-sky-sunset-golden',
    filename: 'fx-sky-sunset-golden.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.sky',
    loadContent: () => exampleContent('fx-sky-sunset-golden.json'),
    nameI18n: {
      'zh-CN': '特效 · 日光天空 金色日落（北京）',
      'en-US': 'FX · Daylight sky — golden sunset (Beijing)',
    },
    descriptionI18n: {
      'zh-CN':
        '日落前的低太阳高度：视线穿过更厚的大气，Rayleigh 散射把直射阳光染成橙红，高浑浊度（5.5）加强地平线霾与 Mie 红霞；地影方向的对比色带由物理积分自然产生。',
      'en-US':
        'Low sun before sunset: longer light paths redden the direct beam via Rayleigh scattering while high turbidity (5.5) strengthens horizon haze and the Mie glow; the anti-solar belt emerges from the physics, not a gradient trick.',
    },
  },
  {
    id: 'fx-sky-moonlit-dusk',
    filename: 'fx-sky-moonlit-dusk.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.sky',
    loadContent: () => exampleContent('fx-sky-moonlit-dusk.json'),
    nameI18n: {
      'zh-CN': '特效 · 日光天空 暮光入夜（昼夜循环）',
      'en-US': 'FX · Daylight sky — dusk into night (day cycle)',
    },
    descriptionI18n: {
      'zh-CN':
        '开启昼夜循环从天文暮光滑向深夜：太阳沉入 −18° 以下时大气积分进入地影，天光熄灭、月光明亮份额上升；科学输出栏实时显示晨昏蒙影分类切换（民用 → 航海 → 天文 → 夜）。',
      'en-US':
        'Day cycle sliding from astronomical dusk into deep night: as the sun sinks past −18° the integrator enters the earth shadow, skylight dies and the moon takes over; the science strip tracks the twilight band transitions.',
    },
  },
  // ---- Night-sky presets ------------------------------------------------------
  {
    id: 'fx-stars-mauna-kea',
    filename: 'fx-stars-mauna-kea.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.stars',
    loadContent: () => exampleContent('fx-stars-mauna-kea.json'),
    nameI18n: {
      'zh-CN': '特效 · 星空 原始暗夜（莫纳克亚，Bortle 1）',
      'en-US': 'FX · Starfield — pristine dark sky (Mauna Kea, Bortle 1)',
    },
    descriptionI18n: {
      'zh-CN':
        '莫纳克亚（北纬 19.8°）的 Bortle 1 原始暗夜：真实银极（RA 192.86°, Dec +27.13°）锚定的银河带、低视宁度微闪烁与偶发流星；恒星时流开启，约 3 分钟转过全天。极限星等 7.8，肉眼可见星约 24000 颗。',
      'en-US':
        'Bortle-1 pristine sky over Mauna Kea (lat 19.8°N): a Milky-Way band anchored on the true galactic pole (RA 192.86°, Dec +27.13°), faint scintillation and occasional meteors. Sidereal time-lapse rotates the whole sky in ~3 min. Limiting mag 7.8, ~24000 naked-eye stars.',
    },
  },
  {
    id: 'fx-stars-urban-sky',
    filename: 'fx-stars-urban-sky.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.stars',
    loadContent: () => exampleContent('fx-stars-urban-sky.json'),
    nameI18n: {
      'zh-CN': '特效 · 星空 城市夜空（北京，Bortle 8）',
      'en-US': 'FX · Starfield — inner-city sky (Beijing, Bortle 8)',
    },
    descriptionI18n: {
      'zh-CN':
        'Bortle 8 市中心夜空：地平线方向暖色光污染穹顶，银河几乎不可见，仅剩亮星（极限星等约 5.0，可见星约 1300 颗）；与莫纳克亚示例对比即可理解光污染对星空的压制。',
      'en-US':
        'Bortle-8 inner-city sky: a warm light-pollution dome hugging the horizon, the Milky Way nearly erased, only bright stars survive (limiting mag ~5.0, ~1300 visible). Compare with the Mauna Kea example to see what light pollution does.',
    },
  },
  {
    id: 'fx-stars-meteor-shower',
    filename: 'fx-stars-meteor-shower.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'fx.stars',
    loadContent: () => exampleContent('fx-stars-meteor-shower.json'),
    nameI18n: {
      'zh-CN': '特效 · 星空 流星雨（拉帕尔马，14 颗/分钟）',
      'en-US': 'FX · Starfield — meteor shower (La Palma, 14/min)',
    },
    descriptionI18n: {
      'zh-CN':
        '拉帕尔马（北纬 28.8°）的流星雨场景：泊松过程调度（指数间隔，均值 4.3 s），每颗流星沿随机大圆划过 9–16° 并带运动头部光晕；开启恒星时流可同时看到天球旋转与流星。',
      'en-US':
        'Meteor shower over La Palma (lat 28.8°N): a Poisson scheduler (exponential gaps, mean 4.3 s), each meteor streaking 9–16° along a random great circle with a moving head glow. Sidereal time-lapse on — sky rotation and meteors together.',
    },
  },
  // ---- Research suite samples (numeric kernels with real/synthetic data) ----
  {
    id: 'chem-n2o5-decomp',
    filename: 'chem-n2o5-decomp.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.chem-reaction-order',
    group: 'chem',
    content: chemN2o5Csv,
    nameI18n: {
      'zh-CN': '反应级数 · N₂O₅ 分解动力学',
      'en-US': 'Reaction Order · N₂O₅ Decomposition Kinetics',
    },
    descriptionI18n: {
      'zh-CN':
        '五氧化二氮分解 c–t 数据（41 点，约 1600 s），按文献速率常数 k≈3.46e-3 s⁻¹（~315 °C）合成，含 1% 高斯噪声。加载后积分法 R² 判优应判为一级，半衰期法交叉验证一致。',
      'en-US':
        'c–t data for N2O5 decomposition (41 points over ~1600 s), synthesised from the literature rate constant k ≈ 3.46e-3 s⁻¹ (~315 °C) with 1% Gaussian noise. R² screening should decide first order, cross-checked by the half-life method.',
    },
  },
  {
    id: 'phys-projectile-45deg',
    filename: 'phys-projectile-45deg.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.physics-trajectory',
    group: 'physics',
    content: physProjectileCsv,
    nameI18n: {
      'zh-CN': '物理 · 抛体轨迹（45°，含 0.5% 噪声）',
      'en-US': 'Physics · Projectile trajectory (45°, 0.5 % noise)',
    },
    descriptionI18n: {
      'zh-CN':
        '合成抛体采样轨迹：v0 = 20 m/s、θ = 45°、g = 9.81 m/s²、50 点、乘性高斯噪声 0.5%（种子 20251011）。加载后线性化最小二乘拟合可回收 v0 与 θ（相对误差 <1%），并给出 KE/PE 能量分解。',
      'en-US':
        'Synthetic projectile samples: v0 = 20 m/s, θ = 45°, g = 9.81 m/s², 50 points, 0.5 % multiplicative Gaussian noise (seed 20251011). The linearized least-squares fit recovers v0 and θ within 1 % relative error, with KE/PE energy decomposition.',
    },
  },
  {
    id: 'eng-ladder-netlist',
    filename: 'eng-ladder-netlist.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.eng-circuit',
    group: 'engineering',
    content: engLadderNetlistJson,
    nameI18n: {
      'zh-CN': '工程 · T 型梯形电阻网络',
      'en-US': 'Engineering · T-type Ladder Resistor Network',
    },
    descriptionI18n: {
      'zh-CN':
        '12 V 电压源带 R1=1kΩ、R2=R3=2kΩ 的 T 型梯形网络，解析解 v_mid = v_out = 8 V。点击「解算电路」用改进节点法求解，并查看各节点电压与 Tellegen 功率平衡自检。',
      'en-US':
        'A 12 V source driving a T-ladder with R1 = 1 kΩ, R2 = R3 = 2 kΩ; the analytic solution is v_mid = v_out = 8 V. Press "Solve circuit" for the MNA node voltages with a Tellegen power-balance self-check.',
    },
  },
  {
    id: 'eng-truss-bridge',
    filename: 'eng-truss-bridge.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.eng-truss',
    group: 'engineering',
    content: engTrussBridgeJson,
    nameI18n: {
      'zh-CN': '工程 · 5 节点简支桁架桥',
      'en-US': 'Engineering · 5-node Simply-supported Truss Bridge',
    },
    descriptionI18n: {
      'zh-CN':
        'E=200 GPa、A=3000 mm² 的 7 杆简支桁架桥，跨中下弦节点承受 50 kN 竖向载荷；两端竖向反力各 25 kN，顶弦受压、底弦受拉。点击「解算桁架」查看位移、轴力着色与可调放大系数的变形叠加。',
      'en-US':
        'A 7-member simply-supported truss bridge (E = 200 GPa, A = 3000 mm²) with a 50 kN vertical load on the mid bottom-chord node; end reactions are 25 kN each, top chord in compression and bottom chord in tension. Press "Solve truss" for displacements, axial-force coloring and a deformed-shape overlay with an adjustable scale.',
    },
  },
  {
    id: 'bio-mendel-f2-seven-traits',
    filename: 'mendel-f2-seven-traits.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.bio-mendel',
    group: 'bio',
    content: mendelF2Csv,
    nameI18n: {
      'zh-CN': '孟德尔 F₂ · 七性状二项分离检验',
      'en-US': "Mendel's F₂ · Seven-Trait Segregation Test",
    },
    descriptionI18n: {
      'zh-CN':
        '孟德尔（1866）豌豆 F₂ 代分离计数：七个性状的 3:1 显性分离与二粒杂交种子 9:3:3:1，共 18 组。加载后逐性状做卡方拟合优度检验，并给出 df=10 的合并检验 χ² 与 p 值。',
      'en-US':
        "Mendel's (1866) F₂ counts: seven monohybrid 3:1 traits plus the dihybrid seed 9:3:3:1 experiment, 18 groups in total. Load it for per-trait χ² goodness-of-fit tests and the pooled df=10 χ² with its p-value.",
    },
  },
  {
    id: 'env-hudson-bay-lynx-hare',
    filename: 'hudson-bay-lynx-hare.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.env-predator-prey',
    group: 'env',
    content: hudsonBayCsv,
    nameI18n: {
      'zh-CN': '哈德逊湾 · 猞猁-野兔毛皮回报序列',
      'en-US': 'Hudson Bay · Lynx–Hare Fur Returns',
    },
    descriptionI18n: {
      'zh-CN':
        '哈德逊湾公司 1849–1890 年猞猁与野兔配对年毛皮回报（Elton & Nicholson 1942 数字化），42 行。加载后自动做 Lotka-Volterra 线性化回归拟合 α/β/γ/δ 并叠加相图轨道，呈现著名的约 10 年捕食-被捕食周期。',
      'en-US':
        'Paired annual lynx and hare fur returns of the Hudson Bay Company, 1849-1890 (digitized by Elton & Nicholson 1942), 42 rows. Loading runs the linearized Lotka-Volterra regression for α/β/γ/δ, overlays the fitted orbit and reveals the famous ~10-year predator-prey cycle.',
    },
  },
  {
    id: 'geo-carbondating-intcal20',
    filename: 'intcal20-excerpt.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-carbondating',
    group: 'geo',
    content: geoIntcal20ExcerptCsv,
    nameI18n: {
      'zh-CN': '碳定年 · IntCal20 校准曲线节选（0–14000 cal BP）',
      'en-US': 'Radiocarbon · IntCal20 Calibration Excerpt (0-14000 cal BP)',
    },
    descriptionI18n: {
      'zh-CN':
        'IntCal20（Reimer et al. 2020）大气 ¹⁴C 校准曲线官方节选：0–14000 cal BP、每 50 年一行共 281 行（cal_bp, c14_age, sigma）。载入后自动完成似然剖面校准，给出最佳日历年与 1σ/2σ 区间。',
      'en-US':
        'Official IntCal20 (Reimer et al. 2020) atmospheric 14C calibration excerpt: 0-14000 cal BP on the 50-year grid, 281 rows (cal_bp, c14_age, sigma). Loading runs the likelihood-profile calibration for the best calendar age with 1σ/2σ ranges.',
    },
  },
  {
    id: 'geo-soilwater-sand',
    filename: 'vg-sand-retention.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-soilwater',
    group: 'geo',
    content: geoVgSandRetentionCsv,
    nameI18n: {
      'zh-CN': '土壤水 · 砂土持水曲线合成数据（19 点）',
      'en-US': 'Soil Water · Synthetic Sand Retention Dataset (19 points)',
    },
    descriptionI18n: {
      'zh-CN':
        '吸力 1–15000 cm 的 19 个 θ(h) 点：以 van Genuchten (1980) 表 1 砂土参数（θr=0.045、θs=0.430、α=0.145 cm⁻¹、n=2.68）加 1% 乘性高斯噪声按种子复现生成（文件头注明）。载入即触发 LM 拟合并回收参数。',
      'en-US':
        '19 theta(h) points from 1-15000 cm: generated reproducibly from the van Genuchten (1980) Table 1 sand parameters (θr=0.045, θs=0.430, α=0.145 cm⁻¹, n=2.68) with 1% multiplicative Gaussian noise (seed documented in the header). Loading triggers the LM fit and parameter recovery.',
    },
  },
  {
    id: 'geo-hydrology-design-storm',
    filename: 'usgs-storm-hyetograph.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.geo-hydrology',
    group: 'geo',
    content: geoStormHyetographCsv,
    nameI18n: {
      'zh-CN': '水文 · 6 小时 90 mm 设计暴雨雨型',
      'en-US': 'Hydrology · 6-hour 90 mm Design-Storm Hyetograph',
    },
    descriptionI18n: {
      'zh-CN':
        '6 小时 90 mm 逐时增量合成设计暴雨（NWS 型雨峰位于 40% 时长处；USGS 实测站网在本环境不可达，按合成雨型提供并在文件头注明，非实测）。载入即运行 SCS-CN + 单位线汇流并核对体积守恒。',
      'en-US':
        'Synthetic 6-hour, 90 mm hourly design storm (NWS-style peak at 40% of duration; USGS gauges were unreachable from this environment, so a documented synthetic hyetograph is provided instead of observed data). Loading runs the SCS-CN + unit-hydrograph routing and checks volume conservation.',
    },
  },
  {
    id: 'markov-pagerank-web',
    filename: 'markov-pagerank-web.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.stats-markov',
    group: 'stats',
    content: markovPagerankWebCsv,
    nameI18n: {
      'zh-CN': '马尔可夫链 · 五页网页链接图',
      'en-US': 'Markov Chain · Five-Page Web Graph',
    },
    descriptionI18n: {
      'zh-CN':
        '5 个网页的行随机链接矩阵（Page & Brin 1998 的教学最小图）。加载后幂法自动求稳态（L1 残差 < 1e-12），并在状态转移图上叠加平稳分布柱状与随机轨迹。',
      'en-US':
        'A row-stochastic link matrix over five web pages (a minimal Page & Brin 1998 teaching graph). Load it and the power iteration recovers the stationary law to L1 < 1e-12, drawn on the transition graph with bars and a simulated trajectory.',
    },
  },
  {
    id: 'gutenberg-emma-ch1',
    filename: 'gutenberg-emma-ch1.txt',
    format: 'txt',
    mimeType: 'text/plain',
    pluginId: 'example.stats-zipf',
    group: 'stats',
    content: gutenbergEmmaCh1Txt,
    nameI18n: {
      'zh-CN': 'Zipf 定律 · 《爱玛》卷一第 1–6 章',
      'en-US': "Zipf's Law · Emma Vol. I, Ch. 1–6",
    },
    descriptionI18n: {
      'zh-CN':
        'Jane Austen《Emma》(1816) 第一卷第 1–6 章英文全文（约 1.4 万词，公版，校验于 Project Gutenberg eBook #158；# 行为注释）。加载后做词频排序与 log-log 拟合，实测 s ≈ 1.06、R² ≈ 0.97，与理想 Zipf 指数 s = 1 对照。',
      'en-US':
        "The full English text of Jane Austen's Emma (1816), Volume I chapters 1–6 (~14k words, public domain, checked against Project Gutenberg eBook #158; '#' lines are comments). Load it to rank word frequencies and fit log-log: measured s ≈ 1.06 with R² ≈ 0.97 against the ideal Zipf exponent s = 1.",
    },
  },
  {
    id: 'transit-lightcurve-hd209458',
    filename: 'astro-transit-lightcurve.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.astro-transit',
    group: 'astro',
    content: transitLightcurveCsv,
    nameI18n: {
      'zh-CN': '凌星光变 · HD 209458 b（合成教学数据）',
      'en-US': 'Transit Light Curve · HD 209458 b (synthetic)',
    },
    descriptionI18n: {
      'zh-CN':
        '按 NASA Exoplanet Archive 发表的 HD 209458 b 参数（P=3.52474859 d、深度=1.500%、T14=3.072 h）合成的 1000 点光变曲线（σ=1.2 mmag，10 个周期，固定种子）。加载后点击「检测周期并拟合」：简化 BLS 盲测周期，LM 精化梯形模型并输出 1σ 误差与相位折叠图。',
      'en-US':
        'A 1000-point light curve synthesized at the published HD 209458 b parameters (P = 3.52474859 d, depth = 1.500%, T14 = 3.072 h) from the NASA Exoplanet Archive (σ = 1.2 mmag, 10 periods, fixed seed). Load it and press "Detect & Fit": simplified-BLS blind detection, LM trapezoid refinement with 1σ errors and the phase-folded view.',
    },
  },
  {
    id: 'yale-bsc-bright',
    filename: 'yale-bsc-bright.csv',
    format: 'csv',
    mimeType: 'text/csv',
    pluginId: 'example.astro-hrdiagram',
    group: 'astro',
    content: yaleBscBrightCsv,
    nameI18n: {
      'zh-CN': '亮星星表 · Yale BSC 亮于 3.0 等（含 Hipparcos 视差）',
      'en-US': 'Bright Star Catalogue · Yale BSC V < 3.0 (with Hipparcos parallaxes)',
    },
    descriptionI18n: {
      'zh-CN':
        'Yale 亮星星表第 5 版（公有领域）中 V < 3.01 且 B−V ≤ 1.61 的 163 颗星，视差取自 Hipparcos（VizieR I/239，2026-10-11 检索）。加载后绘制赫罗图：视差换算距离模数得绝对星等，横轴 B−V，叠加 MK 主序参考带、太阳标记与主序拟合。',
      'en-US':
        '163 stars with V < 3.01 and B−V ≤ 1.61 from the Yale Bright Star Catalogue, 5th ed. (public domain), with Hipparcos parallaxes (VizieR I/239, retrieved 2026-10-11). Load it to draw the H–R diagram: absolute magnitudes via distance modulus, B−V colour axis, with the MK main-sequence band, the Sun marker and a screened main-sequence fit.',
    },
  },
];

/** Localized label for an example. */
export function exampleName(ex: BuiltinExample, locale: Locale): string {
  return ex.nameI18n[locale] ?? ex.filename;
}
export function exampleDescription(ex: BuiltinExample, locale: Locale): string {
  return ex.descriptionI18n[locale] ?? '';
}

/**
 * Split the sample list into the labelled group sections shown first in the
 * "示例" dialog, plus everything else. Keeps authoring order inside each part.
 */
export function groupExamples(list: BuiltinExample[]): {
  groups: { key: ExampleGroup; items: BuiltinExample[] }[];
  rest: BuiltinExample[];
} {
  const groups: { key: ExampleGroup; items: BuiltinExample[] }[] = [];
  const rest: BuiltinExample[] = [];
  for (const ex of list) {
    if (!ex.group) {
      rest.push(ex);
      continue;
    }
    let bucket = groups.find((g) => g.key === ex.group);
    if (!bucket) {
      bucket = { key: ex.group, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(ex);
  }
  return { groups, rest };
}

/** Wrap sample content into a real File so plugins load it like user data. */
export function exampleToFile(ex: BuiltinExample, content?: string): File {
  if (ex.contentBase64) {
    const binary = atob(ex.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], ex.filename, { type: ex.mimeType });
  }
  return new File([content ?? ex.content ?? ''], ex.filename, { type: ex.mimeType });
}