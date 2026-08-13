import { defineConfig } from 'vitepress';

// Relative base so the site works both as an independent deployment and
// when copied under the main app's dist/docs/.
// Base path strategy:
// - dev: absolute "/" — relative bases confuse the dev server and cause
//   nested-URL loops (e.g. /guide/guide/guide/...).
// - build: relative "./" — so the site also works when copied under the
//   main app's dist/docs/ (VitePress resolves relative links correctly in
//   the static output).
const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  title: 'Ergalics Studio',
  description: 'Browser-based scientific computing workstation — docs',
  lang: 'en-US',
  base: isDev ? '/' : './',
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
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
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
