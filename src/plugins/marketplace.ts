// ==========================================================================
// Plugin marketplace catalog (spec §6.5)
//
// The "插件市场" tab in the plugin dialog renders this curated catalog. Items
// whose `builtin` id resolves to a bundled plugin can be installed directly;
// items without one are shown as "coming soon" community submissions to
// demonstrate the marketplace curation concept.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';
import { BUILTIN_PLUGINS } from './builtin';

export type MarketCategory = 'scientific' | 'fun' | 'utility';

export interface MarketItem {
  /** Manifest drives name / description / icon / author / version display. */
  manifest: PluginManifest;
  category: MarketCategory;
  /** Curated discovery tags. */
  tags: string[];
  /** Demo popularity score 0-100 (standing in for download counts). */
  popularity: number;
  /**
   * Builtin plugin id this market entry installs. When absent the item is a
   * community submission not yet bundled — rendered as "coming soon".
   */
  builtin?: string;
  /** Optional localization note shown under the description (e.g. source). */
  noteI18n?: Record<string, string>;
}

interface Overlay {
  category?: MarketCategory;
  tags: string[];
  popularity: number;
  noteI18n?: Record<string, string>;
}

// Curated presentation metadata keyed by plugin id. Anything not listed keeps
// its manifest `category` (defaulting to 'scientific') with neutral tags.
const OVERLAY: Record<string, Overlay> = {
  'fun.mandelbrot': { category: 'fun', tags: ['fractal', 'math', 'canvas'], popularity: 72 },
  'fun.spirograph': { category: 'fun', tags: ['art', 'curve', 'canvas'], popularity: 64 },
  'fun.lissajous': { category: 'fun', tags: ['art', 'animation', 'curve'], popularity: 58 },
  'fun.life': { category: 'fun', tags: ['automaton', 'simulation', 'toy'], popularity: 81 },
  'fun.harmonograph': { category: 'fun', tags: ['art', 'curve', 'music'], popularity: 49 },
  'fun.palette': { category: 'utility', tags: ['color', 'design', 'gradient'], popularity: 55 },
  'fun.koch': { category: 'fun', tags: ['fractal', 'geometry', 'art'], popularity: 61 },
  'fun.barnsley': { category: 'fun', tags: ['fractal', 'ifs', 'art'], popularity: 57 },
  'fun.fireworks': { category: 'fun', tags: ['particles', 'animation', 'toy'], popularity: 74 },
  'fun.truchet': { category: 'fun', tags: ['pattern', 'tiles', 'art'], popularity: 46 },
  'example.errorband': { category: 'scientific', tags: ['plot', 'statistics', 'uncertainty'], popularity: 70 },
  'example.treemap': { category: 'scientific', tags: ['hierarchy', 'layout'], popularity: 66 },
  'example.qqplot': { category: 'scientific', tags: ['statistics', 'normality'], popularity: 62 },
  'example.scatter': { category: 'scientific', tags: ['plot', '2d'], popularity: 90 },
  'example.nbody': { category: 'scientific', tags: ['physics', 'simulation', 'gpu'], popularity: 76 },
  'example.contour': { category: 'scientific', tags: ['field', 'math'], popularity: 68 },
};

// Community submissions not yet bundled — shown as "coming soon".
const COMMUNITY_ITEMS: MarketItem[] = [
  {
    manifest: {
      id: 'community.wordcloud',
      name: 'Word Cloud',
      nameI18n: { 'zh-CN': '词云', 'en-US': 'Word Cloud' },
      version: '0.9.0',
      author: 'community',
      description: 'Generate a word cloud from pasted text.',
      descriptionI18n: {
        'zh-CN': '从粘贴的文本生成词云。',
        'en-US': 'Generate a word cloud from pasted text.',
      },
      license: 'MIT',
      entry: 'community.wordcloud',
      category: 'fun',
      icon: '☁',
    },
    category: 'fun',
    tags: ['text', 'nlp', 'art'],
    popularity: 0,
  },
  {
    manifest: {
      id: 'community.audio',
      name: 'Audio Visualizer',
      nameI18n: { 'zh-CN': '音频可视化', 'en-US': 'Audio Visualizer' },
      version: '0.8.0',
      author: 'community',
      description: 'Real-time spectrum from the microphone input.',
      descriptionI18n: {
        'zh-CN': '来自麦克风输入的实时频谱。',
        'en-US': 'Real-time spectrum from the microphone input.',
      },
      license: 'MIT',
      entry: 'community.audio',
      category: 'fun',
      icon: '◀',
    },
    category: 'fun',
    tags: ['audio', 'realtime', 'canvas'],
    popularity: 0,
  },
];

export const MARKETPLACE_CATALOG: MarketItem[] = [
  ...BUILTIN_PLUGINS.map((info): MarketItem => {
    const ov = OVERLAY[info.manifest.id];
    return {
      manifest: info.manifest,
      category: ov?.category ?? info.manifest.category ?? 'scientific',
      tags: ov?.tags ?? [],
      popularity: ov?.popularity ?? 50,
      builtin: info.manifest.id,
      noteI18n: ov?.noteI18n,
    };
  }),
  ...COMMUNITY_ITEMS,
];

export const MARKET_CATEGORIES: MarketCategory[] = ['scientific', 'fun', 'utility'];
