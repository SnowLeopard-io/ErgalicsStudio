import { defineConfig } from 'vitepress';

// Base path strategy (absolute only — a relative base breaks deep-page
// navigation, producing nested-URL loops like /guide/guide/guide/...):
// - dev: "/" (vite dev server sets NODE_ENV=development)
// - embedded in the main app: DOCS_BASE, set by scripts/build-docs.mjs.
//   Defaults to "/docs/" (domain-root deploy / local preview); the GitHub
//   Pages workflow overrides it to "/<repo>/docs/" to match the real path.
// - standalone docs deploy (e.g. GitHub Pages): "/ErgalicsStudio/" (default)
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
    server: {
      // Fixed port so the website's docs-links and the studio's site-links
      // (both hard-code 5175 in dev) always reach this docs server, even when
      // the studio (5173) and website (5174) are running at the same time.
      port: 5175,
      strictPort: true,
    },
    build: {
      // VitePress runs two builds (SSR + client) and would empty outDir
      // between them; keep it disabled so sandboxed build tooling that
      // blocks recursive deletes works. Output is content-hashed and
      // overwritten, so leftovers are harmless.
      emptyOutDir: false,
    },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0e9384' }],
    ['link', { rel: 'icon', href: `${base}ico.ico` }],
  ],
  themeConfig: {
    // Brand mark: use the site-wide favicon ico. Leading-slash so VitePress's
    // withBase() resolves it to `${base}ico.ico`, which exists in the docs
    // public folder and is byte-identical to the root brand ico — so it renders
    // on every page (home AND deep pages), unlike a relative "logo.svg" that
    // resolved against the page directory and 404'd off the home page.
    logo: '/ico.ico',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Plugins', link: '/guide/plugins' },
      { text: 'SDK', link: '/sdk/v1-contract' },
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
          { text: 'Flow Mode', link: '/guide/flow-mode' },
          { text: 'Block Mode', link: '/guide/block-mode' },
          { text: 'Plugin Development', link: '/guide/plugins' },
          { text: 'Native Core & WebGPU', link: '/guide/native-core' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'Roadmap & Status', link: '/guide/roadmap' },
        ],
      },
      {
        text: 'Plugin SDK (v1)',
        items: [
          { text: 'SDK v1 Contract', link: '/sdk/v1-contract' },
          { text: 'Migration v0 → v1', link: '/sdk/migration' },
          {
            text: 'Starter Template',
            link: 'https://github.com/SnowLeopard-io/ErgalicsStudio/tree/main/templates/plugin-starter',
          },
        ],
      },
    ],
    outline: { level: [2, 3] },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SnowLeopard-io/ErgalicsStudio' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 SnowLeopard-io',
    },
  },
});
