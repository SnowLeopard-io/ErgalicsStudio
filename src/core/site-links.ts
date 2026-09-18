// Cross-site navigation between the workstation (this app), the official
// website and the docs site — all three are served from the same GitHub
// Pages origin:
//
//   /<repo>/             → official website (marketing)
//   /<repo>/app/         → this workstation
//   /<repo>/app/docs/    → docs (VitePress, built into dist/docs by
//                          scripts/build-docs.mjs and merged by
//                          scripts/merge-deploy.mjs)
//
// In dev each workspace runs on its own Vite server, so we fall back to the
// standard dev ports (see each workspace's vite.config). The URLs are
// overridable via env so a different layout or port is always possible.

import.meta.env; // keep vite import.meta.env types stable under all tooling

const WEBSITE_DEV = import.meta.env.VITE_WEBSITE_URL ?? 'http://localhost:5174/';
const DOCS_DEV =
  import.meta.env.VITE_DOCS_URL ?? 'http://localhost:5175/';

/** Official website URL. From the app (served at /<repo>/app/) the site is
 *  one directory up; in dev it is the website dev server. */
export function siteUrl(): string {
  if (import.meta.env.DEV) return WEBSITE_DEV;
  return '../';
}

/** Docs site URL. From the app the embedded docs live at ./docs/ (GH Pages
 *  copies dist/docs into pages-out/app/); in dev they run on their own
 *  VitePress server. */
export function docsUrl(): string {
  if (import.meta.env.DEV) return DOCS_DEV;
  return './docs/';
}