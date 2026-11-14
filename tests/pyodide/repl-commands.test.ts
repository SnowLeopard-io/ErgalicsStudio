// ==========================================================================
// Regression tests for the terminal command layer.
//
// The terminal is the bridge between the shell surface and the workbench:
// its parser must map every platform alias onto one canonical action, stay
// conservative with legal Python, and translate the shell-ish commands into
// Python programs that work on the interpreter's POSIX-like MEMFS.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  buildMagicPython,
  isClearCommand,
  isHostCommand,
  parseReplCommand,
  splitArgs,
} from '@/core/pyodide/repl-commands';
import { engineForFile, pythonRunProgram, resolvePath } from '@/core/terminal/run-file';
import { toProjectPath } from '@/core/workspace/open-file';

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
  });

  it('maps the shell tools and the workbench commands', () => {
    expect(parseReplCommand('head a.txt')).toEqual({ magic: 'head', arg: 'a.txt' });
    expect(parseReplCommand('tail a.txt 5')).toEqual({ magic: 'tail', arg: 'a.txt 5' });
    expect(parseReplCommand('tree data')).toEqual({ magic: 'tree', arg: 'data' });
    expect(parseReplCommand('find report')).toEqual({ magic: 'find', arg: 'report' });
    expect(parseReplCommand('grep TODO a.py')).toEqual({ magic: 'grep', arg: 'TODO a.py' });
    expect(parseReplCommand('wc a.txt')).toEqual({ magic: 'wc', arg: 'a.txt' });
    expect(parseReplCommand('who')).toEqual({ magic: 'who', arg: '' });
    expect(parseReplCommand('time 1+1')).toEqual({ magic: 'time', arg: '1+1' });
    expect(parseReplCommand('open hello.py')).toEqual({ magic: 'open', arg: 'hello.py' });
    expect(parseReplCommand('touch notes.md')).toEqual({ magic: 'touch', arg: 'notes.md' });
    expect(parseReplCommand('git status')).toEqual({ magic: 'git', arg: 'status' });
    expect(parseReplCommand('pip install scipy')).toEqual({
      magic: 'pip',
      arg: 'install scipy',
    });
  });

  it('maps the script runners onto one run command', () => {
    expect(parseReplCommand('python a.py')).toEqual({ magic: 'run', arg: 'a.py' });
    expect(parseReplCommand('python3 a.py')).toEqual({ magic: 'run', arg: 'a.py' });
    expect(parseReplCommand('node a.js')).toEqual({ magic: 'run', arg: 'a.js' });
    expect(parseReplCommand('rscript a.R')).toEqual({ magic: 'run', arg: 'a.R' });
    expect(parseReplCommand('run a.py')).toEqual({ magic: 'run', arg: 'a.py' });
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
    expect(buildMagicPython({ magic: 'pwd', arg: '' })).toContain('print(os.getcwd())');
  });

  it('cd chdir()s and prints the new cwd', () => {
    const py = buildMagicPython({ magic: 'cd', arg: 'data/raw' });
    expect(py).toContain('_d = "data/raw"');
    expect(py).toContain('os.chdir(_d)');
    expect(py).toContain('print(os.getcwd())');
  });

  it('cd resolves a relative path against the current directory', () => {
    const py = buildMagicPython({ magic: 'cd', arg: 'sub' });
    expect(py).toContain('os.chdir(os.path.join(os.getcwd(), _d))');
  });

  it('cd ~ means the workspace root', () => {
    expect(buildMagicPython({ magic: 'cd', arg: '~' })).toContain("_d = '/workspace'");
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
    expect(buildMagicPython({ magic: 'cat', arg: '' })).toContain('cat: missing file argument');
  });

  it('head/tail slice the file lines', () => {
    const head = buildMagicPython({ magic: 'head', arg: 'a.txt 3' });
    expect(head).toContain('_lines[:3]');
    const tail = buildMagicPython({ magic: 'tail', arg: 'a.txt' });
    expect(tail).toContain('_lines[-10:]');
  });

  it('tree walks the directory recursively', () => {
    expect(buildMagicPython({ magic: 'tree', arg: '' })).toContain('_walk(_root)');
  });

  it('find searches file names case-insensitively', () => {
    const py = buildMagicPython({ magic: 'find', arg: 'Report' });
    expect(py).toContain('_pat = "report"');
    expect(py).toContain('os.walk');
  });

  it('grep searches file contents and prints file:line', () => {
    const py = buildMagicPython({ magic: 'grep', arg: 'TODO' });
    expect(py).toContain('_pat = "TODO"');
    expect(py).toContain('os.walk');
  });

  it('who lists the user variables only', () => {
    const py = buildMagicPython({ magic: 'who', arg: '' });
    expect(py).toContain('globals()');
    expect(py).toContain("_skip");
  });

  it('time measures an expression', () => {
    const py = buildMagicPython({ magic: 'time', arg: '1+1' });
    expect(py).toContain('_value = (1+1)');
    expect(py).toContain('perf_counter');
  });

  it('run executes a script file with the studio API available', () => {
    const py = buildMagicPython({ magic: 'run', arg: 'hello.py' });
    expect(py).toContain('runpy.run_path(_f');
    expect(py).toContain("init_globals={'studio': studio}");
  });

  it('every generated program guards its own errors (no worker throw)', () => {
    for (const cmd of [
      { magic: 'ls' as const, arg: 'nope' },
      { magic: 'cat' as const, arg: 'nope.txt' },
      { magic: 'wc' as const, arg: 'nope.txt' },
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

describe('isHostCommand — workbench commands never reach Python', () => {
  it('routes the workbench commands to the host', () => {
    expect(isHostCommand('open')).toBe(true);
    expect(isHostCommand('touch')).toBe(true);
    expect(isHostCommand('git')).toBe(true);
    expect(isHostCommand('pip')).toBe(true);
    expect(isHostCommand('reset')).toBe(true);
    expect(isHostCommand('help')).toBe(true);
    expect(isHostCommand('env')).toBe(true);
  });

  it('keeps the shell tools in Python', () => {
    expect(isHostCommand('ls')).toBe(false);
    expect(isHostCommand('cd')).toBe(false);
    expect(isHostCommand('run')).toBe(false);
  });
});

describe('splitArgs — quoted arguments stay one token', () => {
  it('splits on whitespace', () => {
    expect(splitArgs('a b c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps quoted text together', () => {
    expect(splitArgs('"two words" file.txt')).toEqual(['two words', 'file.txt']);
  });
});

describe('path helpers', () => {
  it('resolves relative paths against the cwd', () => {
    expect(resolvePath('/workspace', 'data/raw.csv')).toBe('/workspace/data/raw.csv');
    expect(resolvePath('/workspace/data', 'raw.csv')).toBe('/workspace/data/raw.csv');
  });

  it('folds . and .. segments', () => {
    expect(resolvePath('/workspace/data', '../docs')).toBe('/workspace/docs');
    expect(resolvePath('/workspace', './a/b')).toBe('/workspace/a/b');
  });

  it('maps ~ to the workspace root', () => {
    expect(resolvePath('/workspace/data', '~/hello.py')).toBe('/workspace/hello.py');
  });

  it('maps interpreter paths to project paths', () => {
    expect(toProjectPath('/workspace/data/raw.csv')).toBe('data/raw.csv');
    expect(toProjectPath('data/raw.csv')).toBe('data/raw.csv');
  });
});

describe('engineForFile — one terminal, several languages', () => {
  it('picks the engine from the extension', () => {
    expect(engineForFile('a.py')).toBe('python');
    expect(engineForFile('a.js')).toBe('js');
    expect(engineForFile('a.mjs')).toBe('js');
    expect(engineForFile('a.R')).toBe('r');
    expect(engineForFile('a.txt')).toBe('unknown');
  });
});

describe('pythonRunProgram — scripts run from any directory', () => {
  it('runs the file by absolute path', () => {
    const py = pythonRunProgram('/workspace/data/run.py');
    expect(py).toContain('_f = "/workspace/data/run.py"');
    expect(py).toContain('runpy.run_path(_f');
    expect(py).toContain('run_name="__main__"');
  });

  it('gives the script the studio API (like the editor run button)', () => {
    const py = pythonRunProgram('/workspace/run.py');
    expect(py).toContain("init_globals={'studio': studio}");
  });
});
