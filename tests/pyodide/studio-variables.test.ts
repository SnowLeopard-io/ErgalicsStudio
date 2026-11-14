// ==========================================================================
// Regression tests for the `studio` Python module's variable helpers.
//
// The worker's `_snapshot_variables` decides what the variables panel shows.
// It used to report EVERY global in the interpreter, so a run inherited the
// leftovers of the previous program and the panel grew with every run.
// `_global_ids` + the `only` filter let the host report just the variables
// the current run defined.
//
// The module source is real Python — Pyodide executes it in the browser.
// These tests run it under CPython (with a `studio_bridge` stub) so a
// syntax error or a wrong filter fails here instead of in the browser.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUDIO_PYTHON_SOURCE } from '@/core/pyodide/studio.py';

let pythonAvailable = true;
try {
  execFileSync('python', ['-c', 'pass'], { stdio: 'ignore' });
} catch {
  pythonAvailable = false;
}

/**
 * A stub for the JS module Pyodide injects (`studio_bridge`). The Python
 * side only calls into it for plots / prints, which these tests never do.
 */
const BRIDGE_STUB = `
def plot(*args, **kwargs):
    pass


def log(*args, **kwargs):
    pass


def notify(*args, **kwargs):
    pass
`;

let stubDir = '';

/** Run a Python snippet with the studio module loaded, return its stdout. */
function runPython(snippet: string): string {
  if (!stubDir) {
    stubDir = mkdtempSync(join(tmpdir(), 'ergalics-studio-'));
    writeFileSync(join(stubDir, 'studio_bridge.py'), BRIDGE_STUB, 'utf8');
  }
  // The stub is found through PYTHONPATH — importing sys in the snippet would
  // add a `sys` global and pollute the very namespace these tests inspect.
  const script = `${STUDIO_PYTHON_SOURCE}\n${snippet}\n`;
  return execFileSync('python', ['-c', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONPATH: stubDir },
  });
}

/** The last non-empty stdout line (the module prints nothing on import). */
function lastLine(out: string): string {
  const lines = out.split('\n').filter((l) => l.trim() !== '');
  return lines[lines.length - 1]?.trim() ?? '';
}

describe.skipIf(!pythonAvailable)('studio.py variable helpers', () => {
  it('the module source is valid Python', () => {
    expect(() => runPython('pass')).not.toThrow();
  });

  it('_global_ids maps every public global to the id of its value', () => {
    const out = runPython(`
alpha = 1
beta = "text"
_private = 2
print([n for n in sorted(_global_ids().keys()) if not n.startswith("st") and n not in ("DataTable", "re")])
`);
    // The bootstrap names (studio / studio_bridge / DataTable / re) are
    // public globals too — the host filters them out separately.
    expect(lastLine(out)).toBe("['alpha', 'beta']");
  });

  it('_global_ids reports a changed id when a name is reassigned', () => {
    const out = runPython(`
value = [1]
before = _global_ids()["value"]
value = [1]
after = _global_ids()["value"]
print(before != after)
`);
    expect(lastLine(out)).toBe('True');
  });

  it('_global_ids reports an unchanged id for a name that was not touched', () => {
    const out = runPython(`
value = [1]
before = _global_ids()["value"]
other = 2
after = _global_ids()["value"]
print(before == after)
`);
    expect(lastLine(out)).toBe('True');
  });

  it('_snapshot_variables reports only the requested names', () => {
    const out = runPython(`
kept = 7
dropped = 8
import json
print(json.dumps(sorted(_snapshot_variables(["kept"]).keys())))
`);
    expect(lastLine(out)).toBe('["kept"]');
  });

  it('_snapshot_variables without a filter reports every public variable', () => {
    const out = runPython(`
one = 1
two = 2
import json
print(json.dumps(sorted(_snapshot_variables().keys())))
`);
    const names = JSON.parse(lastLine(out)) as string[];
    expect(names).toContain('one');
    expect(names).toContain('two');
  });

  it('_snapshot_variables skips private names even when asked for them', () => {
    const out = runPython(`
_secret = 5
import json
print(json.dumps(sorted(_snapshot_variables(["_secret"]).keys())))
`);
    expect(lastLine(out)).toBe('[]');
  });

  it('_snapshot_variables reports a DataTable as a table', () => {
    const out = runPython(`
df = DataTable("t", [("x", [1.0, 2.0])])
import json
print(json.dumps(_snapshot_variables(["df"])["df"]["kind"]))
`);
    expect(lastLine(out)).toBe('"table"');
  });
});
