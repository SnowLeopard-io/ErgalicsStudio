// ==========================================================================
// Ergalics Studio — terminal magic commands (pure, unit-testable)
//
// The workbench terminal accepts a small set of shell-style commands on top
// of raw Python. The command layer is SHELL-AGNOSTIC: every platform's
// habitual names (Unix `ls`/`cat`/`clear`, Windows CMD `dir`/`type`/`cls`,
// plus `pwd`/`cd` which mean the same everywhere) map onto one canonical
// action, and path arguments with `\` separators are normalised to `/`
// because the interpreter runs on a POSIX-like MEMFS. The result is a
// terminal that feels native whether the user came from macOS, Windows,
// Linux or HarmonyOS habits — while executing uniformly against the
// session's virtual /workspace, not the host OS.
//
// Each magic is translated into a small Python program executed through the
// SAME repl channel as ordinary lines, so it shares the session interpreter,
// its cwd and its globals — no new RPC needed.
//
// Anything that does not parse as a magic goes to the interpreter verbatim.
// Deliberately conservative: a line like `dir(x)` or `cd = 1` is legal
// Python and must NOT be captured, so magics only match a bare command word
// followed by an argument free of parentheses/equals signs.
// ==========================================================================

export type ReplMagic = 'pwd' | 'cd' | 'ls' | 'cat' | 'python' | 'open';

export interface ReplCommand {
  magic: ReplMagic;
  /** Argument with `\` separators normalised to `/`. */
  arg: string;
}

/**
 * Platform-alias table: Unix (macOS / Linux / HarmonyOS shell habits) and
 * Windows CMD names converge onto one canonical action. Matched
 * case-insensitively — CMD users habitually type `DIR`.
 */
const ALIASES: Record<string, ReplMagic> = {
  pwd: 'pwd',
  cd: 'cd',
  ls: 'ls',
  dir: 'ls',
  'get-childitem': 'ls',
  cat: 'cat',
  type: 'cat',
  // `python file.py` / `python3 file.py` run a workspace script, `run` too.
  python: 'python',
  python3: 'python',
  py: 'python',
  run: 'python',
  // `open file` opens the file in the workbench (host-side action).
  open: 'open',
  edit: 'open',
  code: 'open',
};

const MAGIC_RE = /^(\S+)(\s+([^()=].*))?$/;

/**
 * Parse a terminal line into a magic command, or null when the line is
 * ordinary Python (or empty). `clear`/`cls` are handled host-side and never
 * reach this parser's output (see TerminalPanel).
 */
export function parseReplCommand(line: string): ReplCommand | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = MAGIC_RE.exec(trimmed);
  if (!m) return null;
  const magic = ALIASES[m[1]!.toLowerCase()];
  if (!magic) return null;
  // MEMFS is POSIX: backslash separators (the Windows habit) mean nothing to
  // os.listdir/os.chdir, so normalise them before the argument reaches Python.
  const arg = (m[3] ?? '').trim().replace(/\\/g, '/');
  return { magic, arg };
}

/** Quote a terminal argument as a Python string literal. */
function pyStr(text: string): string {
  return JSON.stringify(text);
}

/**
 * Python source implementing the magic, executed via the repl channel.
 * All of them print their result (stdout is streamed to the console), and
 * errors are caught in-Python so a typo in `cd data/` cannot throw into the
 * worker's repl handler.
 */
export function buildMagicPython(cmd: ReplCommand): string {
  switch (cmd.magic) {
    case 'pwd':
      return `import os\nprint(os.getcwd())`;
    case 'cd': {
      if (!cmd.arg) return `import os\nprint(os.getcwd())`;
      return [
        `import os`,
        `_d = ${pyStr(cmd.arg)}`,
        `if os.path.isdir(_d):`,
        `    os.chdir(_d)`,
        `    print(os.getcwd())`,
        `else:`,
        `    print('cd: no such directory: ' + _d)`,
      ].join('\n');
    }
    case 'ls': {
      const target = cmd.arg ? pyStr(cmd.arg) : `'.'`;
      return [
        `import os`,
        `_d = ${target}`,
        `try:`,
        `    _names = sorted(os.listdir(_d))`,
        `except OSError as _e:`,
        `    print('ls: ' + str(_e))`,
        `else:`,
        `    if not _names:`,
        `        print('(empty)')`,
        `    for _n in _names:`,
        `        _full = os.path.join(_d, _n)`,
        `        print(('<dir>  ' if os.path.isdir(_full) else '       ') + _n)`,
      ].join('\n');
    }
    case 'python': {
      if (!cmd.arg) return `print('python: missing script argument')`;
      return [
        `import os`,
        `import runpy`,
        `_f = ${pyStr(cmd.arg)}`,
        `if os.path.isfile(_f):`,
        `    runpy.run_path(_f, run_name="__main__")`,
        `else:`,
        `    print('python: no such file: ' + _f)`,
      ].join('\n');
    }
    case 'open': {
      // Host-side action (the workbench opens the file), never executed here.
      return `pass`;
    }
    case 'cat': {
      if (!cmd.arg) return `print('cat: missing file argument')`;
      return [
        `import os`,
        `_f = ${pyStr(cmd.arg)}`,
        `try:`,
        `    with open(_f, 'r', encoding='utf-8', errors='replace') as _h:`,
        `        _text = _h.read(64 * 1024)`,
        `except OSError as _e:`,
        `    print('cat: ' + str(_e))`,
        `else:`,
        `    print(_text, end='' if _text.endswith('\\n') else '\\n')`,
      ].join('\n');
    }
  }
}

/** True when the line is the host-side clear command (`clear` / `cls`). */
export function isClearCommand(line: string): boolean {
  const t = line.trim().toLowerCase();
  return t === 'clear' || t === 'cls';
}
