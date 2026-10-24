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
  {
    id: 'colorblind-safe',
    name: { zh: '色盲友好', en: 'CVD-Safe' },
    desc: {
      zh: '基于 Okabe–Ito 色盲安全色板：蓝、橙、绿、黄在各类色觉障碍下保持稳定区分，状态色避开红绿混淆，界面为中性石墨底色。',
      en: 'Built on the Okabe–Ito colorblind-safe palette: blue, orange, green and yellow stay distinguishable under protanopia, deuteranopia and tritanopia; status colors avoid the red/green trap on a neutral graphite UI.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'light', density: 'comfortable',
    downloads: 658, tags: ['a11y', 'colorblind-safe', 'high-contrast'],
    vars: {
      '--color-bg-primary': '#f7f8fa',
      '--color-bg-elevated': '#ffffff',
      '--color-text-primary': '#10151b',
      '--color-accent': '#0072B2',
      '--color-accent-hover': '#005A8E',
      '--color-canvas': '#fbfcfd',
    },
    chartPalette: ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#CC79A7', '#56B4E9'],
  },
  {
    id: 'blueprint',
    name: { zh: '蓝图制图', en: 'Blueprint' },
    desc: {
      zh: '工程蓝图风：深普鲁士蓝晒图纸底、白色墨线与高饱和记号笔强调色，适合晶胞、地形等 3D 几何与网格检视。',
      en: 'Engineering blueprint: deep prussian drafting film, white ink linework and high-saturation marker accents — tuned for 3D geometry and mesh inspection.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'dark', density: 'compact',
    downloads: 1204, tags: ['dark', 'engineering', 'figures'],
    vars: {
      '--color-bg-primary': '#0e3253',
      '--color-bg-elevated': '#103a60',
      '--color-text-primary': '#dbeeff',
      '--color-accent': '#8fd0ff',
      '--color-accent-hover': '#b4e2ff',
      '--color-border': '#2a618f',
    },
    chartPalette: ['#FFD166', '#EF476F', '#06D6A0', '#4CC9F0', '#F78C6B'],
  },
  {
    id: 'field-notes',
    name: { zh: '野外手记', en: 'Field Notes' },
    desc: {
      zh: '牛皮纸野外笔记本：米黄纸底、墨棕文字与苔绿强调，为地理、地形与轨迹数据的野外录入设计。',
      en: 'Kraft-paper field notebook: straw paper, ink-brown text and moss-green accents for geography, terrain and track data collected in the field.',
    },
    author: 'community:fieldbook', version: '0.9.0', base: 'light', density: 'comfortable',
    downloads: 389, tags: ['light', 'fieldwork', 'geo'],
    vars: {
      '--color-bg-primary': '#f6f1e4',
      '--color-bg-elevated': '#fbf8ef',
      '--color-text-primary': '#3b3222',
      '--color-accent': '#5c7a3f',
      '--color-accent-hover': '#4a6432',
      '--color-border': '#ddd2b6',
    },
    chartPalette: ['#6b8f3e', '#b5651d', '#3d6b8e', '#a8763e', '#7d5ba6'],
  },
  {
    id: 'chalkboard',
    name: { zh: '黑板课堂', en: 'Chalkboard' },
    desc: {
      zh: '墨绿黑板与粉笔白文字，粉笔色系强调色与放大字号，为教室投影与课程模式调校。',
      en: 'Deep board green with chalk-white text, pastel chalk accents and slightly enlarged type — tuned for classroom projection and course mode.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'dark', density: 'comfortable',
    downloads: 763, tags: ['dark', 'education', 'projector'],
    vars: {
      '--color-bg-primary': '#1f3b30',
      '--color-bg-elevated': '#224538',
      '--color-text-primary': '#f1efe6',
      '--color-accent': '#f7d774',
      '--color-accent-hover': '#fbe49b',
      '--color-text-secondary': '#c2cfc2',
    },
    chartPalette: ['#f7d774', '#9fd8ef', '#f4a6a1', '#a8d5a2', '#c9b6e4'],
  },
  {
    id: 'e-ink',
    name: { zh: '电子墨水', en: 'E-Ink Paper' },
    desc: {
      zh: '近零彩度的纸面界面：灰阶层级取代彩色强调，状态色保持最低限度可辨识，长时间读报告不疲劳，图表为印刷友好的灰阶色带。',
      en: 'A near-zero chroma paper UI: grayscale hierarchy replaces color accents, status colors stay minimally identifiable, and charts ship a print-friendly grayscale ramp.',
    },
    author: 'community:paperlike', version: '1.0.0', base: 'light', density: 'comfortable',
    downloads: 641, tags: ['light', 'reading', 'low-strain'],
    vars: {
      '--color-bg-primary': '#f4f4f1',
      '--color-bg-elevated': '#fbfbf9',
      '--color-text-primary': '#1c1c1a',
      '--color-accent': '#3a3a38',
      '--color-accent-hover': '#2b2b29',
      '--color-border': '#d6d6d2',
    },
    chartPalette: ['#111111', '#6e6e6e', '#a8a8a8', '#3a3a3a', '#8c8c8c'],
  },
  {
    id: 'abyssal',
    name: { zh: '深海探测', en: 'Abyssal' },
    desc: {
      zh: '深渊海军蓝底色与生物荧光青强调，比深空更冷、更中性，为海洋与水流类插件的沉浸式工作调校。',
      en: 'Abyssal navy with bioluminescent teal accents — darker and cooler than Deep Space, tuned for immersive ocean and flow work.',
    },
    author: 'Ergalics Official', version: '1.0.0', base: 'dark', density: 'comfortable',
    downloads: 957, tags: ['dark', 'ocean', 'immersive'],
    vars: {
      '--color-bg-primary': '#04121f',
      '--color-bg-elevated': '#071d30',
      '--color-text-primary': '#d7ecf5',
      '--color-accent': '#2dd4bf',
      '--color-accent-hover': '#5ee2d0',
      '--color-text-secondary': '#8fb5c6',
    },
    chartPalette: ['#22d3ee', '#2dd4bf', '#a3e635', '#f472b6', '#fbbf24'],
  },
  {
    id: 'warm-terminal',
    name: { zh: '暖沙夜航', en: 'Warm Terminal' },
    desc: {
      zh: '低蓝光暖棕灰终端底与橘红强调，区别于琥珀单色仪表：保留全彩图表色系，夜间多序列绘图依然可读。',
      en: 'Low-blue-light brown-grey shell with a tangerine accent — unlike mono Amber Instrument it keeps a full-color chart palette for multi-series night sessions.',
    },
    author: 'community:lowlight', version: '0.8.0', base: 'dark', density: 'compact',
    downloads: 285, tags: ['dark', 'warm', 'low-blue-light'],
    vars: {
      '--color-bg-primary': '#1b1410',
      '--color-bg-elevated': '#201812',
      '--color-text-primary': '#f0e6d8',
      '--color-accent': '#fb923c',
      '--color-accent-hover': '#ffab63',
      '--color-text-secondary': '#c0b0a0',
    },
    chartPalette: ['#fb923c', '#facc15', '#e87461', '#7dd3fc', '#c4b5fd'],
  },
];
