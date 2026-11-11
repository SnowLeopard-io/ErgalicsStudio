// ==========================================================================
// Regression tests for the terminal magic-command layer (repl-commands).
//
// The terminal accepts shell-style commands from users whose habits come
// from any platform (Unix ls/cat/clear, Windows CMD dir/type/cls). The
// parser must map every alias onto one canonical action, normalise Windows
// path separators, and — critically — stay conservative: `dir(x)` and
// `cd = 1` are legal Python and must reach the interpreter untouched.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  buildMagicPython,
  isClearCommand,
  parseReplCommand,
} from '@/core/pyodide/repl-commands';

describe('parseReplCommand — platform aliases', () => {
  it('maps Unix names', () => {
    expect(parseReplCommand('ls')).toEqual({ magic: 'ls', arg: '' });
    expect(parseReplCommand('pwd')).toEqual({ magic: 'pwd', arg: '' });
    expect(parseReplCommand('cat data/raw.csv')).toEqual({
      magic: 'cat',
      arg: 'data/raw.csv',
    });
  });

  it('maps Windows CMD and PowerShell names onto the same actions', () => {
    expect(parseReplCommand('dir')).toEqual({ magic: 'ls', arg: '' });
    expect(parseReplCommand('type data\\raw.csv')).toEqual({
      magic: 'cat',
      arg: 'data/raw.csv',
    });
    expect(parseReplCommand('Get-ChildItem')).toEqual({ magic: 'ls', arg: '' });
  });

  it('matches aliases case-insensitively (CMD users type DIR)', () => {
    expect(parseReplCommand('DIR')).toEqual({ magic: 'ls', arg: '' });
    expect(parseReplCommand('Get-ChildItem'.toUpperCase())).toEqual({
      magic: 'ls',
      arg: '',
    });
  });

  it('normalises backslash path separators to forward slashes', () => {
    expect(parseReplCommand('cd data\\nested')).toEqual({
      magic: 'cd',
      arg: 'data/nested',
    });
    expect(parseReplCommand('ls data\\nested\\dir')).toEqual({
      magic: 'ls',
      arg: 'data/nested/dir',
    });
  });

  it('cd without an argument falls back to pwd semantics', () => {
    expect(parseReplCommand('cd')).toEqual({ magic: 'cd', arg: '' });
  });
});

describe('parseReplCommand — must not capture legal Python', () => {
  it('leaves calls like dir(x) to the interpreter', () => {
    expect(parseReplCommand('dir(x)')).toBeNull();
    expect(parseReplCommand('dir(my_list)')).toBeNull();
  });

  it('leaves assignments like cd = 1 to the interpreter', () => {
    expect(parseReplCommand('cd = 1')).toBeNull();
  });

  it('leaves unknown command words and empty input to the interpreter', () => {
    expect(parseReplCommand('rm -rf /')).toBeNull();
    expect(parseReplCommand('import os')).toBeNull();
    expect(parseReplCommand('  ')).toBeNull();
    expect(parseReplCommand('')).toBeNull();
  });

  it('leaves python-ish prefixed lines alone', () => {
    expect(parseReplCommand('os.chdir("data")')).toBeNull();
  });
});

describe('buildMagicPython', () => {
  it('pwd prints the cwd', () => {
    const py = buildMagicPython({ magic: 'pwd', arg: '' });
    expect(py).toContain('print(os.getcwd())');
  });

  it('cd chdir()s and prints the new cwd', () => {
    const py = buildMagicPython({ magic: 'cd', arg: 'data/raw' });
    expect(py).toContain('_d = "data/raw"');
    expect(py).toContain('os.chdir(_d)');
    expect(py).toContain('print(os.getcwd())');
  });

  it('quotes arguments as Python string literals safely', () => {
    const py = buildMagicPython({ magic: 'cat', arg: 'notes "x" / y.csv' });
    expect(py).toContain('_f = "notes \\"x\\" / y.csv"');
  });

  it('ls without an argument lists the cwd', () => {
    const py = buildMagicPython({ magic: 'ls', arg: '' });
    expect(py).toContain("_d = '.'");
    expect(py).toContain('os.listdir(_d)');
  });

  it('cat without an argument reports the misuse instead of throwing', () => {
    const py = buildMagicPython({ magic: 'cat', arg: '' });
    expect(py).toContain('cat: missing file argument');
  });

  it('every generated program guards its own errors (no worker throw)', () => {
    for (const cmd of [
      { magic: 'ls' as const, arg: 'nope' },
      { magic: 'cat' as const, arg: 'nope.txt' },
    ]) {
      expect(buildMagicPython(cmd)).toMatch(/except OSError/);
    }
  });

  it('cd reports a missing directory through a print, not an exception', () => {
    const py = buildMagicPython({ magic: 'cd', arg: 'nope' });
    expect(py).toMatch(/if os\.path\.isdir[\s\S]*else[\s\S]*no such directory/);
  });
});

describe('isClearCommand — both platform habits clear host-side', () => {
  it('accepts clear and cls, case-insensitive with surrounding space', () => {
    expect(isClearCommand('clear')).toBe(true);
    expect(isClearCommand('  CLS ')).toBe(true);
  });

  it('does not swallow look-alike lines', () => {
    expect(isClearCommand('clearall')).toBe(false);
    expect(isClearCommand('clear()')).toBe(false);
    expect(isClearCommand('ls')).toBe(false);
  });
});
