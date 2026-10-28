// ==========================================================================
// fx.stars — night-sky star renderer (manifest).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const starsManifest: PluginManifest = {
  id: 'fx.stars',
  name: 'Starfield · Night Sky',
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Procedural starfield with a real galactic-plane Milky Way, sidereal rotation (GMST), Bortle light-pollution model, moonlight wash, scintillation and Poisson meteors.',
  nameI18n: {
    'zh-CN': '星空 · 夜天渲染器',
    'en-US': 'Starfield · Night Sky',
  },
  descriptionI18n: {
    'zh-CN':
      '程序化星点 + 真实银道面银河带 + 恒星周日运动（GMST 斗转星移）：Bortle 光污染模型（天顶亮度/极限星等参考表）、月光冲淡、视宁度闪烁与泊松流星。银极/银心方向由真实赤经赤纬换算。',
    'en-US':
      'Procedural stars + a real galactic-plane Milky Way + sidereal rotation (GMST): Bortle light-pollution model (sky-brightness/limiting-magnitude reference tables), moonlight wash, seeing scintillation and Poisson meteors. Galactic pole/center from true RA/Dec.',
  },
  license: 'MIT',
  entry: 'fx.stars',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { angle: '°', time: 'h' },
    reproducible: true,
    notes:
      'Star positions are procedural (cell-hashed shells), not a star catalogue. The Milky-Way band is anchored on the J2000 galactic pole (RA 192.86°, Dec +27.13°) and center (RA 266.41°, Dec −29.01°) transformed through the Meeus ephemeris horizontal frame. Sky brightness / limiting magnitude follow the Bortle (2001) reference tables; the whole-sky count uses N(m) ≈ 9096·e^((m−6.5)/1.35). Meteors are a Poisson process with exponential inter-arrival gaps (deterministic seeded stream).',
    notesI18n: {
      'zh-CN':
        '星点为程序化（壳层哈希），非星表。银河带锚定 J2000 银极（RA 192.86°, Dec +27.13°）与银心（RA 266.41°, Dec −29.01°），经 Meeus 历表地平坐标变换。天顶亮度/极限星等按 Bortle (2001) 参考表；全天可见星数用 N(m) ≈ 9096·e^((m−6.5)/1.35)。流星为泊松过程（指数间隔，种子确定性流）。',
      'en-US':
        'Star positions are procedural (cell-hashed shells), not a catalogue. The Milky-Way band anchors on the J2000 galactic pole (RA 192.86°, Dec +27.13°) and center (RA 266.41°, Dec −29.01°) via the Meeus horizontal frame. Sky brightness / limiting magnitude from the Bortle (2001) tables; whole-sky count N(m) ≈ 9096·e^((m−6.5)/1.35). Meteors: Poisson process, exponential gaps, deterministic seeded stream.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'Scene preset (site, Bortle, sky)' }],
};
