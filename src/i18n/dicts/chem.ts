// Chemistry cell & reactions plugin — module dictionary (zh-CN / en-US).
// Keys use the `chem.` prefix. Merged into the base catalogs in
// src/i18n/modules.ts.
import type { LocaleDictionary } from '../types';

export const chemZh: LocaleDictionary = {
  'chem.name': '化学晶胞与原理解析',
  'chem.desc':
    '三维化学晶胞预览（NaCl / CsCl / CaF₂ / ZnS / 金刚石 / 金属 / 干冰）并自动计算晶胞有效原子数与化学式配比；另含覆盖高中各类重要反应（氧化还原、离子反应、置换 / 分解、原电池、电解、双水解、中和、燃烧等）的分步反应原理演示。',
};

export const chemEn: LocaleDictionary = {
  'chem.name': 'Chemistry Unit Cell & Reactions',
  'chem.desc':
    '3D crystal unit-cell preview (NaCl / CsCl / CaF2 / ZnS / diamond / metals / dry-ice) with effective-atom-count analysis and formula ratio, plus step-by-step demonstrations of key high-school reactions.',
};