// ==========================================================================
// FR-18 — Colour-contrast self-test (WCAG 2.1 relative luminance).
//
// Parses the design tokens out of src/styles/global.css (both themes) and
// asserts the key text/background pairs meet AA: ≥ 4.5:1 for normal text,
// ≥ 3:1 for large text and UI borders. Failures are fixed by adjusting the
// token values in global.css (the one allowed theme edit under FR-18).
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const GLOBAL_CSS = readFileSync(join(ROOT, 'src', 'styles', 'global.css'), 'utf8');

function themeVars(theme: 'dark' | 'light'): Record<string, string> {
  const marker = `:root[data-theme='${theme}']`;
  const start = GLOBAL_CSS.indexOf(marker);
  expect(start, `missing ${marker} block in global.css`).toBeGreaterThanOrEqual(0);
  const open = GLOBAL_CSS.indexOf('{', start);
  const close = GLOBAL_CSS.indexOf('}', open);
  const block = GLOBAL_CSS.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]!] = m[2]!.trim();
  }
  return vars;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relLuminance(hexToRgb(fgHex));
  const l2 = relLuminance(hexToRgb(bgHex));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair {
  fg: string;
  bg: string;
  min: number;
  note: string;
}

// Key text pairs: body/labels/links on the surfaces they actually sit on.
const TEXT_PAIRS: Pair[] = [
  { fg: '--color-text-primary', bg: '--color-bg-primary', min: 4.5, note: 'body text' },
  { fg: '--color-text-primary', bg: '--color-bg-secondary', min: 4.5, note: 'body text on secondary' },
  { fg: '--color-text-primary', bg: '--color-bg-elevated', min: 4.5, note: 'body text on cards' },
  { fg: '--color-text-primary', bg: '--color-bg-tertiary', min: 4.5, note: 'body text on tertiary' },
  { fg: '--color-text-secondary', bg: '--color-bg-primary', min: 4.5, note: 'secondary text' },
  { fg: '--color-text-secondary', bg: '--color-bg-elevated', min: 4.5, note: 'secondary text on cards' },
  { fg: '--color-text-tertiary', bg: '--color-bg-primary', min: 4.5, note: 'tertiary/hint text' },
  { fg: '--color-text-tertiary', bg: '--color-bg-elevated', min: 4.5, note: 'tertiary text on cards' },
  { fg: '--color-accent-text', bg: '--color-bg-primary', min: 4.5, note: 'links' },
  { fg: '--color-accent-text', bg: '--color-bg-elevated', min: 4.5, note: 'links on cards' },
  { fg: '--color-success', bg: '--color-bg-primary', min: 4.5, note: 'success text' },
  { fg: '--color-warning', bg: '--color-bg-primary', min: 4.5, note: 'warning text' },
  { fg: '--color-error', bg: '--color-bg-primary', min: 4.5, note: 'error text' },
  { fg: '--color-text-inverse', bg: '--color-accent', min: 4.5, note: 'primary-button label' },
];

// Large text / UI-component pairs (AA 3:1): badges, disabled labels, borders.
const LARGE_PAIRS: Pair[] = [
  { fg: '--color-text-disabled', bg: '--color-bg-primary', min: 3, note: 'disabled text' },
  { fg: '--color-accent', bg: '--color-bg-primary', min: 3, note: 'accent UI element' },
  { fg: '--color-border-strong', bg: '--color-bg-primary', min: 3, note: 'input border' },
];

function check(theme: 'dark' | 'light', pairs: Pair[]): string[] {
  const vars = themeVars(theme);
  const failures: string[] = [];
  for (const p of pairs) {
    const fg = vars[p.fg];
    const bg = vars[p.bg];
    if (!fg || !bg) {
      failures.push(`${theme}: missing token ${!fg ? p.fg : p.bg}`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    if (ratio < p.min) {
      failures.push(
        `${theme} ${p.note}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (needs ≥ ${p.min}:1)`,
      );
    }
  }
  return failures;
}

describe('FR-18 contrast self-test (WCAG 2.1 AA)', () => {
  it('computes known ratios correctly (sanity)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 2);
  });

  it('dark theme text pairs meet 4.5:1', () => {
    expect(check('dark', TEXT_PAIRS)).toEqual([]);
  });

  it('light theme text pairs meet 4.5:1', () => {
    expect(check('light', TEXT_PAIRS)).toEqual([]);
  });

  it('dark theme large/UI pairs meet 3:1', () => {
    expect(check('dark', LARGE_PAIRS)).toEqual([]);
  });

  it('light theme large/UI pairs meet 3:1', () => {
    expect(check('light', LARGE_PAIRS)).toEqual([]);
  });
});
