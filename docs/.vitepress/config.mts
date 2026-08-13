import { defineConfig } from 'vitepress';

// Base path strategy (absolute only — a relative base breaks deep-page
// navigation, producing nested-URL loops like /guide/guide/guide/...):
// - dev: "/"
// - embedded into the main app: "/docs/" (set via DOCS_BASE in
//   scripts/build-docs.mjs)
// - standalone deploy (e.g. GitHub Pages): "/ErgalicsStudio/" (default)
const isDev = process.env.NODE_ENV === 'development';
const base = process.env.DOCS_BASE ?? (isDev ? '/' : '/ErgalicsStudio/');

export default defineConfig({
  title: 'Ergalics Studio',
  description: 'Browser-based scientific computing workstation — docs',
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,
  vite: {
    build: {
      // VitePress runs two builds (SSR + client) and would empty outDir
      // between them; keep it disabled so sandboxed build tooling that
      // blocks recursive deletes works. Output is content-hashed and
      // overwritten, so leftovers are harmless.
      emptyOutDir: false,
    },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0d9488' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Plugins', link: '/guide/plugins' },
      { text: 'Roadmap', link: '/guide/roadmap' },
      {
        text: 'GitHub',
        link: 'https://github.com/SnowLeopard-io/ErgalicsStudio',
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'Plugin Development', link: '/guide/plugins' },
          { text: 'Native Core & WebGPU', link: '/guide/native-core' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'Roadmap & Status', link: '/guide/roadmap' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SnowLeopard-io/ErgalicsStudio' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Ergalics Studio contributors',
    },
  },
});
