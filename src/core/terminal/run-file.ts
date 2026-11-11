// ==========================================================================
// Ergalics Studio — run a project script from the terminal
//
// The terminal is language-agnostic: `python script.py`, `node app.js` and
// `rscript stats.R` all run in the engine that matches the file, using the
// SAME engines the code workbench uses:
//
//   .py          → Pyodide (the session interpreter, executed by the caller
//                  so the output lands in the right terminal session)
//   .js / .mjs   → the in-process IR interpreter (editor/runtime/interpreter)
//   .r / .R      → the R runtime (webR when available, builtin IR otherwise)
//
// Every engine gets the project workspace as its file set, so a script can
// read the data files of the project it lives in.
// ==========================================================================

import { parseCodeToIR } from '@/editor/code/parse';
import { interpret } from '@/editor/runtime/interpreter';
import { createWorkbenchStudioApi } from '@/editor/runtime/workbench-host';
import { createRRuntime } from '@/core/r/runtime-factory';
import { collectRuntimeFiles } from '@/core/dataFiles';

export type ScriptEngine = 'python' | 'js' | 'r' | 'unknown';

export interface ScriptRunResult {
  ok: boolean;
  engine: ScriptEngine;
  stdout: string;
  error?: string;
}

/** Pick the engine for a file name (by extension). */
export function engineForFile(name: string): ScriptEngine {
  const lower = name.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.r') || lower.endsWith('.rscript')) return 'r';
  return 'unknown';
}

/**
 * Resolve a terminal path against the interpreter's cwd.
 * `..` and `.` are folded, `~` means the workspace root.
 */
export function resolvePath(cwd: string, arg: string): string {
  const raw = arg.trim().replace(/\\/g, '/');
  if (raw.startsWith('/')) return normalizeSegments(raw);
  if (raw === '~' || raw.startsWith('~/')) {
    return normalizeSegments(`/workspace/${raw.slice(1)}`);
  }
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return normalizeSegments(base + raw);
}

function normalizeSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

/**
 * Python program that runs a script file by ABSOLUTE path, so it works no
 * matter which directory the interpreter currently sits in.
 */
export function pythonRunProgram(absPath: string): string {
  return [
    `import os`,
    `import runpy`,
    `_f = ${JSON.stringify(absPath)}`,
    `if os.path.isfile(_f):`,
    `    runpy.run_path(_f, run_name="__main__")`,
    `else:`,
    `    print('python: no such file: ' + _f)`,
  ].join('\n');
}

/** Run a JavaScript source file through the in-process IR interpreter. */
async function runJsSource(code: string): Promise<ScriptRunResult> {
  try {
    const { program } = parseCodeToIR(code, 'js');
    const result = await interpret(program, createWorkbenchStudioApi());
    if (result.ok) return { ok: true, engine: 'js', stdout: '' };
    return {
      ok: false,
      engine: 'js',
      stdout: '',
      error: result.error?.message ?? 'run failed',
    };
  } catch (err) {
    return {
      ok: false,
      engine: 'js',
      stdout: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run an R source file through the R runtime (webR or builtin IR). */
async function runRSource(code: string): Promise<ScriptRunResult> {
  try {
    const { runtime } = await createRRuntime({ getStudioApi: createWorkbenchStudioApi });
    const files = await collectRuntimeFiles();
    const result = await runtime.exec(code, files);
    if (result.ok) {
      return { ok: true, engine: 'r', stdout: result.stdout ?? '' };
    }
    return {
      ok: false,
      engine: 'r',
      stdout: result.stdout ?? '',
      error: result.error ?? 'run failed',
    };
  } catch (err) {
    return {
      ok: false,
      engine: 'r',
      stdout: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run a non-Python script file. Python scripts are executed by the caller
 * (they must run inside the terminal's capture channel so the output stays
 * in the session that typed the command).
 */
export async function runScriptFile(
  path: string,
  source: string,
): Promise<ScriptRunResult> {
  const engine = engineForFile(path);
  if (engine === 'js') return runJsSource(source);
  if (engine === 'r') return runRSource(source);
  return {
    ok: false,
    engine: 'unknown',
    stdout: '',
    error: `cannot run ${path}: unsupported file type`,
  };
}