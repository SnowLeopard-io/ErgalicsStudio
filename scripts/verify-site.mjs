#!/usr/bin/env node
// ==========================================================================
// Ergalics Studio — merged-site integrity check
//
// Guards the cross-site deployment contract the whole codebase relies on:
//   /               official website (marketing)
//   /app/           workstation (HashRouter)
//   /app/docs/      VitePress docs (assets + deep pages)
//
// Re-merges the current build outputs into pages-out/ if asked, serves the
// artifact on an ephemeral port, and asserts every canonical path returns 200
// with a non-empty body. Any missing or blank path fails the run, so a layout
// regression (the "docs cross-links become protocol-relative // URLs" class of
// bug) is caught before deploy rather than on a live site.
//
// Usage:
//   node scripts/verify-site.mjs            # requires pages-out/ to exist
//   node scripts/verify-site.mjs --merge    # re-runs merge-deploy first
//
// Exit code 0 = all paths OK; 1 = at least one check failed.
// ==========================================================================

import { createServer, get as httpGet } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'pages-out');

if (process.argv.includes('--merge')) {
  const r = spawnSync('node', ['scripts/merge-deploy.mjs'], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) {
    console.error('> merge-deploy.mjs failed; aborting site check.');
    process.exit(1);
  }
}

if (!existsSync(join(out, 'index.html'))) {
  console.error(
    `Missing site artifact (${join(out, 'index.html')}). ` +
      'Run the builds first: npm run build:web && npm run build:website, then merge.'
  );
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
const DEFAULT = 'application/octet-stream';

// Minimal static server mirroring how pages are deployed (dirname → index.html).
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = join(out, pathname);
  if (!file.startsWith(join(out, '/'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (pathname.endsWith('/')) file = join(file, 'index.html');
  else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? DEFAULT });
  res.end(readFileSync(file));
});

/** GET a path and resolve { status, len } (len = non-empty body byte count). */
function probe(port, pathname) {
  return new Promise((resolve) => {
    const target = new URL(pathname, `http://127.0.0.1:${port}`);
    httpGet(target, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, len: Buffer.concat(chunks).length })
      );
    }).on('error', () => resolve({ status: 0, len: 0 }));
  });
}

await new Promise((res) => server.listen(0, '127.0.0.1', () => res()));
const port = server.address().port;

const expected = {
  '/': 'website index',
  '/index.html': 'website index (explicit)',
  '/ico.ico': 'root favicon',
  '/app/': 'workstation shell',
  '/app/index.html': 'workstation shell (explicit)',
  '/app/docs/': 'docs index',
  '/app/docs/index.html': 'docs index (explicit)',
  '/app/docs/guide/introduction.html': 'docs deep page',
};

let failed = 0;
for (const [pathname, label] of Object.entries(expected)) {
  const { status, len } = await probe(port, pathname);
  const ok = status === 200 && len > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  status=${String(status).padStart(3)}  bytes=${(len ?? 0).toString().padStart(6)}  ${pathname}  (${label})`);
}

server.close();

if (failed > 0) {
  console.error(`\n> ${failed} path(s) failed the merged-site check.`);
  process.exit(1);
}
console.log('\n> All merged-site paths OK.');
process.exit(0);