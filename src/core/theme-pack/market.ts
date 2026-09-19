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
    version: '1.1.0',
    description: 'Serif type, paper-white surfaces and a restrained ink-blue accent.',
    author: 'Ergalics Official',
    font: { family: "'Source Serif 4', 'Georgia', 'Songti SC', serif" },
    density: 'comfortable',
    chartPalette: ['#1f4e79', '#c0504d', '#9bbf30', '#f79646', '#4f81bd'],
    tokens: {
      light: {
        '--color-bg-primary': '#fbfaf7',
        '--color-bg-secondary': '#f3f0e9',
        '--color-bg-tertiary': '#eae6dc',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#f0ece3',
        '--color-bg-active': '#e2ddd0',
        '--color-text-primary': '#1c1b1a',
        '--color-text-secondary': '#5d5750',
        '--color-text-tertiary': '#7a736a',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#aca69c',
        '--color-border': '#e3ddd2',
        '--color-border-hover': '#cfc7b8',
        '--color-border-strong': '#a89f90',
        '--color-accent': '#1f4e79',
        '--color-accent-hover': '#163a5c',
        '--color-accent-active': '#10304c',
        '--color-accent-soft': 'rgba(31, 78, 121, 0.12)',
        '--color-accent-text': '#1a4d78',
      },
      dark: {
        '--color-bg-primary': '#12100d',
        '--color-bg-secondary': '#191612',
        '--color-bg-tertiary': '#211d17',
        '--color-bg-elevated': '#1c1915',
        '--color-bg-hover': '#27221a',
        '--color-bg-active': '#322b21',
        '--color-text-primary': '#ece7dd',
        '--color-text-secondary': '#b6ae9f',
        '--color-text-tertiary': '#938a79',
        '--color-text-inverse': '#12100d',
        '--color-text-disabled': '#6b6354',
        '--color-border': '#2f2a23',
        '--color-border-hover': '#474034',
        '--color-border-strong': '#6b6354',
        '--color-accent': '#7ba7cc',
        '--color-accent-hover': '#9dc0dd',
        '--color-accent-active': '#5f8fc0',
        '--color-accent-soft': 'rgba(123, 167, 204, 0.16)',
        '--color-accent-text': '#9dc0dd',
      },
    },
  };
}

function deepSpace(): CsTheme {
  return {
    id: 'deep-space',
    name: 'Deep Space',
    version: '1.3.0',
    description: 'High-contrast dark theme in nebula purple and pulsar cyan.',
    author: 'Ergalics Official',
    density: 'comfortable',
    chartPalette: ['#8b7cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'],
    tokens: {
      light: {
        '--color-bg-primary': '#f4f4fb',
        '--color-bg-secondary': '#e9e9f6',
        '--color-bg-tertiary': '#ddddf0',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#e6e6f5',
        '--color-bg-active': '#d5d5ec',
        '--color-text-primary': '#1c1b33',
        '--color-text-secondary': '#4d4b72',
        '--color-text-tertiary': '#6d6a94',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#8d8ab3',
        '--color-border': '#ddddf0',
        '--color-border-hover': '#c2c2e0',
        '--color-border-strong': '#9090bb',
        '--color-accent': '#5b4bd6',
        '--color-accent-hover': '#4636c0',
        '--color-accent-active': '#3a2bb0',
        '--color-accent-soft': 'rgba(91, 75, 214, 0.14)',
        '--color-accent-text': '#5b4bd6',
      },
      dark: {
        '--color-bg-primary': '#07070f',
        '--color-bg-secondary': '#0b0b18',
        '--color-bg-tertiary': '#111122',
        '--color-bg-elevated': '#101024',
        '--color-bg-hover': '#171730',
        '--color-bg-active': '#1e1e3d',
        '--color-text-primary': '#e8e6ff',
        '--color-text-secondary': '#a5a3c7',
        '--color-text-tertiary': '#807eab',
        '--color-text-inverse': '#07070f',
        '--color-text-disabled': '#5a5880',
        '--color-border': '#232341',
        '--color-border-hover': '#34336a',
        '--color-border-strong': '#4a4a82',
        '--color-accent': '#8b7cf6',
        '--color-accent-hover': '#a99dfb',
        '--color-accent-active': '#6f5fe8',
        '--color-accent-soft': 'rgba(139, 124, 246, 0.18)',
        '--color-accent-text': '#ada0ff',
      },
    },
  };
}

function classroomHighContrast(): CsTheme {
  return {
    id: 'classroom-high-contrast',
    name: 'Classroom High-Contrast',
    version: '1.1.0',
    description: 'Large type, bold outlines and maximum contrast.',
    author: 'Ergalics Official',
    font: { scale: 1.15 },
    density: 'comfortable',
    chartPalette: ['#0b57d0', '#d93025', '#e37400', '#137333', '#7627bb'],
    tokens: {
      light: {
        '--color-bg-primary': '#ffffff',
        '--color-bg-secondary': '#f2f2f2',
        '--color-bg-tertiary': '#e6e6e6',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#ececec',
        '--color-bg-active': '#dedede',
        '--color-text-primary': '#000000',
        '--color-text-secondary': '#1a1a1a',
        '--color-text-tertiary': '#333333',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#555555',
        '--color-border': '#000000',
        '--color-border-hover': '#333333',
        '--color-border-strong': '#000000',
        '--color-accent': '#0b57d0',
        '--color-accent-hover': '#073889',
        '--color-accent-active': '#0a4cb8',
        '--color-accent-soft': 'rgba(11, 87, 208, 0.16)',
        '--color-accent-text': '#0b57d0',
      },
      dark: {
        '--color-bg-primary': '#000000',
        '--color-bg-secondary': '#111111',
        '--color-bg-tertiary': '#1e1e1e',
        '--color-bg-elevated': '#0d0d0d',
        '--color-bg-hover': '#1f1f1f',
        '--color-bg-active': '#2e2e2e',
        '--color-text-primary': '#ffffff',
        '--color-text-secondary': '#e6e6e6',
        '--color-text-tertiary': '#c4c4c4',
        '--color-text-inverse': '#000000',
        '--color-text-disabled': '#888888',
        '--color-border': '#ffffff',
        '--color-border-hover': '#cccccc',
        '--color-border-strong': '#ffffff',
        '--color-accent': '#8ab4f8',
        '--color-accent-hover': '#b3cdfb',
        '--color-accent-active': '#6f9fe8',
        '--color-accent-soft': 'rgba(138, 180, 248, 0.18)',
        '--color-accent-text': '#b3cdfb',
      },
    },
  };
}

function labAmber(): CsTheme {
  return {
    id: 'lab-amber',
    name: 'Amber Instrument',
    version: '0.10.0',
    description: 'Amber monochrome in the spirit of vintage tube instruments.',
    author: 'community:old-console',
    density: 'compact',
    chartPalette: ['#ffb347', '#ff8c42', '#ffd166', '#c98a3b', '#ffe0b3'],
    tokens: {
      light: {
        '--color-bg-primary': '#fdf6eb',
        '--color-bg-secondary': '#faecd4',
        '--color-bg-tertiary': '#f2dfbd',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#f8e8cc',
        '--color-bg-active': '#f0d9ae',
        '--color-text-primary': '#4a3308',
        '--color-text-secondary': '#6f4e14',
        '--color-text-tertiary': '#8a6a2a',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#b3945a',
        '--color-border': '#e7d09f',
        '--color-border-hover': '#d3b878',
        '--color-border-strong': '#b3945a',
        '--color-accent': '#c07f0a',
        '--color-accent-hover': '#a86e00',
        '--color-accent-active': '#8f5e00',
        '--color-accent-soft': 'rgba(192, 127, 10, 0.14)',
        '--color-accent-text': '#a86e00',
      },
      dark: {
        '--color-bg-primary': '#0c0803',
        '--color-bg-secondary': '#140e05',
        '--color-bg-tertiary': '#1c1307',
        '--color-bg-elevated': '#171006',
        '--color-bg-hover': '#221608',
        '--color-bg-active': '#2e1e0c',
        '--color-text-primary': '#ffd9a0',
        '--color-text-secondary': '#d8a96a',
        '--color-text-tertiary': '#b98a4e',
        '--color-text-inverse': '#0c0803',
        '--color-text-disabled': '#7a5c33',
        '--color-border': '#3a2a12',
        '--color-border-hover': '#5a411d',
        '--color-border-strong': '#7a5c33',
        '--color-accent': '#ffb347',
        '--color-accent-hover': '#ffc978',
        '--color-accent-active': '#f39b28',
        '--color-accent-soft': 'rgba(255, 179, 71, 0.16)',
        '--color-accent-text': '#ffc978',
      },
    },
  };
}

function clinicalMint(): CsTheme {
  return {
    id: 'clinical-mint',
    name: 'Clinical Mint',
    version: '1.2.0',
    description: 'Fresh mint and neutral greys for long clinical data sessions.',
    author: 'community:medkit',
    density: 'comfortable',
    chartPalette: ['#0d9488', '#0369a1', '#7c3aed', '#be123c', '#ca8a04'],
    tokens: {
      light: {
        '--color-bg-primary': '#f4faf8',
        '--color-bg-secondary': '#eaf4f0',
        '--color-bg-tertiary': '#dcebe5',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#e8f3ee',
        '--color-bg-active': '#d4e8df',
        '--color-text-primary': '#0f2e28',
        '--color-text-secondary': '#3f6a5f',
        '--color-text-tertiary': '#5f8579',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#86a89e',
        '--color-border': '#c8e3dd',
        '--color-border-hover': '#b2d6ce',
        '--color-border-strong': '#8fbdb2',
        '--color-accent': '#0d9488',
        '--color-accent-hover': '#0f766e',
        '--color-accent-active': '#0f6b64',
        '--color-accent-soft': 'rgba(13, 148, 136, 0.14)',
        '--color-accent-text': '#0d9488',
      },
      dark: {
        '--color-bg-primary': '#071412',
        '--color-bg-secondary': '#0a1b18',
        '--color-bg-tertiary': '#0f2622',
        '--color-bg-elevated': '#0d1e1a',
        '--color-bg-hover': '#142b26',
        '--color-bg-active': '#1b362f',
        '--color-text-primary': '#d9f2ec',
        '--color-text-secondary': '#9fc9bf',
        '--color-text-tertiary': '#7ba89d',
        '--color-text-inverse': '#071412',
        '--color-text-disabled': '#4f746a',
        '--color-border': '#1c3a33',
        '--color-border-hover': '#2f564b',
        '--color-border-strong': '#4f746a',
        '--color-accent': '#34c4b4',
        '--color-accent-hover': '#5cd6c8',
        '--color-accent-active': '#23a696',
        '--color-accent-soft': 'rgba(52, 196, 180, 0.16)',
        '--color-accent-text': '#5cd6c8',
      },
    },
  };
}

function midnightPlot(): CsTheme {
  return {
    id: 'midnight-plot',
    name: 'Midnight Plot',
    version: '1.1.0',
    description: 'Dark theme optimized for publication preview: pure-black canvas, hairline grids.',
    author: 'Ergalics Official',
    density: 'compact',
    chartPalette: ['#4ade80', '#60a5fa', '#f87171', '#facc15', '#c084fc'],
    tokens: {
      light: {
        '--color-bg-primary': '#fafafa',
        '--color-bg-secondary': '#f0f0f0',
        '--color-bg-tertiary': '#e6e6e6',
        '--color-bg-elevated': '#ffffff',
        '--color-bg-hover': '#ececec',
        '--color-bg-active': '#dfdfdf',
        '--color-text-primary': '#111111',
        '--color-text-secondary': '#4c4c4c',
        '--color-text-tertiary': '#6e6e6e',
        '--color-text-inverse': '#ffffff',
        '--color-text-disabled': '#999999',
        '--color-border': '#d9d9d9',
        '--color-border-hover': '#bfbfbf',
        '--color-border-strong': '#999999',
        '--color-accent': '#1e9e4d',
        '--color-accent-hover': '#177f41',
        '--color-accent-active': '#146b37',
        '--color-accent-soft': 'rgba(30, 158, 77, 0.14)',
        '--color-accent-text': '#1e9e4d',
      },
      dark: {
        '--color-bg-primary': '#000000',
        '--color-bg-secondary': '#070707',
        '--color-bg-tertiary': '#111111',
        '--color-bg-elevated': '#0a0a0a',
        '--color-bg-hover': '#161616',
        '--color-bg-active': '#1f1f1f',
        '--color-text-primary': '#e5e5e5',
        '--color-text-secondary': '#9a9a9a',
        '--color-text-tertiary': '#7a7a7a',
        '--color-text-inverse': '#000000',
        '--color-text-disabled': '#555555',
        '--color-border': '#1f1f1f',
        '--color-border-hover': '#333333',
        '--color-border-strong': '#4a4a4a',
        '--color-accent': '#4ade80',
        '--color-accent-hover': '#6fe79b',
        '--color-accent-active': '#2fbf63',
        '--color-accent-soft': 'rgba(74, 222, 128, 0.16)',
        '--color-accent-text': '#6fe79b',
      },
    },
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
