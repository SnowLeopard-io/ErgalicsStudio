// ==========================================================================
// Ergalics Studio — Git types & interfaces (pure TS, platform-agnostic)
// ==========================================================================

export interface GitStatus {
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  currentBranch: string;
  currentCommit?: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: { name: string; email: string };
  timestamp: number;
  parents: string[];
  // Ergalics extensions
  runIds?: string[];
  figureIds?: string[];
  manuscriptChanged?: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: GitCommit;
}

export interface GitRemote {
  name: string;
  url: string;
  fetchRef?: string;
}

export interface DiffOptions {
  filePath?: string;
  staged?: boolean;
  commitA?: string;
  commitB?: string;
}

export interface DiffResult {
  filePath: string;
  oldPath?: string;
  newPath?: string;
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface LogOptions {
  limit?: number;
  since?: number;
  until?: number;
  author?: string;
  path?: string;
  skip?: number;
}

export interface CloneOptions {
  depth?: number;
  branch?: string;
  singleBranch?: boolean;
  /** Per-call CORS proxy override (falls back to the persisted global one). */
  corsProxy?: string;
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

export interface CommitOptions {
  author?: { name: string; email: string };
  allowEmpty?: boolean;
  sign?: boolean;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  commitHash?: string;
}

export interface PushOptions {
  remote: string;
  branch: string;
  force?: boolean;
  setUpstream?: boolean;
  corsProxy?: string;
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

export interface PullOptions {
  remote: string;
  branch: string;
  rebase?: boolean;
  corsProxy?: string;
}

export type HookType =
  | 'pre-commit'
  | 'prepare-commit-msg'
  | 'commit-msg'
  | 'post-commit'
  | 'pre-push'
  | 'post-checkout'
  | 'post-merge'
  | 'pre-rebase';

export interface GitHook {
  type: HookType;
  content: string;
}

/** One entry of a repo directory listing (file explorer §UI). */
export interface RepoEntry {
  /** Base name ('run-42.json'), not the full path. */
  name: string;
  /** Repo-relative path ('runs/run-42.json'). */
  path: string;
  isDir: boolean;
  /** File size in bytes (0 for directories / unknown). */
  size: number;
}

export interface GitAdapter {
  // Repository lifecycle
  init(repoPath: string, template?: 'standard' | 'minimal'): Promise<void>;
  clone(url: string, targetPath: string, opts?: CloneOptions): Promise<void>;
  isRepo(repoPath: string): Promise<boolean>;

  // Status & info
  status(repoPath: string): Promise<GitStatus>;
  log(repoPath: string, opts?: LogOptions): Promise<GitCommit[]>;
  diff(repoPath: string, opts?: DiffOptions): Promise<DiffResult[]>;
  branches(repoPath: string): Promise<GitBranch[]>;
  remotes(repoPath: string): Promise<GitRemote[]>;

  // Write operations
  add(repoPath: string, files: string[]): Promise<void>;
  commit(repoPath: string, message: string, opts?: CommitOptions): Promise<string>;
  checkout(repoPath: string, ref: string, create?: boolean): Promise<void>;
  branch(repoPath: string, name: string, startPoint?: string): Promise<void>;
  deleteBranch(repoPath: string, name: string, force?: boolean): Promise<void>;
  merge(repoPath: string, branch: string): Promise<MergeResult>;

  // Remote operations
  push(repoPath: string, opts: PushOptions): Promise<void>;
  pull(repoPath: string, opts: PullOptions): Promise<void>;
  fetch(repoPath: string, remote: string): Promise<void>;
  addRemote(repoPath: string, name: string, url: string): Promise<void>;
  removeRemote(repoPath: string, name: string): Promise<void>;

  // Hooks
  installHooks(repoPath: string, hooks: GitHook[]): Promise<void>;
  getHook(repoPath: string, type: HookType): Promise<string | null>;
  removeHook(repoPath: string, type: HookType): Promise<void>;

  /** Write a plain-text file inside the repo working tree (auto-creates
   *  parent directories). Used to sync project state into the repo. */
  writeFile(repoPath: string, filePath: string, content: string): Promise<void>;

  /** Read a plain-text file from the repo working tree (UTF-8 decoded).
   *  Used to read run indexes and cloned project.clproj files. */
  readFile(repoPath: string, filePath: string): Promise<string>;

  /** List one directory of the repo working tree. Directories first, then
   *  files, each alphabetically. Missing dirs yield [] (never throw). */
  readDir(repoPath: string, dirPath: string): Promise<RepoEntry[]>;

  // Utilities
  getRootDir(repoPath: string): Promise<string | null>;
  getConfig(repoPath: string, key: string): Promise<string | null>;
  setConfig(repoPath: string, key: string, value: string): Promise<void>;
}

export interface GitError extends Error {
  code?: string;
  gitCommand?: string;
}

export function isGitError(err: unknown): err is GitError {
  return err instanceof Error && 'code' in err;
}

export const GIT_ERROR_CODES = {
  NOT_A_REPO: 'ENOTREPO',
  NOT_FOUND: 'ENOTFOUND',
  CONFLICT: 'ECONFLICT',
  AUTH_FAILED: 'EAUTH',
  NETWORK_ERROR: 'ENETWORK',
  LOCKED: 'ELOCKED',
  DIRTY: 'EDIRTY',
} as const;