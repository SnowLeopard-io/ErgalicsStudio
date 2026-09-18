// ==========================================================================
// FR-20 — PWA offline support tests (pure Node).
//
// Covers: manifest validity + required fields, hand-written sw.js parses as
// JS and keeps its placeholder contract, needsNetwork() logic, the
// gen-sw-precache script against a fixture dist, and zh/en key parity of the
// pwa dictionary.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsNetwork, NETWORK_RESOURCES } from '@/core/pwa';
import { pwaZh, pwaEn } from '@/i18n/dicts/pwa';
import { injectSwPrecache } from '../scripts/gen-sw-precache.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('FR-20 manifest', () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
  ) as Record<string, unknown>;

  it('is valid JSON with the required install fields', () => {
    for (const key of ['name', 'short_name', 'description', 'start_url', 'display', 'icons', 'theme_color']) {
      expect(manifest, `missing ${key}`).toHaveProperty(key);
    }
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./'); // relative: works under /<repo>/app/
    expect(manifest.scope).toBe('./');
  });

  it('declares at least one any-purpose icon', () => {
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.some((i) => (i.purpose ?? 'any') === 'any')).toBe(true);
    for (const icon of icons) {
      expect(icon.src.startsWith('/'), `icon src must be public-relative: ${icon.src}`).toBe(false);
    }
  });

  it('is linked from index.html', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
  });
});

describe('FR-20 service worker', () => {
  const sw = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');

  it('parses as JavaScript', () => {
    // new Function compiles (parses) without executing the body.
    expect(() => new Function(sw)).not.toThrow();
  });

  it('keeps the build-injection placeholder contract', () => {
    expect(sw).toContain("const VERSION = '__SW_VERSION__';");
    expect(sw).toContain('const PRECACHE_MANIFEST = /*__PRECACHE_MANIFEST__*/ [];');
  });

  it('implements install/activate/fetch and the offline navigation fallback', () => {
    expect(sw).toContain("addEventListener('install'");
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toContain("addEventListener('fetch'");
    expect(sw).toContain("caches.delete");
    expect(sw).toContain("req.mode === 'navigate'");
    // Cross-origin (model CDN etc.) is bypassed → needs network.
    expect(sw).toContain('url.origin !== self.location.origin');
  });
});

describe('FR-20 needsNetwork', () => {
  const BASE = 'http://localhost/repo/app/index.html';

  it('flags cross-origin resources (Pyodide CDN fallback, model URLs)', () => {
    expect(needsNetwork('https://cdn.jsdelivr.net/pyodide/v314/pyodide.mjs', BASE)).toBe(true);
    expect(needsNetwork('https://example.org/model.onnx', BASE)).toBe(true);
  });

  it('treats same-origin paths as offline-capable', () => {
    expect(needsNetwork('./assets/index-abc123.js', BASE)).toBe(false);
    expect(needsNetwork('/repo/app/pyodide/pyodide.mjs', BASE)).toBe(false);
    expect(needsNetwork('manifest.webmanifest', BASE)).toBe(false);
  });

  it('assumes network for unparsable input', () => {
    expect(needsNetwork('::::not a url::::', 'http://localhost/')).toBe(true);
  });

  it('catalogues every online-only resource with i18n keys', () => {
    expect(NETWORK_RESOURCES.length).toBeGreaterThan(0);
    for (const r of NETWORK_RESOURCES) {
      expect(r.labelKey in pwaZh, r.labelKey).toBe(true);
      expect(r.reasonKey in pwaEn, r.reasonKey).toBe(true);
    }
  });
});

describe('FR-20 gen-sw-precache', () => {
  it('injects version + manifest into a fixture dist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ergalics-sw-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
      writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
      writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
      writeFileSync(join(dir, 'assets', 'core-1.js'), 'console.log(1)');
      writeFileSync(join(dir, 'assets', 'core-2.css'), 'body{}');
      writeFileSync(join(dir, 'assets', 'huge-3.js'), 'x'.repeat(600 * 1024)); // > 512 KiB cap
      writeFileSync(join(dir, 'sw.js'), readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8'));

      const count = injectSwPrecache(dir);
      expect(count).toBe(5); // shell(3) + core-1.js + core-2.css (huge excluded)

      const out = readFileSync(join(dir, 'sw.js'), 'utf8');
      expect(out).not.toContain('__SW_VERSION__');
      expect(out).not.toContain('__PRECACHE_MANIFEST__');
      expect(out).toMatch(/const VERSION = "b-[0-9a-f]{12}";/);
      expect(out).toContain('"./index.html"');
      expect(out).toContain('"./assets/core-1.js"');
      expect(out).toContain('"./assets/core-2.css"');
      expect(out).not.toContain('huge-3');
      // Injected file must still parse.
      expect(() => new Function(out)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent (second run finds no placeholders)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ergalics-sw2-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<html/>');
      writeFileSync(join(dir, 'sw.js'), readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8'));
      expect(injectSwPrecache(dir)).toBeGreaterThan(0);
      expect(injectSwPrecache(dir)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('FR-20 pwa dictionary', () => {
  it('keeps zh/en key parity', () => {
    expect(Object.keys(pwaZh).sort()).toEqual(Object.keys(pwaEn).sort());
  });

  it('every key uses the pwa. prefix', () => {
    for (const key of Object.keys(pwaZh)) expect(key.startsWith('pwa.')).toBe(true);
  });

  it('has non-empty values in both locales', () => {
    for (const [k, v] of Object.entries(pwaZh)) expect(v.length, k).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(pwaEn)) expect(v.length, k).toBeGreaterThan(0);
  });
});
