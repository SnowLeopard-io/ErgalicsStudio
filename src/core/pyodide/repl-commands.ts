// ==========================================================================
// Ergalics Studio — terminal command layer (pure, unit-testable)
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
// Two families live here:
//
//   * PYTHON commands (pwd / cd / ls / cat / head / tail / tree / find /
//     grep / wc / who / time) are translated into a small Python program
//     executed through the SAME repl channel as ordinary lines, so they
//     share the session interpreter, its cwd and its globals — no new RPC.
//   * HOST commands (open / run / touch / reset / pip / help / env / git)
//     act on the workbench itself and are dispatched by the terminal panel
//     (see core/terminal/host-commands).
//
// Anything that does not parse as a command goes to the interpreter verbatim.
// Deliberately conservative: a line like `dir(x)` or `cd = 1` is legal
// Python and must NOT be captured, so commands only match a bare command
// word followed by an argument free of parentheses/equals signs.
// ==========================================================================

export type ReplMagic =
  // python-side
  | 'pwd'
  | 'cd'
  | 'ls'
  | 'cat'
  | 'head'
  | 'tail'
  | 'tree'
  | 'find'
  | 'grep'
  | 'wc'
  | 'who'
  | 'time'
  // host-side (dispatched by the terminal, never executed as Python)
  | 'run'
  | 'open'
  | 'touch'
  | 'reset'
  | 'pip'
  | 'help'
  | 'env'
  | 'git';

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
  head: 'head',
  tail: 'tail',
  tree: 'tree',
  find: 'find',
  grep: 'grep',
  wc: 'wc',
  who: 'who',
  vars: 'who',
  time: 'time',
  // Run a script — the engine follows the file extension.
  run: 'run',
  python: 'run',
  python3: 'run',
  py: 'run',
  node: 'run',
  rscript: 'run',
  // Workbench actions.
  open: 'open',
  edit: 'open',
  code: 'open',
  touch: 'touch',
  reset: 'reset',
  restart: 'reset',
  pip: 'pip',
  help: 'help',
  '?': 'help',
  env: 'env',
  info: 'env',
  git: 'git',
};

const MAGIC_RE = /^(\S+)(\s+([^()=].*))?$/;

/**
 * Parse a terminal line into a command, or null when the line is ordinary
 * Python (or empty). `clear`/`cls` are handled host-side and never reach
 * this parser's output (see TerminalPanel).
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

/** Quote arbitrary text as a Python string literal (public: the terminal
 *  embeds user code into a call expression). */
export function pythonLiteral(text: string): string {
  return pyStr(text);
}

/** Split a command argument into whitespace-separated tokens (honouring
 *  double quotes so `grep "two words" file` works). */
export function splitArgs(arg: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arg)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/**
 * Python source implementing the command, executed via the repl channel.
 * All of them print their result (stdout is captured per session), and
 * errors are caught in-Python so a typo in `cd data/` cannot throw into the
 * worker's repl handler.
 */
export function buildMagicPython(cmd: ReplCommand): string {
  switch (cmd.magic) {
    case 'pwd':
      return `import os\nprint(os.getcwd())`;
    case 'cd': {
      const arg = cmd.arg.trim();
      if (!arg) return `import os\nprint(os.getcwd())`;
      // `cd ..` / `cd ~` behave like every shell: ~ is the workspace root.
      const target = arg === '~' ? "'/workspace'" : pyStr(arg);
      return [
        `import os`,
        `_d = ${target}`,
        `if os.path.isdir(_d):`,
        `    os.chdir(_d)`,
        `    print(os.getcwd())`,
        `elif os.path.isdir(os.path.join(os.getcwd(), _d)):`,
        `    os.chdir(os.path.join(os.getcwd(), _d))`,
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
    case 'cat': {
      if (!cmd.arg) return `print('cat: missing file argument')`;
      return [
        `import os`,
        `_f = ${pyStr(cmd.arg)}`,
        `try:`,
        `    with open(_f, 'r', encoding='utf-8', errors='replace') as _h:`,
        `        _text = _h.read(256 * 1024)`,
        `except OSError as _e:`,
        `    print('cat: ' + str(_e))`,
        `else:`,
        `    print(_text, end='' if _text.endswith('\\n') else '\\n')`,
      ].join('\n');
    }
    case 'head':
    case 'tail': {
      const tokens = splitArgs(cmd.arg);
      const file = tokens[0] ?? '';
      const count = Number(tokens[1] ?? '10');
      if (!file) return `print('${cmd.magic}: missing file argument')`;
      const lines = Number.isFinite(count) && count > 0 ? Math.floor(count) : 10;
      const slice =
        cmd.magic === 'head'
          ? `_lines[:${lines}]`
          : `_lines[-${lines}:]`;
      return [
        `import os`,
        `_f = ${pyStr(file)}`,
        `try:`,
        `    with open(_f, 'r', encoding='utf-8', errors='replace') as _h:`,
        `        _lines = _h.read().splitlines()`,
        `except OSError as _e:`,
        `    print('${cmd.magic}: ' + str(_e))`,
        `else:`,
        `    for _l in ${slice}:`,
        `        print(_l)`,
      ].join('\n');
    }
    case 'tree': {
      const root = cmd.arg ? pyStr(cmd.arg) : `'.'`;
      return [
        `import os`,
        `_root = ${root}`,
        `def _walk(_d, _prefix=''):`,
        `    try:`,
        `        _names = sorted(os.listdir(_d))`,
        `    except OSError:`,
        `        return`,
        `    _dirs = [n for n in _names if os.path.isdir(os.path.join(_d, n))]`,
        `    _files = [n for n in _names if not os.path.isdir(os.path.join(_d, n))]`,
        `    for _i, _n in enumerate(_dirs):`,
        `        print(_prefix + '+-- ' + _n + '/')`,
        `        _walk(os.path.join(_d, _n), _prefix + '|   ')`,
        `    for _n in _files:`,
        `        print(_prefix + '+-- ' + _n)`,
        `print(_root)`,
        `_walk(_root)`,
      ].join('\n');
    }
    case 'find': {
      const pattern = cmd.arg || '*';
      return [
        `import os`,
        `_pat = ${pyStr(pattern).toLowerCase()}`,
        `_hits = 0`,
        `for _root, _dirs, _files in os.walk('.'):`,
        `    _dirs[:] = [d for d in _dirs if d not in ('__pycache__', '.git')]`,
        `    for _f in _files:`,
        `        if _pat in '*' or _pat in _f.lower():`,
        `            _hits += 1`,
        `            print(os.path.join(_root, _f))`,
        `if not _hits:`,
        `    print('no files match: ' + ${pyStr(pattern)})`,
      ].join('\n');
    }
    case 'grep': {
      const tokens = splitArgs(cmd.arg);
      const pattern = tokens[0] ?? '';
      const files = tokens.slice(1);
      if (!pattern) return `print('grep: missing pattern')`;
      const fileList = files.length ? pyStr(files.join('\n')) : `''`;
      return [
        `import os`,
        `_pat = ${pyStr(pattern)}`,
        `_files = ${fileList}.split('\\n') if ${fileList} else []`,
        `if not _files:`,
        `    _files = []`,
        `    for _root, _dirs, _fs in os.walk('.'):`,
        `        _dirs[:] = [d for d in _dirs if d not in ('__pycache__', '.git')]`,
        `        for _f in _fs:`,
        `            if _f.endswith(('.py', '.js', '.r', '.md', '.txt', '.json', '.csv', '.toml', '.yaml', '.yml')):`,
        `                _files.append(os.path.join(_root, _f))`,
        `for _f in _files:`,
        `    try:`,
        `        with open(_f, 'r', encoding='utf-8', errors='replace') as _h:`,
        `            for _i, _line in enumerate(_h, 1):`,
        `                if _pat in _line:`,
        `                    print(f'{_f}:{_i}: ' + _line.rstrip())`,
        `    except OSError:`,
        `        pass`,
      ].join('\n');
    }
    case 'wc': {
      if (!cmd.arg) return `print('wc: missing file argument')`;
      return [
        `import os`,
        `_f = ${pyStr(cmd.arg)}`,
        `try:`,
        `    with open(_f, 'r', encoding='utf-8', errors='replace') as _h:`,
        `        _text = _h.read()`,
        `except OSError as _e:`,
        `    print('wc: ' + str(_e))`,
        `else:`,
        `    _lines = _text.count('\\n') + (0 if _text.endswith('\\n') or not _text else 1)`,
        `    print(f'{_lines} lines, {len(_text.split())} words, {len(_text)} chars')`,
      ].join('\n');
    }
    case 'who': {
      return [
        `import types`,
        `_skip = {'studio', 'random', 're', 'np', 'os', 'sys', 'json', 'io', 'base64', 'contextlib', 'traceback', 'runpy'}`,
        `_names = sorted(k for k in globals() if not k.startswith('_') and k not in _skip)`,
        `print('\\n'.join(_names) if _names else '(no user variables)')`,
      ].join('\n');
    }
    case 'time': {
      const expr = cmd.arg.trim();
      if (!expr) return `print('time: missing expression')`;
      return [
        `import time`,
        `_t0 = time.perf_counter()`,
        `_value = (${expr})`,
        `_dt = (time.perf_counter() - _t0) * 1000`,
        `print(f'{_dt:.3f} ms')`,
        `print(repr(_value))`,
      ].join('\n');
    }
    case 'run': {
      // The engine follows the file extension; this program is the Python
      // path (JS / R scripts are executed by the workbench runtimes).
      if (!cmd.arg) return `print('python: missing script argument')`;
      return [
        `import os`,
        `import runpy`,
        `_f = ${pyStr(cmd.arg)}`,
        `if os.path.isfile(_f):`,
        `    runpy.run_path(_f, init_globals={'studio': studio}, run_name="__main__")`,
        `else:`,
        `    print('python: no such file: ' + _f)`,
      ].join('\n');
    }
    case 'open':
    case 'touch':
    case 'reset':
    case 'pip':
    case 'help':
    case 'env':
    case 'git': {
      // Host-side actions — the terminal dispatches them to the workbench.
      return `pass`;
    }
  }
}

/** True when the line is the host-side clear command (`clear` / `cls`). */
export function isClearCommand(line: string): boolean {
  const t = line.trim().toLowerCase();
  return t === 'clear' || t === 'cls';
}

/** True when the command is handled by the workbench, not by Python. */
export function isHostCommand(magic: ReplMagic): boolean {
  return magic === 'open' || magic === 'touch' || magic === 'reset' || magic === 'pip' ||
    magic === 'help' || magic === 'env' || magic === 'git';
}
