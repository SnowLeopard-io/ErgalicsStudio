// ==========================================================================
// Water quality (GB 3838-2002) — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const waterManifest: PluginManifest = {
  id: 'example.env-water',
  name: 'Water Quality',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Classifies surface-water samples into GB 3838-2002 classes Ⅰ–Ⅴ with a radar chart.',
  nameI18n: {
    'zh-CN': '水质评价（地表水分类）',
    'en-US': 'Water Quality',
  },
  descriptionI18n: {
    'zh-CN': '载入水样指标表（pH、溶解氧、高锰酸盐指数、BOD₅、氨氮、总磷），按《地表水环境质量标准》（GB 3838-2002）将每项指标归类 Ⅰ–Ⅴ 类，单因子法取最差类别给出综合判定，绘制实测值相对限值的雷达图，超标项以语义色标出；可选输出加权算术 WQI 指数供横向比较。',
    'en-US': 'Load a water-sample sheet (pH, DO, permanganate COD, BOD₅, NH₃-N, TP) and classify each indicator into GB 3838-2002 classes Ⅰ–Ⅴ; the single-factor worst class gives the overall verdict, with a limit-relative radar chart and optional weighted-arithmetic WQI.',
  },
  license: 'MIT',
  entry: 'example.env-water',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'site,ph,do,cod,bod,nh3_n,tp rows' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'site,ph,do,cod,bod,nh3_n,tp rows' },
  ],
};
