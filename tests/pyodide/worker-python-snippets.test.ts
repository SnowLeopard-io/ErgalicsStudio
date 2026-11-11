// ==========================================================================
// Regression tests for the Python-source snippets the worker sends.
//
// The worker builds Python code as strings and interpolates paths into it.
// An unquoted path (`_os.chdir(/workspace)`) is a SyntaxError at runtime —
// the kind of failure that only shows up in the browser. These tests assert
// that every interpolated path is a quoted Python literal.
// ==========================================================================

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = '/workspace';

/** Mirrors the worker's restoreCwd snippet. */
function restoreCwdSource(cwd: string): string {
  if (!cwd || cwd === WORKSPACE_ROOT) return '';
  // Only directories INSIDE the workspace may be restored — Pyodide's home
  // (/home/pyodide) sits outside the sandbox and must not win.
  if (!cwd.startsWith(`${WORKSPACE_ROOT}/`)) return '';
  const literal = JSON.stringify(cwd);
  const rootLiteral = JSON.stringify(WORKSPACE_ROOT);
  return `import os as _os\nif _os.path.isdir(${literal}):\n    _os.chdir(${literal})\nelse:\n    _os.chdir(${rootLiteral})`;
}

describe('worker Python snippets quote their paths', () => {
  it('quotes the workspace root', () => {
    const src = restoreCwdSource('/workspace/data');
    expect(src).toContain('_os.chdir("/workspace/data")');
    expect(src).toContain('_os.chdir("/workspace")');
  });

  it('never emits a bare path', () => {
    const src = restoreCwdSource('/workspace/data');
    expect(src).not.toMatch(/chdir\(\/workspace/);
    expect(src).not.toMatch(/isdir\(\//);
  });

  it('escapes quotes and backslashes in the path', () => {
    const src = restoreCwdSource('/workspace/we"ird');
    expect(src).toContain('\\"');
    // A bare quote would break the snippet — the escaped form must parse.
    const quotes = (src.match(/"/g) ?? []).length;
    expect(quotes % 2).toBe(0);
  });

  it('skips the snippet for the workspace root itself', () => {
    expect(restoreCwdSource(WORKSPACE_ROOT)).toBe('');
  });

  it('never restores a directory outside the workspace (Pyodide home)', () => {
    expect(restoreCwdSource('/home/pyodide')).toBe('');
    expect(restoreCwdSource('/tmp')).toBe('');
  });
});
