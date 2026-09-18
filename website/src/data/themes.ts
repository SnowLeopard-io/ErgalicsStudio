export interface ThemePackage {
  id: string;
  name: { zh: string; en: string };
  desc: { zh: string; en: string };
  author: string;
  version: string;
  base: 'dark' | 'light';
  /** CSS custom-property overrides the theme package ships. */
  vars: Record<string, string>;
  /** Chart palette that ships with the theme. */
  chartPalette: string[];
  density: 'comfortable' | 'compact';
  downloads: number;
  tags: string[];
}

export const THEMES: ThemePackage[] = [
  {
    id: 'journal-serif',
    name: { zh: '期刊双栏', en: 'Journal Two-Column' },
    desc: {
      zh: '衬线字体、纸白底色与克制的蓝墨强调色，为长时间撰写与审稿设计。',
      en: 'Serif type, paper-white surfaces and a restrained ink-blue accent — built for long writing and reviewing sessions.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'light', density: 'comfortable',
    downloads: 1284, tags: ['academic', 'serif', 'light'],
    vars: {
      '--color-bg-primary': '#fbfaf7',
      '--color-bg-elevated': '#ffffff',
      '--color-text-primary': '#1c1b1a',
      '--color-accent': '#1f4e79',
      '--color-accent-hover': '#163a5c',
      '--font-sans': "'Source Serif 4', Georgia, 'Songti SC', serif",
    },
    chartPalette: ['#1f4e79', '#c0504d', '#9bbf30', '#f79646', '#4f81bd'],
  },
  {
    id: 'deep-space',
    name: { zh: '深空观测', en: 'Deep Space' },
    desc: {
      zh: '星云紫与脉冲青的高对比暗色主题，为暗室中的天文与信号工作调校。',
      en: 'High-contrast dark theme in nebula purple and pulsar cyan, tuned for dark-room astronomy and signal work.',
    },
    author: 'Ergalics Official', version: '1.2.0', base: 'dark', density: 'comfortable',
    downloads: 2431, tags: ['dark', 'astronomy', 'high-contrast'],
    vars: {
      '--color-bg-primary': '#07070f',
      '--color-bg-elevated': '#101024',
      '--color-accent': '#8b7cf6',
      '--color-accent-hover': '#a99dfb',
      '--color-text-secondary': '#a5a3c7',
    },
    chartPalette: ['#8b7cf6', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'],
  },
  {
    id: 'classroom-high-contrast',
    name: { zh: '教室高对比', en: 'Classroom High-Contrast' },
    desc: {
      zh: '大字号、粗描边与最大化对比度，适合投影授课与无障碍场景。',
      en: 'Large type, bold outlines and maximum contrast — made for projector teaching and accessibility.',
    },
    author: 'Ergalics Official', version: '1.0.1', base: 'light', density: 'comfortable',
    downloads: 876, tags: ['education', 'a11y', 'high-contrast'],
    vars: {
      '--color-bg-primary': '#ffffff',
      '--color-text-primary': '#000000',
      '--color-border': '#000000',
      '--color-accent': '#0b57d0',
      '--font-size-base': '15.5px',
    },
    chartPalette: ['#0b57d0', '#d93025', '#e37400', '#137333', '#7627bb'],
  },
  {
    id: 'lab-amber',
    name: { zh: '琥珀仪表', en: 'Amber Instrument' },
    desc: {
      zh: '复古真空管仪表盘的琥珀单色显，长时监控与低光环境友好。',
      en: 'Amber monochrome in the spirit of vintage tube instruments — easy on the eyes in low light.',
    },
    author: 'community:old-console', version: '0.9.0', base: 'dark', density: 'compact',
    downloads: 542, tags: ['retro', 'dark', 'mono'],
    vars: {
      '--color-bg-primary': '#0c0803',
      '--color-bg-elevated': '#171006',
      '--color-accent': '#ffb347',
      '--color-accent-hover': '#ffc978',
      '--color-text-primary': '#ffd9a0',
    },
    chartPalette: ['#ffb347', '#ff8c42', '#ffd166', '#c98a3b', '#ffe0b3'],
  },
  {
    id: 'clinical-mint',
    name: { zh: '临床薄荷', en: 'Clinical Mint' },
    desc: {
      zh: '清爽的薄荷绿与中性灰，医学与生信数据的长时间浏览不疲劳。',
      en: 'Fresh mint and neutral greys for long sessions over clinical and bioinformatics data.',
    },
    author: 'community:medkit', version: '1.1.0', base: 'light', density: 'comfortable',
    downloads: 1102, tags: ['medical', 'light', 'calm'],
    vars: {
      '--color-bg-primary': '#f4faf8',
      '--color-accent': '#0d9488',
      '--color-accent-hover': '#0f766e',
      '--color-border': '#c8e3dd',
    },
    chartPalette: ['#0d9488', '#0369a1', '#7c3aed', '#be123c', '#ca8a04'],
  },
  {
    id: 'midnight-plot',
    name: { zh: '午夜制图', en: 'Midnight Plot' },
    desc: {
      zh: '为出版级图表预览优化的暗色主题：画布纯黑、网格线极细，所见即所得。',
      en: 'A dark theme optimized for publication preview: pure-black canvas, hairline grids, WYSIWYG.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'dark', density: 'compact',
    downloads: 1893, tags: ['dark', 'figures', 'compact'],
    vars: {
      '--color-bg-primary': '#000000',
      '--color-bg-elevated': '#0a0a0a',
      '--color-accent': '#4ade80',
      '--color-border': '#1f1f1f',
    },
    chartPalette: ['#4ade80', '#60a5fa', '#f87171', '#facc15', '#c084fc'],
  },
];
