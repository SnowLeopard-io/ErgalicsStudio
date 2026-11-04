import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMPACT_VIEWPORT_QUERY,
  LANDSCAPE_LOCK_MODE,
  initOrientationLock,
  isPortraitViewport,
  lockLandscape,
} from '@/core/orientation';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPortraitViewport', () => {
  it('flags height-greater-than-width viewports', () => {
    expect(isPortraitViewport(390, 844)).toBe(true);
    expect(isPortraitViewport(360, 780)).toBe(true);
  });

  it('accepts landscape and square viewports', () => {
    expect(isPortraitViewport(844, 390)).toBe(false);
    expect(isPortraitViewport(600, 600)).toBe(false);
  });
});

describe('lockLandscape', () => {
  it('locks when the engine honours the call', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('screen', { orientation: { lock } });

    await expect(lockLandscape()).resolves.toBe(true);
    expect(lock).toHaveBeenCalledWith(LANDSCAPE_LOCK_MODE);
    expect(LANDSCAPE_LOCK_MODE).toBe('landscape');
  });

  it('fails soft when the engine rejects (fullscreen/standalone requirement)', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('not allowed'));
    vi.stubGlobal('screen', { orientation: { lock } });

    await expect(lockLandscape()).resolves.toBe(false);
  });

  it('fails soft when the orientation API is missing', async () => {
    vi.stubGlobal('screen', {});

    await expect(lockLandscape()).resolves.toBe(false);
  });

  it('fails soft when screen is absent entirely', async () => {
    vi.stubGlobal('screen', undefined);

    await expect(lockLandscape()).resolves.toBe(false);
  });
});

describe('initOrientationLock (non-browser context)', () => {
  it('returns a no-op teardown and tolerates re-entry (HMR re-import)', () => {
    const teardown = initOrientationLock();
    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
    expect(() => initOrientationLock()).not.toThrow();
  });
});

describe('wiring (source-level)', () => {
  it('declares the PWA manifest as landscape', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { orientation?: string };
    expect(manifest.orientation).toBe('landscape');
  });

  it('lets the layout reach the notch via viewport-fit=cover', () => {
    expect(read('index.html')).toContain('viewport-fit=cover');
  });

  it('locks at startup and releases on HMR dispose', () => {
    const main = read('src/main.tsx');
    expect(main).toContain('initOrientationLock()');
    expect(main).toContain('teardownOrientationLock();');
  });

  it('mirrors COMPACT_VIEWPORT_QUERY in the compact stylesheet tier', () => {
    const css = read('src/styles/app.css');
    expect(COMPACT_VIEWPORT_QUERY).toBe('(max-width: 1024px) and (max-height: 560px)');
    expect(css).toContain(`@media ${COMPACT_VIEWPORT_QUERY}`);
  });

  it('ships the portrait guard, floating panels and touch targets', () => {
    const css = read('src/styles/app.css');
    expect(css).toContain('.portrait-guard');
    // Panels float over the canvas on the compact tier instead of squeezing it.
    expect(css).toContain('.panel-wrap:has(> .sidebar)');
    // Coarse-pointer devices get phone-sized hit areas.
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toMatch(/\.activity-item\s*\{[^}]*height: 44px/);
    // Notch / home-indicator insets are wired through the safe-area tokens.
    const globals = read('src/styles/global.css');
    expect(globals).toContain('env(safe-area-inset-left');
    expect(globals).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('var(--safe-inset-left)');

    const app = read('src/App.tsx');
    expect(app).toContain('<PortraitGuard />');
  });

  it('starts with the side panels collapsed on compact touch viewports', () => {
    const store = read('src/stores/appStore.ts');
    expect(store).toContain('COMPACT_VIEWPORT_QUERY');
    expect(store).toMatch(/defaults\.sidebarOpen = false/);
    expect(store).toMatch(/defaults\.rightPanelOpen = false/);
  });

  it('has the guard copy in both locales', () => {
    expect(read('src/i18n/dicts/ux.ts')).toContain("'ux.orientation.title'");
    expect(read('src/i18n/dicts/ux.ts')).toContain("'ux.orientation.hint'");
  });
});
