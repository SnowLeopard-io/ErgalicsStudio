// ==========================================================================
// Ergalics Studio — Pyodide workspace staging (pure, unit-testable)
//
// Mount / snapshot / diff logic for the code-mode worker's /workspace tree.
// Extracted from pyodide-worker.ts so the run-output semantics can be tested
// without a real Pyodide interpreter: the FS is an injectable interface.
// ==========================================================================

/** The interpreter runs with /workspace as its cwd; all paths are relative. */
export const WORKSPACE_ROOT = '/workspace';

/** Cap for staging one workspace file into a runtime (avoid multi-MB JSON). */
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Minimal slice of Emscripten's FS the staging logic touches. */
export interface WorkspaceFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: string, opts?: { encoding?: 'utf8' }): void;
  readdir(path: string): string[];
  readFile(path: string, opts?: { encoding: 'utf8' }): string;
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
}

/** Normalise a workspace path: forward slashes, no leading slash or `..`. */
export function normalizeRel(path: string): string | null {
  const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.split('/').includes('..')) return null;
  return rel;
}

function ensureDir(fs: WorkspaceFs, dir: string): void {
  try {
    fs.mkdirTree(dir);
  } catch {
    /* already exists */
  }
}

/** Mount the workspace tree into the interpreter's MEMFS. */
export function mountWorkspace(fs: WorkspaceFs, files: Record<string, string>): void {
  ensureDir(fs, WORKSPACE_ROOT);
  for (const [path, text] of Object.entries(files)) {
    const rel = normalizeRel(path);
    if (!rel) continue;
    const full = `${WORKSPACE_ROOT}/${rel}`;
    try {
      ensureDir(fs, full.slice(0, full.lastIndexOf('/')));
      fs.writeFile(full, text, { encoding: 'utf8' });
    } catch {
      /* unreadable source — skip rather than fail the whole run */
    }
  }
}

/**
 * Files under /workspace that the program created or changed. Compared
 * against `baseline` — a snapshot of the *mounted tree itself* (see
 * `snapshotWorkspace`), so a script can write `out/result.csv`
 * (relative to cwd) or `data/clean.csv` and both reach the project tree.
 */
export function collectWorkspaceOutputs(
  fs: WorkspaceFs,
  baseline: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.' || name === '..' || name === '__pycache__') continue;
      const full = `${dir}/${name}`;
      const rel = prefix ? `${prefix}/${name}` : name;
      let stat: { mode: number; size: number };
      try {
        stat = fs.stat(full);
      } catch {
        continue;
      }
      if (fs.isDir(stat.mode)) {
        walk(full, rel);
        continue;
      }
      if (stat.size > MAX_OUTPUT_BYTES) continue;
      let text: string;
      try {
        text = fs.readFile(full, { encoding: 'utf8' });
      } catch {
        continue; // binary output — the workspace only stores text
      }
      if (baseline[rel] === text) continue;
      out[rel] = text;
    }
  };
  walk(WORKSPACE_ROOT, '');
  return out;
}

/**
 * Snapshot of every readable text file currently under /workspace.
 *
 * The post-run diff must compare read-back against read-back: comparing the
 * tree against the *mounted inputs* used to flag nearly every staged file as
 * "changed" (the FS write/read round-trip is not byte-faithful for all
 * content — binary samples imported as text in particular), which dumped the
 * whole staged tree — bundled examples at the workspace root included — into
 * the project on every single run, even a bare `studio.print("hello")`.
 */
export function snapshotWorkspace(fs: WorkspaceFs): Record<string, string> {
  return collectWorkspaceOutputs(fs, {});
}
