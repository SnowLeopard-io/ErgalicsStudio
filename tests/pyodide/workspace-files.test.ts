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
function makeFs(): WorkspaceFs & {
  dump(): Map<string, string | Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): void;
} {
  const files = new Map<string, string | Uint8Array>();
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
  const bytesOf = (value: string | Uint8Array): Uint8Array =>
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
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
      if (typeof hit !== 'string') throw new Error(`binary file: ${path}`);
      return hit;
    },
    readFileBinary(path) {
      const hit = files.get(full(path));
      if (hit === undefined) throw new Error(`ENOENT ${path}`);
      return bytesOf(hit);
    },
    stat(path) {
      const hit = files.get(full(path));
      if (hit !== undefined) return { mode: 0o100644, size: bytesOf(hit).length };
      if (dirs.has(full(path))) return { mode: 0o040755, size: 0 };
      throw new Error(`ENOENT ${path}`);
    },
    isDir(mode) {
      return (mode & 0o170000) === 0o040000;
    },
    writeBytes(path, bytes) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir) ensure(dir);
      files.set(full(path), bytes);
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
    expect(outputs).toEqual({ files: {}, binaryFiles: {} });
  });

  it('reports created files and modifications, with dirs preserved', () => {
    const fs = makeFs();
    const staged = { 'data/raw.csv': 'a\n1\n' };
    mountWorkspace(fs, staged);
    const baseline = snapshotWorkspace(fs);

    fs.writeFile(`${WORKSPACE_ROOT}/out/result.csv`, 'x\n9\n', { encoding: 'utf8' });
    fs.writeFile(`${WORKSPACE_ROOT}/data/raw.csv`, 'a\n1\n2\n', { encoding: 'utf8' });

    const outputs = collectWorkspaceOutputs(fs, baseline);
    expect(outputs.files).toEqual({
      'out/result.csv': 'x\n9\n',
      'data/raw.csv': 'a\n1\n2\n',
    });
    expect(outputs.binaryFiles).toEqual({});
  });

  it('survives non-byte-faithful read-back (binary staged as text)', () => {
    const fs = makeFs();
    // The real FS can round-trip binary-as-text lossily; both snapshot and
    // post-run read-back must see the SAME string, so no echo is reported.
    const lossy = '\uFFFD\u0001\u0002wav-bytes';
    mountWorkspace(fs, { 'acoustics-demo.wav': lossy });
    const baseline = snapshotWorkspace(fs);
    expect(collectWorkspaceOutputs(fs, baseline)).toEqual({ files: {}, binaryFiles: {} });
  });

  it('ignores __pycache__ artifacts', () => {
    const fs = makeFs();
    mountWorkspace(fs, { 'python.py': 'print(1)' });
    const baseline = snapshotWorkspace(fs);
    fs.writeFile(`${WORKSPACE_ROOT}/__pycache__/python.cpython-312.pyc`, 'pyc', {
      encoding: 'utf8',
    });
    expect(collectWorkspaceOutputs(fs, baseline)).toEqual({ files: {}, binaryFiles: {} });
  });

  it('reports binary outputs (e.g. a matplotlib PNG) as base64', () => {
    const fs = makeFs();
    mountWorkspace(fs, { 'python.py': 'plt.savefig("figures/plot.png")' });
    const baseline = snapshotWorkspace(fs);

    // PNG magic + a NUL byte + arbitrary payload: not valid UTF-8 text.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    fs.writeBytes(`${WORKSPACE_ROOT}/figures/plot.png`, png);

    const outputs = collectWorkspaceOutputs(fs, baseline);
    expect(outputs.files).toEqual({});
    expect(Object.keys(outputs.binaryFiles)).toEqual(['figures/plot.png']);
    expect(atob(outputs.binaryFiles['figures/plot.png']!)).toBe(
      String.fromCharCode(...png),
    );

    // A second diff against the new snapshot must not re-report the figure.
    const nextBaseline = snapshotWorkspace(fs);
    expect(collectWorkspaceOutputs(fs, nextBaseline)).toEqual({
      files: {},
      binaryFiles: {},
    });
  });
});
