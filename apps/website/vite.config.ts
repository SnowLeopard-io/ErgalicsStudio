import { createReadStream, cpSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const siteRoot = fileURLToPath(new URL('.', import.meta.url));
// Single source of truth for the technical documents shown on the Downloads
// page. They are never duplicated inside the website source tree:
//   - dev:  the /technical middleware streams files straight from docs/
//   - build: closeBundle copies them into dist/ (a gitignored artifact,
//     merged into pages-out/ by scripts/merge-deploy.mjs)
const TECHNICAL_DIR = resolve(siteRoot, '..', 'docs', 'technical');

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Serve one file from docs/technical. Filenames contain spaces and Chinese
// characters, so the URL path arrives percent-encoded. Anything unresolvable
// falls through to Vite (which 404s or SPA-fallbacks as usual).
function serveTechnical(req: IncomingMessage, res: ServerResponse, next: () => void) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    next();
    return;
  }
  if (pathname.includes('..') || pathname.includes('\0')) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const file = resolve(TECHNICAL_DIR, pathname.replace(/^\/+/, ''));
  if (!file.startsWith(TECHNICAL_DIR + sep)) {
    next(); // traversal attempt or outside the docs root
    return;
  }
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    next();
    return;
  }
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  createReadStream(file).pipe(res);
}

function technicalDocs(): Plugin {
  return {
    name: 'technical-docs',
    configureServer(server) {
      server.middlewares.use('/technical', serveTechnical);
    },
    closeBundle() {
      cpSync(TECHNICAL_DIR, resolve(siteRoot, 'dist', 'technical'), {
        recursive: true,
        // Measurement probes from scripts/build-tech-docs.mjs (interrupted
        // runs) must never leak into the deploy artifact.
        filter: (src) => !src.startsWith(join(TECHNICAL_DIR, '.measure-')),
      });
    },
  };
}

// Relative base so the site works under /<repo>/ on GitHub Pages; the
// workstation lives at ./app/ and is reached through the same prefix.
export default defineConfig({
  plugins: [react(), technicalDocs()],
  base: './',
  server: {
    // Fixed port so the workstation dev server always owns 5173 — the
    // studio-link dev bridge (STUDIO_BASE) assumes it regardless of which
    // server starts first.
    port: 5174,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
