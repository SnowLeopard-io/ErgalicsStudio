// ==========================================================================
// Built-in sample data (spec §5.1 "示例数据").
// Sample files live in examples/data/ and are bundled at build time via
// Vite `?raw` imports so they load instantly without a network request.
// Binary assets (e.g. images) are embedded as base64 (see exampleAssets.ts).
// ==========================================================================

import type { Locale } from '@/i18n/types';

import diamondXyz from '../../examples/data/diamond.xyz?raw';
import crystalXyz from '../../examples/data/crystal.xyz?raw';
import tornadoXyz from '../../examples/data/tornado.xyz?raw';
import galaxyDat from '../../examples/data/galaxy.dat?raw';
import telemetryCsv from '../../examples/data/telemetry.csv?raw';
import datasetJson from '../../examples/data/dataset.json?raw';
import distributionDat from '../../examples/data/distribution.dat?raw';
import scatterClustersDat from '../../examples/data/scatter-clusters.dat?raw';
import fieldJson from '../../examples/data/field.json?raw';
import nbodyJson from '../../examples/data/nbody.json?raw';
import proteinJson from '../../examples/data/protein.json?raw';
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
import contourDataJson from '../../examples/data/contour-data.json?raw';
import fluidObstacleJson from '../../examples/data/fluid-obstacle.json?raw';
import choroplethGeojson from '../../examples/data/choropleth-sample.geojson?raw';
import chinaProvincesGeojson from '../../examples/data/china-provinces.geojson?raw';
import wavePulseJson from '../../examples/data/wave-pulse.json?raw';
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
import emCavityMtx from '../../examples/data/em-cavity-degenerate.mtx?raw';
import fluidCfdCaseAJson from '../../examples/data/fluid-cfd-case-a.json?raw';
import fluidCfdCaseBJson from '../../examples/data/fluid-cfd-case-b.json?raw';
import surfaceRippleJson from '../../examples/data/surface-ripple.json?raw';
import voxelSphereJson from '../../examples/data/voxel-sphere.json?raw';
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
import { TEST_PATTERN_PNG_BASE64 } from './exampleAssets';

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

/**
 * Optional grouping key for a built-in sample. Groups are rendered as their
 * own labelled section at the top of the "示例" dialog's dataset tab, ahead of
 * the general-purpose datasets, so flagship labs stay easy to find.
 */
export type ExampleGroup = 'lab' | 'chem';

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
    content: emCavityMtx,
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
    id: 'fluid-cfd-case-a',
    filename: 'fluid-cfd-case-a.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.fluid-cfd-coupler',
    content: fluidCfdCaseAJson,
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
    content: fluidCfdCaseBJson,
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
    id: 'diamond-sphere',
    filename: 'diamond.xyz',
    format: 'xyz',
    mimeType: 'text/plain',
    pluginId: 'example.point-cloud',
    content: diamondXyz,
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
    content: tornadoXyz,
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
    content: galaxyDat,
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
    content: distributionDat,
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
    content: scatterClustersDat,
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
    content: fieldJson,
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
    id: 'nbody-galaxy',
    filename: 'nbody.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.nbody',
    content: nbodyJson,
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
    content: proteinJson,
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
    content: contourDataJson,
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
    content: surfaceRippleJson,
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
    content: voxelSphereJson,
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
    content: fluidObstacleJson,
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
    content: chinaProvincesGeojson,
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
    id: 'wave-pulse',
    filename: 'wave-pulse.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.wave',
    content: wavePulseJson,
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
    group: 'lab',
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
    group: 'lab',
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
    group: 'lab',
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
    group: 'lab',
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
    group: 'lab',
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
    group: 'lab',
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
    group: 'lab',
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