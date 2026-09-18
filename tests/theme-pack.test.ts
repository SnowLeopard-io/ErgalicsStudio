// FR-21 theme pack (.cstheme) schema / apply / registry / market tests.
// Node environment (no DOM): style-layer behavior is verified through the
// pure CSS-string generator and the DOM-free active-theme state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCsTheme,
  parseCsThemeJson,
  ThemeParseError,
  isColorLiteral,
  sanitizeFontStack,
  isThemeCompatible,
  type CsTheme,
} from '@/core/theme-pack/schema';
import {
  buildThemeStyle,
  applyTheme,
  removeTheme,
  getActiveTheme,
  getActiveThemeId,
  getChartPalette,
  chartColorAt,
  DEFAULT_CHART_PALETTE,
  subscribeThemePack,
} from '@/core/theme-pack/apply';
import {
  OFFICIAL_THEMES,
  JOURNAL_THEME,
  EDU_THEME,
  getOfficialTheme,
  listInstalledThemes,
  installTheme,
  uninstallTheme,
  findThemeById,
  getAppliedThemeId,
  setAppliedThemeId,
  applyAndRemember,
  restoreAppliedTheme,
  INSTALLED_THEMES_KEY,
} from '@/core/theme-pack/registry';
import { MARKET_THEMES, websiteThemeLink } from '@/core/theme-pack/market';
import { themeMarketZh, themeMarketEn } from '@/i18n/dicts/theme-market';

const VALID: CsTheme = {
  id: 'test-theme',
  name: 'Test Theme',
  version: '1.0.0',
  tokens: {
    common: { '--color-accent': '#2dd4bf' },
    light: { '--color-bg-primary': '#ffffff' },
    dark: { '--color-bg-primary': '#000000' },
  },
  font: { family: "'Source Serif 4', 'Georgia', serif", scale: 1.1 },
  density: 'compact',
  chartPalette: ['#1f4e79', 'rgb(192, 80, 77)', 'hsl(80, 50%, 40%)'],
  minAppVersion: '0.1.0',
};

// ---------------------------------------------------------------------------
// localStorage stub (node has none; registry degrades gracefully without it)
// ---------------------------------------------------------------------------

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

let store: Storage;
beforeEach(() => {
  store = makeStorage();
  vi.stubGlobal('localStorage', store);
});
afterEach(() => {
  vi.unstubAllGlobals();
  removeTheme();
});

// ---------------------------------------------------------------------------
// schema: happy paths
// ---------------------------------------------------------------------------

describe('parseCsTheme — valid packages', () => {
  it('accepts a fully populated theme', () => {
    const theme = parseCsTheme(VALID);
    expect(theme.id).toBe('test-theme');
    expect(theme.tokens.dark?.['--color-bg-primary']).toBe('#000000');
    expect(theme.chartPalette).toHaveLength(3);
    expect(theme.font?.scale).toBe(1.1);
  });

  it('accepts a minimal theme (tokens may be empty)', () => {
    const theme = parseCsTheme({ id: 'x', name: 'X', version: '0.0.1', tokens: {} });
    expect(theme.id).toBe('x');
    expect(theme.tokens).toEqual({});
  });

  it('parses from JSON text', () => {
    const theme = parseCsThemeJson(JSON.stringify(VALID));
    expect(theme.name).toBe('Test Theme');
  });

  it('accepts rgb/hsl color literals', () => {
    expect(isColorLiteral('rgb(1, 2, 3)')).toBe(true);
    expect(isColorLiteral('rgba(1,2,3,0.5)')).toBe(true);
    expect(isColorLiteral('hsl(120,50%,40%)')).toBe(true);
    expect(isColorLiteral('#abc')).toBe(true);
    expect(isColorLiteral('red')).toBe(false);
  });

  it('sanitizes font stacks to single-quoted names', () => {
    expect(sanitizeFontStack('"Times New Roman", serif', '$.font.family')).toBe("'Times New Roman', 'serif'");
  });
});

// ---------------------------------------------------------------------------
// schema: rejection of malformed / hostile packages
// ---------------------------------------------------------------------------

describe('parseCsTheme — rejection', () => {
  it('rejects non-JSON text', () => {
    expect(() => parseCsThemeJson('{ not json')).toThrow(ThemeParseError);
  });

  it('rejects unknown top-level keys', () => {
    expect(() => parseCsTheme({ ...VALID, evil: true })).toThrow(/unknown key/);
  });

  it('rejects unknown keys inside tokens/font layers', () => {
    expect(() => parseCsTheme({ ...VALID, tokens: { ...VALID.tokens, extra: {} } })).toThrow(/unknown key/);
    expect(() => parseCsTheme({ ...VALID, font: { family: 'serif', weight: 900 } })).toThrow(/unknown key/);
  });

  it('rejects dangerous prototype keys', () => {
    // An object literal `__proto__:` sets the prototype instead of creating
    // an own property; JSON.parse is the way a hostile package really does it.
    const raw = JSON.parse(
      '{"id":"x","name":"X","version":"1.0.0","tokens":{"common":{"__proto__":{"polluted":"1"}}}}',
    );
    expect(() => parseCsTheme(raw)).toThrow(/dangerous key/);
    const raw2 = JSON.parse(JSON.stringify(VALID));
    raw2.constructor = 'x';
    expect(() => parseCsTheme(raw2)).toThrow(/dangerous key/);
  });

  it('rejects non-custom-property token keys', () => {
    expect(() =>
      parseCsTheme({ ...VALID, tokens: { common: { color: 'red' } } }),
    ).toThrow(/custom property/);
    expect(() =>
      parseCsTheme({ ...VALID, tokens: { common: { '--Bad Key': '#fff' } } }),
    ).toThrow(/custom property/);
  });

  it('rejects declaration-smuggling color values', () => {
    expect(() =>
      parseCsTheme({
        id: 'x', name: 'X', version: '1.0.0',
        tokens: { common: { '--color-accent': 'red; } body { display:none' } },
      }),
    ).toThrow(ThemeParseError);
  });

  it('rejects url() / expression() / javascript: / data: constructs', () => {
    for (const bad of [
      'url(evil.png)',
      'expression(alert(1))',
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
    ]) {
      expect(() =>
        parseCsTheme({ id: 'x', name: 'X', version: '1.0.0', tokens: { common: { '--shadow-1': bad } } }),
      ).toThrow(/forbidden/);
    }
  });

  it('rejects markup injection in string fields', () => {
    expect(() =>
      parseCsTheme({ ...VALID, name: 'Nice <script>alert(1)</script>' }),
    ).toThrow(/forbidden characters/);
    expect(() =>
      parseCsTheme({ ...VALID, description: 'x}; body{display:none' }),
    ).toThrow(/forbidden characters/);
  });

  it('rejects font stacks with url() or illegal characters', () => {
    expect(() =>
      parseCsTheme({ ...VALID, font: { family: "url(evil.woff), serif" } }),
    ).toThrow(/font-family|forbidden|illegal/);
    expect(() =>
      parseCsTheme({ ...VALID, font: { family: 'x; } body { font-family: "evil' } }),
    ).toThrow(ThemeParseError);
  });

  it('rejects unquoted non-generic font families', () => {
    expect(() => sanitizeFontStack('Times New Roman, serif', '$')).toThrow(/generic keyword/);
  });

  it('rejects invalid ids, versions and enums', () => {
    expect(() => parseCsTheme({ ...VALID, id: 'bad id!' })).toThrow(/invalid theme id/);
    expect(() => parseCsTheme({ ...VALID, version: '1.0' })).toThrow(/major.minor.patch/);
    expect(() => parseCsTheme({ ...VALID, density: 'roomy' as CsTheme['density'] })).toThrow(/unknown density/);
    expect(() => parseCsTheme({ ...VALID, minAppVersion: 'v2' })).toThrow(/major.minor.patch/);
  });

  it('rejects out-of-range font scale and bad palette colors', () => {
    expect(() => parseCsTheme({ ...VALID, font: { scale: 9 } })).toThrow(/\[0.5, 2\]/);
    expect(() => parseCsTheme({ ...VALID, chartPalette: ['rebeccapurple'] })).toThrow(/hex\/rgb/);
    expect(() => parseCsTheme({ ...VALID, chartPalette: [] })).toThrow(/1-12/);
  });

  it('rejects non-string token values and bad lengths', () => {
    expect(() =>
      parseCsTheme({ id: 'x', name: 'X', version: '1.0.0', tokens: { common: { '--font-size-base': 14 } } }),
    ).toThrow(ThemeParseError);
    expect(() =>
      parseCsTheme({ id: 'x', name: 'X', version: '1.0.0', tokens: { common: { '--font-size-base': 'huge' } } }),
    ).toThrow(/length/);
  });

  it('isThemeCompatible compares semver', () => {
    expect(isThemeCompatible(VALID, '0.1.0')).toBe(true);
    expect(isThemeCompatible({ ...VALID, minAppVersion: '9.9.9' }, '0.1.0')).toBe(false);
    expect(isThemeCompatible({ ...VALID, minAppVersion: undefined }, '0.0.1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// apply: pure CSS generation (node, no DOM)
// ---------------------------------------------------------------------------

const PARSED = parseCsTheme(VALID);

describe('buildThemeStyle', () => {
  it('emits mode-agnostic and per-mode selectors keyed on data-cs-theme', () => {
    const { css } = buildThemeStyle(PARSED);
    expect(css).toContain(':root[data-cs-theme="test-theme"] {');
    expect(css).toContain(':root[data-cs-theme="test-theme"][data-theme="light"] {');
    expect(css).toContain(':root[data-cs-theme="test-theme"][data-theme="dark"] {');
    expect(css).toContain('--color-accent: #2dd4bf;');
  });

  it('is idempotent for the same input', () => {
    expect(buildThemeStyle(VALID).css).toBe(buildThemeStyle(VALID).css);
  });

  it('derives font-size scale, compact spacing and chart palette vars', () => {
    const { css } = buildThemeStyle(VALID);
    // base 13.5px × 1.1 = 14.85px
    expect(css).toContain('--font-size-base: 14.85px;');
    // compact: space-4 16px × 0.8 = 12.8px
    expect(css).toContain('--space-4: 12.8px;');
    expect(css).toContain('--chart-palette-1: #1f4e79;');
    expect(css).toContain('--chart-palette-3: hsl(80, 50%, 40%);');
  });

  it('font.family override lands on --font-sans', () => {
    const { css } = buildThemeStyle(PARSED);
    expect(css).toContain("--font-sans: 'Source Serif 4', 'Georgia', 'serif';");
  });
});

describe('applyTheme / removeTheme (DOM-free state)', () => {
  it('tracks the active theme and notifies subscribers', () => {
    let hits = 0;
    const off = subscribeThemePack(() => (hits += 1));
    applyTheme(VALID);
    expect(getActiveThemeId()).toBe('test-theme');
    removeTheme();
    expect(getActiveTheme()).toBeNull();
    expect(hits).toBe(2);
    off();
    applyTheme(VALID);
    expect(hits).toBe(2);
    removeTheme();
  });
});

describe('getChartPalette (chart-color linkage)', () => {
  it('falls back to the default palette with no theme', () => {
    expect(getChartPalette()).toEqual(DEFAULT_CHART_PALETTE);
    expect(chartColorAt(7)).toBe(DEFAULT_CHART_PALETTE[7 % DEFAULT_CHART_PALETTE.length]);
  });

  it('follows the applied theme and reverts on removal', () => {
    applyTheme(VALID);
    expect(getChartPalette()).toEqual(VALID.chartPalette);
    expect(chartColorAt(3)).toBe('#1f4e79'); // wraps
    removeTheme();
    expect(getChartPalette()).toEqual(DEFAULT_CHART_PALETTE);
  });

  it('themes without chartPalette keep the default', () => {
    applyTheme({ id: 'plain', name: 'Plain', version: '1.0.0', tokens: {} });
    expect(getChartPalette()).toEqual(DEFAULT_CHART_PALETTE);
    removeTheme();
  });
});

// ---------------------------------------------------------------------------
// official catalog integrity
// ---------------------------------------------------------------------------

describe('official themes', () => {
  it('ships journal (serif) and edu (high-contrast large type)', () => {
    const ids = OFFICIAL_THEMES.map((t) => t.id);
    expect(ids).toContain('journal');
    expect(ids).toContain('edu');
    expect(getOfficialTheme('journal')).toBe(JOURNAL_THEME);
    expect(JOURNAL_THEME.font?.family).toMatch(/serif/i);
    expect((EDU_THEME.font?.scale ?? 1)).toBeGreaterThan(1);
  });

  it('every official theme passes the strict schema', () => {
    for (const theme of OFFICIAL_THEMES) {
      expect(() => parseCsTheme(theme)).not.toThrow();
      expect(theme.chartPalette && theme.chartPalette.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// install persistence round-trip
// ---------------------------------------------------------------------------

describe('registry persistence', () => {
  it('installs, lists and uninstalls user themes', () => {
    expect(listInstalledThemes()).toEqual([]);
    installTheme(VALID);
    expect(listInstalledThemes().map((t) => t.id)).toEqual(['test-theme']);
    expect(findThemeById('test-theme')?.name).toBe('Test Theme');
    expect(uninstallTheme('test-theme')).toBe(true);
    expect(listInstalledThemes()).toEqual([]);
    expect(uninstallTheme('test-theme')).toBe(false);
  });

  it('re-installing the same id updates in place', () => {
    installTheme(VALID);
    installTheme({ ...VALID, version: '2.0.0' });
    const list = listInstalledThemes();
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe('2.0.0');
  });

  it('official ids never shadow built-ins', () => {
    installTheme(JOURNAL_THEME);
    expect(listInstalledThemes()).toEqual([]);
    expect(uninstallTheme('journal')).toBe(false);
  });

  it('drops corrupted records on read (defensive sanitize)', () => {
    store.setItem(INSTALLED_THEMES_KEY, 'not json at all');
    expect(listInstalledThemes()).toEqual([]);
    store.setItem(
      INSTALLED_THEMES_KEY,
      JSON.stringify({ themes: [VALID, { id: 'evil', tokens: { common: { '--color-accent': 'red; } x {' } } }], appliedId: 42 }),
    );
    expect(listInstalledThemes().map((t) => t.id)).toEqual(['test-theme']);
    expect(getAppliedThemeId()).toBeNull();
  });

  it('persists and restores the applied theme', () => {
    installTheme(VALID);
    applyAndRemember(VALID);
    expect(getAppliedThemeId()).toBe('test-theme');
    removeTheme();
    expect(restoreAppliedTheme()).toBe('test-theme');
    expect(getActiveThemeId()).toBe('test-theme');
    setAppliedThemeId('ghost');
    expect(restoreAppliedTheme()).toBeNull(); // unknown id self-heals
    expect(getAppliedThemeId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// market catalog
// ---------------------------------------------------------------------------

describe('market catalog', () => {
  it('aligns with the website catalog ids', () => {
    const websiteIds = [
      'journal-serif', 'deep-space', 'classroom-high-contrast',
      'lab-amber', 'clinical-mint', 'midnight-plot',
    ];
    expect(MARKET_THEMES.map((e) => e.id)).toEqual(websiteIds);
  });

  it('every embedded theme passes the strict schema', () => {
    for (const entry of MARKET_THEMES) {
      expect(() => parseCsTheme(entry.theme)).not.toThrow();
      expect(entry.theme.id).toBe(entry.id);
    }
  });

  it('website deep link targets the themes page', () => {
    expect(websiteThemeLink('deep-space')).toContain('#/themes');
    expect(websiteThemeLink('deep-space')).toContain('theme=deep-space');
  });
});

// ---------------------------------------------------------------------------
// i18n parity
// ---------------------------------------------------------------------------

describe('theme-market dictionary', () => {
  it('zh and en have exact key parity', () => {
    const zh = Object.keys(themeMarketZh).sort();
    const en = Object.keys(themeMarketEn).sort();
    expect(zh).toEqual(en);
    expect(zh.length).toBeGreaterThan(10);
  });

  it('all keys use the theme. prefix and non-empty values', () => {
    for (const [k, v] of Object.entries(themeMarketZh)) {
      expect(k.startsWith('theme.')).toBe(true);
      expect(v.length).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(themeMarketEn)) {
      expect(k.startsWith('theme.')).toBe(true);
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
