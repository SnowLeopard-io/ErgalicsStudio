// ==========================================================================
// Built-in sample data (spec §5.1 "示例数据").
// Sample files live in examples/data/ and are bundled at build time via
// Vite `?raw` imports so they load instantly without a network request.
// ==========================================================================

import type { Locale } from '@/i18n/types';

import diamondXyz from '../../examples/data/diamond.xyz?raw';
import crystalXyz from '../../examples/data/crystal.xyz?raw';
import galaxyDat from '../../examples/data/galaxy.dat?raw';
import telemetryCsv from '../../examples/data/telemetry.csv?raw';
import datasetJson from '../../examples/data/dataset.json?raw';

export interface BuiltinExample {
  id: string;
  filename: string;
  format: string;
  mimeType: string;
  pluginId: string;
  content: string;
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
    pluginId: 'example.particles',
    content: telemetryCsv,
    nameI18n: {
      'zh-CN': '涡轮遥测 CSV',
      'en-US': 'Turbine Telemetry CSV',
    },
    descriptionI18n: {
      'zh-CN': '240 行时间序列（温度 / 压力 / 流量），CSV 格式检测示例。',
      'en-US': '240-row time series (temp/pressure/flow); CSV format-detection demo.',
    },
  },
  {
    id: 'json-dataset',
    filename: 'dataset.json',
    format: 'json',
    mimeType: 'application/json',
    pluginId: 'example.particles',
    content: datasetJson,
    nameI18n: {
      'zh-CN': '结构化测量数据集',
      'en-US': 'Structured Measurement JSON',
    },
    descriptionI18n: {
      'zh-CN': '带元数据与质量信息的 JSON 数据集，JSON 格式检测示例。',
      'en-US': 'JSON dataset with metadata and quality info; JSON detection demo.',
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
  return new File([ex.content], ex.filename, { type: ex.mimeType });
}