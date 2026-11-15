import { defineConfig } from 'vitepress';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  lang: 'en',
  base,
  cleanUrls: true,
  lastUpdated: true,
  transformPageData(pageData) {
    const path = pageData.relativePath;
    const chinese = path.startsWith('zh-CN/');
    const counterpart = chinese ? path.slice('zh-CN/'.length) : `zh-CN/${path}`;
    if (existsSync(fileURLToPath(new URL(`../${counterpart}`, import.meta.url)))) {
      pageData.frontmatter.translationPath = '/' + counterpart
        .replace(/(^|\/)index\.md$/, '$1')
        .replace(/\.md$/, '');
    }
  },
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
    ssr: {
      // VitePress 2's SSR bundle externalizes `vue/server-renderer` as a
      // resolved directory path, which Node's ESM loader rejects
      // (ERR_UNSUPPORTED_DIR_IMPORT). Bundling the whole SSR graph keeps the
      // generated entry self-contained and sidesteps the resolution rule.
      noExternal: true,
    },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0e9384' }],
    ['link', { rel: 'icon', href: `${base}ico.ico` }],
  ],
  locales: {
    root: { label: 'English', lang: 'en' },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      description: '基于浏览器的科学计算工作站 — 文档',
      themeConfig: {
        // Untranslated pages remain available in their original language.
        // Use locale home pages until every corresponding page exists.
        i18nRouting: false,
        langMenuLabel: '切换语言',
        sidebarMenuLabel: '目录',
        returnToTopLabel: '返回顶部',
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色主题',
        darkModeSwitchTitle: '切换到深色主题',
        skipToContentLabel: '跳转到正文',
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一篇', next: '下一篇' },
        lastUpdated: { text: '最后更新于' },
        nav: [
          { text: '指南', link: '/zh-CN/guide/introduction' },
          { text: '插件', link: '/zh-CN/guide/plugins' },
          { text: 'SDK', link: '/zh-CN/sdk/v1-contract' },
          { text: '路线图', link: '/zh-CN/guide/roadmap' },
          { text: 'GitHub', link: 'https://github.com/SnowLeopard-io/ErgalicsStudio' },
        ],
        sidebar: [
          {
            text: '指南',
            items: [
              { text: '简介', link: '/zh-CN/guide/introduction' },
              { text: '快速开始', link: '/zh-CN/guide/getting-started' },
              { text: '架构', link: '/zh-CN/guide/architecture' },
              { text: '流程模式', link: '/zh-CN/guide/flow-mode' },
              { text: '积木模式', link: '/zh-CN/guide/block-mode' },
              { text: '插件开发', link: '/zh-CN/guide/plugins' },
              { text: '原生核心与 WebGPU', link: '/zh-CN/guide/native-core' },
              { text: '测试', link: '/zh-CN/guide/testing' },
              { text: '路线图与状态', link: '/zh-CN/guide/roadmap' },
            ],
          },
          {
            text: '插件 SDK（v1）',
            items: [
              { text: 'SDK v1 契约', link: '/zh-CN/sdk/v1-contract' },
              { text: '从 v0 迁移到 v1', link: '/zh-CN/sdk/migration' },
              { text: '入门模板', link: 'https://github.com/SnowLeopard-io/ErgalicsStudio/tree/main/templates/plugin-starter' },
            ],
          },
          {
            text: '技术文档', collapsible: true,
            items: [
              { text: '01 · 产品介绍', link: '/zh-CN/technical/01-产品介绍' },
              { text: '02 · 系统架构', link: '/zh-CN/technical/02-系统架构' },
              { text: '03 · 插件系统', link: '/zh-CN/technical/03-插件系统' },
              { text: '04 · 四大工作模式', link: '/zh-CN/technical/04-四大工作模式' },
              { text: '05 · 科研工具集', link: '/zh-CN/technical/05-科研工具集' },
              { text: '06 · GPU 计算与原生核心', link: '/zh-CN/technical/06-GPU计算与原生核心' },
              { text: '07 · 科学计算子系统', link: '/zh-CN/technical/07-科学计算子系统' },
              { text: '08 · 测试与质量保障', link: '/zh-CN/technical/08-测试与质量保障' },
              { text: '11 · 应用场景库', link: '/zh-CN/technical/11-应用场景库' },
            ],
          },
          {
            text: '求解器专题', collapsible: true,
            items: [
              { text: '电磁谐振特征值求解器', link: '/technical/09-电磁谐振特征值求解器' },
              { text: '流体双向耦合求解器', link: '/zh-CN/technical/10-流体双向耦合求解器' },
            ],
          },
        ],
        footer: { message: '基于 MIT 许可证发布。', copyright: 'Copyright © 2026 SnowLeopard-io' },
      },
    },
  },
  themeConfig: {
    i18nRouting: false,
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
      {
        text: 'Technical Docs (中文)',
        collapsible: true,
        items: [
          { text: '01 · Product Introduction', link: '/technical/01-产品介绍' },
          { text: '02 · System Architecture', link: '/technical/02-系统架构' },
          { text: '03 · Plugin System', link: '/technical/03-插件系统' },
          { text: '04 · Four Working Modes', link: '/technical/04-四大工作模式' },
          { text: '05 · Research Toolset', link: '/technical/05-科研工具集' },
          { text: '06 · GPU Computing and Native Core', link: '/technical/06-GPU计算与原生核心' },
          { text: '07 · Scientific Computing Subsystems', link: '/technical/07-科学计算子系统' },
          { text: '08 · Testing and Quality Assurance', link: '/technical/08-测试与质量保障' },
          { text: '11 · Application Scenario Library', link: '/technical/11-应用场景库' },
        ],
      },
      {
        text: 'Solver 独立专题',
        collapsible: true,
        items: [
          { text: '电磁谐振特征值求解器', link: '/technical/09-电磁谐振特征值求解器' },
          { text: 'Fluid Bidirectional Coupling Solver', link: '/technical/10-流体双向耦合求解器' },
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
