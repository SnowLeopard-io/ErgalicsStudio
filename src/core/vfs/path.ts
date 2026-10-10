// ==========================================================================
// Ergalics Studio — VFS path guard (shared by every adapter)
//
// Every adapter concatenates `root` + a root-relative path and hands it to
// its backing store. LightningFS normalizes `..` away, so a caller-supplied
// name containing `..` escapes the project directory and lands anywhere in
// the shared IndexedDB filesystem (other projects, `.git/config`, …). The
// guard below is the single choke point: every Vfs method validates its
// relative path BEFORE concatenation, so traversal is impossible regardless
// of how sloppy the caller is. MemoryVfs uses the same guard so unit tests
// exercise browser semantics.
// ==========================================================================

/** Error thrown when a relative path would escape (or corrupt) the root. */
export class VfsPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VfsPathError';
  }
}

/**
 * Validate a root-relative VFS path and return its canonical form.
 *
 * Rejects: NUL bytes, absolute paths (`/…`, `C:…`, `\…`), and any `.`/`..`
 * segment (traversal) — a workspace path is always a plain '/'-separated
 * segment list that stays inside `root`. Backslashes are treated as
 * separators so Windows-style input cannot smuggle a traversal either.
 */
export function safeVfsRelPath(p: string, what = 'path'): string {
  if (p.includes('\0')) throw new VfsPathError(`vfs: NUL byte in ${what}: ${JSON.stringify(p)}`);
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new VfsPathError(`vfs: ${what} must be root-relative: ${JSON.stringify(p)}`);
  }
  const segs = p.split(/[\\/]+/).filter(Boolean);
  if (segs.length === 0) throw new VfsPathError(`vfs: empty ${what}`);
  if (segs.some((s) => s === '.' || s === '..')) {
    throw new VfsPathError(`vfs: ${what} must not contain '.'/'..' segments: ${JSON.stringify(p)}`);
  }
  return segs.join('/');
}

/**
 * `safeVfsRelPath` for directory listings: the empty path (the root itself)
 * is legal. Returns '' for an empty input.
 */
export function safeVfsDirPath(p: string, what = 'dir path'): string {
  if (p === '') return '';
  return safeVfsRelPath(p, what);
}

/**
 * Validate a single entry NAME (new file / rename target) before it is ever
 * joined onto a directory. UI-facing callers use this so a bad name fails
 * with a clear message instead of a raw VfsPathError deeper in the stack.
 */
export function isValidVfsEntryName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (/[/\\\0]/.test(name)) return false;
  return true;
}
