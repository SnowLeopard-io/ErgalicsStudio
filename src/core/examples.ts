// ==========================================================================
// Built-in sample data (spec §5.1 "示例数据").
// Sample files live in examples/data/ and are bundled at build time via
// Vite `?raw` imports so they load instantly without a network request.
// Binary assets (e.g. images) are embedded as base64 (see exampleAssets.ts).
// ==========================================================================

import type { Locale } from '@/i18n/types';

import diamondXyz from '../../examples/data/diamond.xyz?raw';
import crystalXyz from '../../examples/data/crystal.xyz?raw';
import galaxyDat from '../../examples/data/galaxy.dat?raw';
import telemetryCsv from '../../examples/data/telemetry.csv?raw';
import datasetJson from '../../examples/data/dataset.json?raw';
import distributionDat from '../../examples/data/distribution.dat?raw';
import fieldJson from '../../examples/data/field.json?raw';
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
      'zh-CN': '3000 个粒子的四列数据（位置 + 速度），驱动粒子模拟。',
      'en-US': '3000-particle 4-column data (position + velocity) for particle simulation.',
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