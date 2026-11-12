// ==========================================================================
// Ergalics Studio — Pyodide workspace staging (pure, unit-testable)
//
// Mount / snapshot / diff logic for the code-mode worker's /workspace tree.
// Extracted from pyodide-worker.ts so the run-output semantics can be tested
// without a real Pyodide interpreter: the FS is an injectable interface.
//
// Outputs are split into text and binary (base64). Text covers scripts,
// CSV/JSON/Markdown and friends; binary covers what the scientific stack
// writes — matplotlib's PNG/SVG-adjacent figures, PDFs, .npy/.npz, archives —
// which used to be silently dropped by a UTF-8-only read.
// ==========================================================================

/** The interpreter runs with /workspace as its cwd; all paths are relative. */
export const WORKSPACE_ROOT = '/workspace';

/**
 * Cap for one output file read back from the interpreter. Figures are the
 * reason this is not tiny: a 300-dpi matplotlib PNG can be several MB.
 */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Minimal slice of Emscripten's FS the staging logic touches. */
export interface WorkspaceFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: string, opts?: { encoding?: 'utf8' }): void;
  readdir(path: string): string[];
  readFile(path: string, opts?: { encoding: 'utf8' }): string;
  /** Raw bytes — Emscripten's `readFile(path, { encoding: 'binary' })`. */
  readFileBinary(path: string): Uint8Array;
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
}

/** Everything under /workspace, split by representation. */
export interface WorkspaceSnapshot {
  /** UTF-8 text files, keyed by workspace-relative path. */
  files: Record<string, string>;
  /** Binary files as base64, keyed by workspace-relative path. */
  binaryFiles: Record<string, string>;
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

/** Decode UTF-8 bytes, or null when the content is not valid text. */
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeText(bytes: Uint8Array): string | null {
  // A NUL byte is a strong binary signal even when the rest happens to be
  // valid UTF-8 (text files never carry one).
  if (bytes.includes(0)) return null;
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/** Base64-encode bytes in chunks so a large figure never blows the stack. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Everything the program created or changed since `baseline`.
 *
 * A file is reported when its decoded text / base64 bytes differ from the
 * baseline copy. Comparing read-back against read-back (rather than against
 * the staged inputs) keeps mounts from echoing into the project.
 */
export function collectWorkspaceOutputs(
  fs: WorkspaceFs,
  baseline: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const out: WorkspaceSnapshot = { files: {}, binaryFiles: {} };
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
      let bytes: Uint8Array;
      try {
        bytes = fs.readFileBinary(full);
      } catch {
        continue;
      }
      const text = decodeText(bytes);
      if (text === null) {
        const b64 = encodeBase64(bytes);
        if (baseline.binaryFiles[rel] === b64) continue;
        out.binaryFiles[rel] = b64;
        continue;
      }
      if (baseline.files[rel] === text) continue;
      out.files[rel] = text;
    }
  };
  walk(WORKSPACE_ROOT, '');
  return out;
}

/**
 * Snapshot of every readable file currently under /workspace.
 *
 * The post-run diff must compare read-back against read-back: comparing the
 * tree against the *mounted inputs* used to flag nearly every staged file as
 * "changed" (the FS write/read round-trip is not byte-faithful for all
 * content), which dumped the whole staged tree — bundled examples at the
 * workspace root included — into the project on every single run, even a bare
 * `studio.print("hello")`.
 */
export function snapshotWorkspace(fs: WorkspaceFs): WorkspaceSnapshot {
  return collectWorkspaceOutputs(fs, { files: {}, binaryFiles: {} });
}
