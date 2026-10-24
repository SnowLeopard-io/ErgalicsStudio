<script setup lang="ts">
// Wraps the default VitePress layout with a small cross-site switcher so a
// reader can hop between the docs site, the workstation and the official
// website without leaving the browser or typing a URL.
//
// All three live on one origin:
//   /<repo>/             → official website
//   /<repo>/app/         → workstation (HashRouter)
//   /<repo>/app/docs/    → this docs site
// In dev they run on separate Vite servers on fixed ports.
import DefaultTheme from 'vitepress/theme'

const { Layout } = DefaultTheme

const base = import.meta.env.BASE_URL // e.g. "/<repo>/app/docs/" or "/" in dev
const isDev = import.meta.env.DEV

// Repo-root prefix (e.g. "/<repo>", or "" at the origin root) for any docs
// base layout. The docs always ship under the merged deploy's "/app/docs/",
// but CI/release legacy builds used a bare "/docs/" — strip whichever suffix
// is present so the cross-site links point at the repo root and NEVER back
// under the docs base itself. Strip the suffix *with* its leading "/": for a
// domain-root base ("/app/docs/" → "") we must return an empty prefix, not
// "/", otherwise "site" becomes "//" and "studio" becomes "//app/#/", which
// the browser reads as protocol-relative (no host) URLs and the switch fails.
function repoRoot(path: string): string {
  const b = path.endsWith('/') ? path : `${path}/`
  for (const segment of ['/app/docs/', '/docs/']) {
    if (b === segment) return '' // nothing before the suffix → origin root
    if (b.endsWith(segment)) return b.slice(0, b.length - segment.length)
  }
  return b.slice(0, -1) // e.g. "/<repo>" or "" for a dev "/" base
}

function resolve() {
  if (isDev) {
    // Dev servers (ports match each workspace's vite.config).
    return {
      docs: '',
      studio: 'http://localhost:5173/',
      site: 'http://localhost:5174/',
      isDocs: true,
    }
  }
  const root = repoRoot(base)
  return {
    docs: '',
    studio: `${root}/app/#/`, // "" → "/app/#/"; "/<repo>" → "/<repo>/app/#/"
    site: `${root}/`, // "" → "/"; "/<repo>" → "/<repo>/"
    isDocs: true,
  }
}

const links = resolve()
</script>

<template>
  <Layout />
  <nav class="cross-site-nav" aria-label="Site switcher">
    <span class="cross-site-label">Sites</span>
    <a
      :href="links.site"
      target="_blank"
      rel="noopener noreferrer"
      class="cross-site-link"
      aria-label="Official website"
    >Website</a>
    <a
      :href="links.studio"
      target="_blank"
      rel="noopener noreferrer"
      class="cross-site-link cross-site-studio"
      aria-label="Open the workstation"
    >Studio</a>
    <a
      href="#/"
      class="cross-site-link is-current"
      aria-label="Documentation (current site)"
    >Docs</a>
  </nav>
</template>