// Deep links from the website into the deployed workstation.
//
// Deployment layout (GitHub Pages): website at /<repo>/, workstation at
// /<repo>/app/. The workstation uses HashRouter, so a deep link is
// "<prefix>/app/#/<route>".

/** Directory prefix of the workstation bundle, relative to this site.
 *
 *  Production (GitHub Pages): the workstation lives at ./app/ next to the
 *  site. Local dev (`vite dev` on both sides): there is no /app/ directory,
 *  so point at the workstation dev server directly — otherwise every
 *  "open in Studio" link 404s and the two apps look unhooked together.
 *  Port 5173 is the workstation's `npm run dev` default. */
export const STUDIO_BASE = import.meta.env.DEV ? 'http://localhost:5173/' : './app/';

/** Build an absolute (page-relative) URL into the workstation. */
export function studioUrl(route = '/', params?: Record<string, string>): string {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  const hash = `#/${route.replace(/^\//, '')}${q}`;
  return STUDIO_BASE + hash;
}

/** Launch the workstation, optionally asking it to open a template,
 *  apply a theme, install a plugin or load a gallery snapshot. */
export function studioAction(kind: 'template' | 'theme' | 'plugin' | 'gallery', id: string): string {
  return studioUrl('/', { [kind]: id });
}
