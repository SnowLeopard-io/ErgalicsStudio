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
import { TEST_PATTERN_PNG_BASE64 } from './exampleAssets';

export interface BuiltinExample {
  id: string;
  filename: string;
  format: string;
  mimeType: string;
  pluginId: string;
  /** Text content for raw (text) assets. */
  content?: string;
  /** Base64 content for binary assets. */
  contentBase64?: string;
  nameI18n: Record<Locale, string>;
  descriptionI18n: Record<Locale, string>;
}

export const BUILTIN_EXAMPLES: BuiltinExample[] = [
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
];

/** Localized label for an example. */
export function exampleName(ex: BuiltinExample, locale: Locale): string {
  return ex.nameI18n[locale] ?? ex.filename;
}

export function exampleDescription(ex: BuiltinExample, locale: Locale): string {
  return ex.descriptionI18n[locale] ?? '';
}

/** Wrap sample content into a real File so plugins load it like user data. */
export function exampleToFile(ex: BuiltinExample): File {
  if (ex.contentBase64) {
    const binary = atob(ex.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], ex.filename, { type: ex.mimeType });
  }
  return new File([ex.content ?? ''], ex.filename, { type: ex.mimeType });
}