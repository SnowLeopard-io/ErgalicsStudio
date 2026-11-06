// ==========================================================================
// Ergalics Studio — workspace naming for exported manuscripts
//
// File names follow manuscript names (HELLO → manuscript/HELLO.tex). The
// same manuscript re-exports over its own bundle; name collisions get -2,
// -3, …, which keeps the LaTeX editor and the file manager in agreement.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  manuscriptBundle,
  manuscriptStem,
  nextWorkspaceStem,
} from '@/core/publish/unique';

describe('manuscriptStem', () => {
  it('preserves readable letters and digits', () => {
    expect(manuscriptStem('HELLO')).toBe('HELLO');
    expect(manuscriptStem('Paper 2026')).toBe('Paper-2026');
    expect(manuscriptStem('我的论文')).toBe('我的论文');
  });

  it('replaces path separators, whitespace and illegal characters', () => {
    expect(manuscriptStem('a/b:c*d?e')).toBe('a-b-c-d-e');
    expect(manuscriptStem('  spaced  name  ')).toBe('spaced-name');
  });

  it('strips leading/trailing dots and falls back when empty', () => {
    expect(manuscriptStem('.hidden.')).toBe('hidden');
    expect(manuscriptStem('   ')).toBe('manuscript');
    expect(manuscriptStem('///', 'paper')).toBe('paper');
  });
});

describe('nextWorkspaceStem', () => {
  it('uses the manuscript name when it is free', () => {
    expect(nextWorkspaceStem('HELLO', [])).toBe('HELLO');
  });

  it('numbers a duplicate manuscript name', () => {
    expect(nextWorkspaceStem('HELLO', ['HELLO'])).toBe('HELLO-2');
  });

  it('walks past already-numbered stems', () => {
    expect(nextWorkspaceStem('HELLO', ['HELLO', 'HELLO-2', 'HELLO-3'])).toBe('HELLO-4');
  });

  it('compares case-insensitively (Windows / macOS filesystems)', () => {
    expect(nextWorkspaceStem('Hello', ['HELLO'])).toBe('Hello-2');
  });

  it('ignores unassigned (legacy) manuscripts', () => {
    expect(nextWorkspaceStem('HELLO', [undefined, null])).toBe('HELLO');
  });
});

describe('manuscriptBundle', () => {
  it('places the tex and pdf beside the shared references.bib', () => {
    expect(manuscriptBundle('HELLO')).toEqual({
      tex: 'manuscript/HELLO.tex',
      pdf: 'manuscript/HELLO.pdf',
    });
  });
});
