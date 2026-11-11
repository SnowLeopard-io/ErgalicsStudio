// ==========================================================================
// Regression tests for the Pyodide workspace staging diff.
//
// Bug context: the post-run diff used to compare the /workspace tree against
// the *mounted inputs*. Because the FS write/read round-trip is not
// byte-faithful for every content (binary samples staged as text in
// particular), nearly every staged file was flagged as "changed" and
// saveWorkspaceFiles dumped the whole staged tree — bundled examples at the
// workspace root included — into the project on every run, even a bare
// studio.print("hello"). The fix snapshots the mounted tree itself as the
// baseline (read-back vs read-back).
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  collectWorkspaceOutputs,
  mountWorkspace,
  snapshotWorkspace,
  WORKSPACE_ROOT,
  type WorkspaceFs,
} from '@/core/pyodide/workspace-files';

/** In-memory FS faithful to the interface slice the staging logic uses. */
function makeFs(): WorkspaceFs & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>([WORKSPACE_ROOT]);
  const ensure = (dir: string) => {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      dirs.add(cur);
    }
  };
  const full = (path: string) => path;
  return {
    mkdirTree(dir) {
      ensure(dir);
    },
    writeFile(path, data) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir) ensure(dir);
      files.set(full(path), data);
    },
    readdir(dir) {
      if (!dirs.has(dir)) throw new Error(`ENOENT ${dir}`);
      const prefix = dir === '' ? '' : `${dir}/`;
      const names = new Set<string>();
      for (const p of [...files.keys(), ...dirs]) {
        if (p === dir) continue;
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        names.add(rest.split('/')[0]!);
      }
      return [...names];
    },
    readFile(path) {
      const hit = files.get(full(path));
      if (hit === undefined) throw new Error(`ENOENT ${path}`);
      return hit;
    },
    stat(path) {
      if (files.has(full(path))) return { mode: 0o100644, size: files.get(full(path))!.length };
      if (dirs.has(full(path))) return { mode: 0o040755, size: 0 };
      throw new Error(`ENOENT ${path}`);
    },
    isDir(mode) {
      return (mode & 0o170000) === 0o040000;
    },
    dump() {
      return files;
    },
  };
}

describe('pyodide workspace staging', () => {
  it('reports only files the program wrote, never the mounted inputs', () => {
    const fs = makeFs();
    const staged = {
      'python.py': 'studio.print("hello")',
      'data/radar-data.csv': 'a,b\n1,2\n',
      // Basename alias + bundled example, both mounted at the workspace root.
      'radar-data.csv': 'a,b\n1,2\n',
      'boxplot-data.csv': 'x\n3\n',
    };
    mountWorkspace(fs, staged);

    const baseline = snapshotWorkspace(fs);
    // Simulate the run: no file writes at all.
    const outputs = collectWorkspaceOutputs(fs, baseline);
    expect(outputs).toEqual({});
  });

  it('reports created files and modifications, with dirs preserved', () => {
    const fs = makeFs();
    const staged = { 'data/raw.csv': 'a\n1\n' };
    mountWorkspace(fs, staged);
    const baseline = snapshotWorkspace(fs);

    fs.writeFile(`${WORKSPACE_ROOT}/out/result.csv`, 'x\n9\n', { encoding: 'utf8' });
    fs.writeFile(`${WORKSPACE_ROOT}/data/raw.csv`, 'a\n1\n2\n', { encoding: 'utf8' });

    const outputs = collectWorkspaceOutputs(fs, baseline);
    expect(outputs).toEqual({
      'out/result.csv': 'x\n9\n',
      'data/raw.csv': 'a\n1\n2\n',
    });
  });

  it('survives non-byte-faithful read-back (binary staged as text)', () => {
    const fs = makeFs();
    // The real FS can round-trip binary-as-text lossily; both snapshot and
    // post-run read-back must see the SAME string, so no echo is reported.
    const lossy = '\uFFFD\u0001\u0002wav-bytes';
    mountWorkspace(fs, { 'acoustics-demo.wav': lossy });
    const baseline = snapshotWorkspace(fs);
    expect(collectWorkspaceOutputs(fs, baseline)).toEqual({});
  });

  it('ignores __pycache__ artifacts', () => {
    const fs = makeFs();
    mountWorkspace(fs, { 'python.py': 'print(1)' });
    const baseline = snapshotWorkspace(fs);
    fs.writeFile(`${WORKSPACE_ROOT}/__pycache__/python.cpython-312.pyc`, 'pyc', {
      encoding: 'utf8',
    });
    expect(collectWorkspaceOutputs(fs, baseline)).toEqual({});
  });
});
