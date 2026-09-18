// ==========================================================================
// FR-21 theme market — applying a CsTheme to the document (and the pure
// CSS-string generation that backs it, so the logic is testable in node).
//
// Orthogonality with light/dark: the app resolves its mode via
// `:root[data-theme='light'|'dark']` (see src/theme/index.ts and
// src/styles/global.css). A theme pack therefore injects up to three
// selector layers keyed on `:root[data-cs-theme="<id>"]`:
//
//   :root[data-cs-theme="id"]                          → mode-agnostic tokens
//   :root[data-cs-theme="id"][data-theme="light"]      → light-only tokens
//   :root[data-cs-theme="id"][data-theme="dark"]       → dark-only tokens
//
// Single-set themes just use `tokens.common`; mode-specific themes fill
// `tokens.light` / `tokens.dark`. Because the mode-specific selectors carry
// one extra attribute they always outrank the base `:root[data-theme=…]`
// block, and the common layer — appended to <head> after the app stylesheet —
// wins ties by document order. Toggling light/dark keeps working untouched.
//
// The override lives in ONE `<style id="cs-theme-style" data-cs-theme=…>`
// element; removing it (and the html[data-cs-theme] attribute) restores the
// stock appearance with zero residue.
// ==========================================================================

import type { CsTheme } from './schema';

export const THEME_STYLE_ELEMENT_ID = 'cs-theme-style';

/** Default chart palette — mirrors the historical PALETTE in core/plot.
 *  Consumers of getChartPalette() fall back to this when no theme ships a
 *  chartPalette (the linkage is advisory per FR-21). */
export const DEFAULT_CHART_PALETTE: readonly string[] = Object.freeze([
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',
]);

// Baseline design tokens from src/styles/global.css. The theme layer cannot
// reference the stock values at runtime (CSS has no `inherit from :root`
// arithmetic across rules), so font scaling and density compression are
// computed against these constants. Keep in sync with global.css.
const BASE_FONT_SIZES: Readonly<Record<string, number>> = {
  '--font-size-xs': 11,
  '--font-size-sm': 12,
  '--font-size-base': 13.5,
  '--font-size-md': 15,
  '--font-size-lg': 19,
  '--font-size-xl': 26,
  '--font-size-hero': 44,
};

const BASE_SPACES: Readonly<Record<string, number>> = {
  '--space-1': 4,
  '--space-2': 8,
  '--space-3': 12,
  '--space-4': 16,
  '--space-5': 24,
  '--space-6': 32,
};

/** Compact density compresses the spacing scale to ~80% and tightens the
 *  chrome heights; comfortable is the stock default (no overrides). */
const DENSITY_COMPACT_FACTOR = 0.8;

function roundPx(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}px`;
}

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
}

/** Extra declarations derived from font / density / chartPalette, applied in
 *  the mode-agnostic layer. */
function derivedDeclarations(theme: CsTheme): Record<string, string> {
  const out: Record<string, string> = {};
  if (theme.font?.family) out['--font-sans'] = theme.font.family;
  if (theme.font?.scale !== undefined) {
    for (const [key, base] of Object.entries(BASE_FONT_SIZES)) {
      out[key] = roundPx(base * theme.font.scale);
    }
  }
  if (theme.density === 'compact') {
    for (const [key, base] of Object.entries(BASE_SPACES)) {
      out[key] = roundPx(base * DENSITY_COMPACT_FACTOR);
    }
    out['--topbar-height'] = '46px';
    out['--statusbar-height'] = '26px';
  }
  theme.chartPalette?.forEach((color, i) => {
    out[`--chart-palette-${i + 1}`] = color;
  });
  return out;
}

export interface BuiltThemeStyle {
  /** Theme id (also the value of the data-cs-theme marker attribute). */
  id: string;
  /** Full CSS text of the override layer. */
  css: string;
}

/** Pure CSS generation — no DOM required, idempotent for the same input.
 *  theme.id passed schema validation (ID_RE), so it is selector-safe. */
export function buildThemeStyle(theme: CsTheme): BuiltThemeStyle {
  const derived = derivedDeclarations(theme);
  const common = { ...(theme.tokens.common ?? {}), ...derived };
  const parts: string[] = [];
  if (Object.keys(common).length > 0) {
    parts.push(`:root[data-cs-theme="${theme.id}"] {\n${declarations(common)}\n}`);
  }
  const light = theme.tokens.light ?? {};
  if (Object.keys(light).length > 0) {
    parts.push(`:root[data-cs-theme="${theme.id}"][data-theme="light"] {\n${declarations(light)}\n}`);
  }
  const dark = theme.tokens.dark ?? {};
  if (Object.keys(dark).length > 0) {
    parts.push(`:root[data-cs-theme="${theme.id}"][data-theme="dark"] {\n${declarations(dark)}\n}`);
  }
  return { id: theme.id, css: `${parts.join('\n')}\n` };
}

// ---------------------------------------------------------------------------
// Runtime application (browser) + active-theme state (also valid in node)
// ---------------------------------------------------------------------------

let activeTheme: CsTheme | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** Subscribe to applied-theme changes (apply/remove). Returns unsubscribe. */
export function subscribeThemePack(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveTheme(): CsTheme | null {
  return activeTheme;
}

export function getActiveThemeId(): string | null {
  return activeTheme?.id ?? null;
}

function writeStyleElement(built: BuiltThemeStyle): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(THEME_STYLE_ELEMENT_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = THEME_STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.setAttribute('data-cs-theme', built.id);
  style.textContent = built.css;
  document.documentElement.dataset.csTheme = built.id;
}

function clearStyleElement(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove();
  delete document.documentElement.dataset.csTheme;
}

/** Apply a theme pack as the `:root` override layer. Idempotent: re-applying
 *  the same theme rewrites the style element in place. Safe in non-DOM
 *  environments (state + chart palette still update). */
export function applyTheme(theme: CsTheme): void {
  activeTheme = theme;
  writeStyleElement(buildThemeStyle(theme));
  emit();
}

/** Remove the override layer and restore the stock appearance. */
export function removeTheme(): void {
  activeTheme = null;
  clearStyleElement();
  emit();
}

/**
 * Effective chart palette for the current theme (FR-21 图表配色联动).
 * Advisory: themes without a chartPalette fall back to DEFAULT_CHART_PALETTE.
 * Works in node (no DOM dependency) — reads the in-memory active theme.
 */
export function getChartPalette(): readonly string[] {
  return activeTheme?.chartPalette ?? DEFAULT_CHART_PALETTE;
}

/** Color for series index i (wraps the palette). */
export function chartColorAt(i: number): string {
  const palette = getChartPalette();
  return palette[((i % palette.length) + palette.length) % palette.length]!;
}
