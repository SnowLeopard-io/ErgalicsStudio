// ==========================================================================
// FR-21 theme market — static marketplace catalog
//
// Ids are aligned with the official website catalog
// (website/src/data/themes.ts) so the two surfaces reference the same
// entries. Each item embeds a complete, schema-valid CsTheme payload, so
// "install" works fully offline; the website remains the discovery surface.
//
// The `base` hint from the website catalog maps onto the orthogonal
// light/dark design: single-set themes put their vars in tokens.common
// (they restyle whichever mode is active); the app never forces a mode.
// ==========================================================================

import type { CsTheme } from './schema';

export interface MarketThemeEntry {
  /** Website-aligned catalog id (also the CsTheme id once installed). */
  id: string;
  name: { zh: string; en: string };
  desc: { zh: string; en: string };
  author: string;
  version: string;
  tags: string[];
  downloads: number;
  /** Full theme data; validated by parseCsTheme at install time. */
  theme: CsTheme;
  /** When the entry duplicates a built-in official theme, its id. */
  officialId?: string;
}

function journalSerif(): CsTheme {
  return {
    id: 'journal-serif',
    name: 'Journal Two-Column',
    version: '1.0.0',
    description: 'Serif type, paper-white surfaces and a restrained ink-blue accent.',
    author: 'Ergalics Official',
    tokens: {
      common: {
        '--color-bg-primary': '#fbfaf7',
        '--color-bg-elevated': '#ffffff',
        '--color-text-primary': '#1c1b1a',
        '--color-accent': '#1f4e79',
        '--color-accent-hover': '#163a5c',
        '--font-sans': "'Source Serif 4', 'Georgia', 'Songti SC', serif",
      },
    },
    density: 'comfortable',
    chartPalette: ['#1f4e79', '#c0504d', '#9bbf30', '#f79646', '#4f81bd'],
  };
}

function deepSpace(): CsTheme {
  return {
    id: 'deep-space',
    name: 'Deep Space',
    version: '1.2.0',
    description: 'High-contrast dark theme in nebula purple and pulsar cyan.',
    author: 'Ergalics Official',
    tokens: {
      common: {
        '--color-bg-primary': '#07070f',
        '--color-bg-elevated': '#101024',
        '--color-accent': '#8b7cf6',
        '--color-accent-hover': '#a99dfb',
        '--color-text-secondary': '#a5a3c7',
      },
    },
    density: 'comfortable',
    chartPalette: ['#8b7cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'],
  };
}

function classroomHighContrast(): CsTheme {
  return {
    id: 'classroom-high-contrast',
    name: 'Classroom High-Contrast',
    version: '1.0.1',
    description: 'Large type, bold outlines and maximum contrast.',
    author: 'Ergalics Official',
    tokens: {
      common: {
        '--color-bg-primary': '#ffffff',
        '--color-text-primary': '#000000',
        '--color-border': '#000000',
        '--color-accent': '#0b57d0',
        '--font-size-base': '15.5px',
      },
    },
    density: 'comfortable',
    chartPalette: ['#0b57d0', '#d93025', '#e37400', '#137333', '#7627bb'],
  };
}

function labAmber(): CsTheme {
  return {
    id: 'lab-amber',
    name: 'Amber Instrument',
    version: '0.9.0',
    description: 'Amber monochrome in the spirit of vintage tube instruments.',
    author: 'community:old-console',
    tokens: {
      common: {
        '--color-bg-primary': '#0c0803',
        '--color-bg-elevated': '#171006',
        '--color-accent': '#ffb347',
        '--color-accent-hover': '#ffc978',
        '--color-text-primary': '#ffd9a0',
      },
    },
    density: 'compact',
    chartPalette: ['#ffb347', '#ff8c42', '#ffd166', '#c98a3b', '#ffe0b3'],
  };
}

function clinicalMint(): CsTheme {
  return {
    id: 'clinical-mint',
    name: 'Clinical Mint',
    version: '1.1.0',
    description: 'Fresh mint and neutral greys for long clinical data sessions.',
    author: 'community:medkit',
    tokens: {
      common: {
        '--color-bg-primary': '#f4faf8',
        '--color-accent': '#0d9488',
        '--color-accent-hover': '#0f766e',
        '--color-border': '#c8e3dd',
      },
    },
    density: 'comfortable',
    chartPalette: ['#0d9488', '#0369a1', '#7c3aed', '#be123c', '#ca8a04'],
  };
}

function midnightPlot(): CsTheme {
  return {
    id: 'midnight-plot',
    name: 'Midnight Plot',
    version: '1.0.0',
    description: 'Dark theme optimized for publication preview: pure-black canvas, hairline grids.',
    author: 'Ergalics Official',
    tokens: {
      common: {
        '--color-bg-primary': '#000000',
        '--color-bg-elevated': '#0a0a0a',
        '--color-accent': '#4ade80',
        '--color-border': '#1f1f1f',
      },
    },
    density: 'compact',
    chartPalette: ['#4ade80', '#60a5fa', '#f87171', '#facc15', '#c084fc'],
  };
}

export const MARKET_THEMES: readonly MarketThemeEntry[] = Object.freeze([
  {
    id: 'journal-serif',
    name: { zh: '期刊双栏', en: 'Journal Two-Column' },
    desc: {
      zh: '衬线字体、纸白底色与克制的蓝墨强调色，为长时间撰写与审稿设计。',
      en: 'Serif type, paper-white surfaces and a restrained ink-blue accent — built for long writing and reviewing sessions.',
    },
    author: 'Ergalics Official',
    version: '1.0.0',
    tags: ['academic', 'serif', 'light'],
    downloads: 1284,
    theme: journalSerif(),
    officialId: 'journal',
  },
  {
    id: 'deep-space',
    name: { zh: '深空观测', en: 'Deep Space' },
    desc: {
      zh: '星云紫与脉冲青的高对比暗色主题，为暗室中的天文与信号工作调校。',
      en: 'High-contrast dark theme in nebula purple and pulsar cyan, tuned for dark-room astronomy and signal work.',
    },
    author: 'Ergalics Official',
    version: '1.2.0',
    tags: ['dark', 'astronomy', 'high-contrast'],
    downloads: 2431,
    theme: deepSpace(),
  },
  {
    id: 'classroom-high-contrast',
    name: { zh: '教室高对比', en: 'Classroom High-Contrast' },
    desc: {
      zh: '大字号、粗描边与最大化对比度，适合投影授课与无障碍场景。',
      en: 'Large type, bold outlines and maximum contrast — made for projector teaching and accessibility.',
    },
    author: 'Ergalics Official',
    version: '1.0.1',
    tags: ['education', 'a11y', 'high-contrast'],
    downloads: 876,
    theme: classroomHighContrast(),
    officialId: 'edu',
  },
  {
    id: 'lab-amber',
    name: { zh: '琥珀仪表', en: 'Amber Instrument' },
    desc: {
      zh: '复古真空管仪表盘的琥珀单色显，长时监控与低光环境友好。',
      en: 'Amber monochrome in the spirit of vintage tube instruments — easy on the eyes in low light.',
    },
    author: 'community:old-console',
    version: '0.9.0',
    tags: ['retro', 'dark', 'mono'],
    downloads: 542,
    theme: labAmber(),
  },
  {
    id: 'clinical-mint',
    name: { zh: '临床薄荷', en: 'Clinical Mint' },
    desc: {
      zh: '清爽的薄荷绿与中性灰，医学与生信数据的长时间浏览不疲劳。',
      en: 'Fresh mint and neutral greys for long sessions over clinical and bioinformatics data.',
    },
    author: 'community:medkit',
    version: '1.1.0',
    tags: ['medical', 'light', 'calm'],
    downloads: 1102,
    theme: clinicalMint(),
  },
  {
    id: 'midnight-plot',
    name: { zh: '午夜制图', en: 'Midnight Plot' },
    desc: {
      zh: '为出版级图表预览优化的暗色主题：画布纯黑、网格线极细，所见即所得。',
      en: 'A dark theme optimized for publication preview: pure-black canvas, hairline grids, WYSIWYG.',
    },
    author: 'Ergalics Official',
    version: '1.0.0',
    tags: ['dark', 'figures', 'compact'],
    downloads: 1893,
    theme: midnightPlot(),
  },
]);

export function findMarketEntry(id: string): MarketThemeEntry | undefined {
  return MARKET_THEMES.find((e) => e.id === id);
}

/**
 * Deep link to the website theme page (reverse of website/src/studio-link.ts:
 * the site lives one directory above the deployed workstation, both use
 * HashRouter). Pure string builder — the UI renders it as an <a href>.
 */
export function websiteThemeLink(id?: string): string {
  const hash = id ? `#/themes?theme=${encodeURIComponent(id)}` : '#/themes';
  return `../${hash}`;
}
