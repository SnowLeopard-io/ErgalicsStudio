// ==========================================================================
// Ergalics Studio — workspace virtual filesystem (git-free)
//
// The project file explorer and every workspace-file consumer (editors,
// artifact writers, the supplement packager) talk to this interface — NOT to
// the git adapter. Git remains an optional version-control layer on top; the
// plain file tree must never require a repository.
// ==========================================================================

/** One entry of a workspace directory listing (file explorer §UI). */
export interface VfsEntry {
  /** Base name ('run-42.json'), not the full path. */
  name: string;
  /** Workspace-relative path ('runs/run-42.json'). */
  path: string;
  isDir: boolean;
  /** File size in bytes (0 for directories / unknown). */
  size: number;
}

/**
 * Plain filesystem subset over the per-project workspace tree. `root` is the
 * workspace root (getProjectRepoPath), `path`/`dir` are root-relative and
 * use '/' separators. Missing parent directories are auto-created on write.
 */
export interface Vfs {
  /** List one directory. Dirs first, then files, each alphabetically.
   *  Missing dirs yield [] (never throw). */
  readDir(root: string, dirPath: string): Promise<VfsEntry[]>;

  /** Read a UTF-8 text file. */
  readFile(root: string, filePath: string): Promise<string>;

  /** Read raw bytes (no charset decoding). */
  readFileBinary(root: string, filePath: string): Promise<Uint8Array>;

  /** Write a text file (auto-creates parent directories). */
  writeFile(root: string, filePath: string, content: string): Promise<void>;

  /** Write raw bytes (auto-creates parent directories). */
  writeFileBinary(root: string, filePath: string, data: Uint8Array): Promise<void>;

  /** Delete a file (unlink) or a directory (recursive). */
  deleteEntry(root: string, targetPath: string, isDir: boolean): Promise<void>;

  /** Move/rename a file or directory tree. */
  renameEntry(root: string, from: string, to: string): Promise<void>;

  /** Whether a file or directory exists. */
  exists(root: string, targetPath: string): Promise<boolean>;
}
