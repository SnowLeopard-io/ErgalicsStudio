// Ambient module declaration for `simple-git`.
//
// The Node git adapter (src/core/git/node-adapter.ts) is only ever executed in
// an Electron/desktop context where `simple-git` is resolvable at runtime via
// `require`. It is deliberately NOT a package.json dependency so the browser
// bundle can never pull in Node-only modules; this shim keeps `tsc` satisfied
// for the type-only import there.
declare module 'simple-git' {
  export interface SimpleGitOptions {
    baseDir?: string;
    binary?: string;
    maxConcurrentProcesses?: number;
    [key: string]: unknown;
  }

  /** Loosely typed: the adapter only touches well-known simple-git methods. */
  export interface SimpleGit {
    [key: string]: any;
  }

  export interface DefaultLogFields {
    hash: string;
    date: string;
    message: string;
    author_name: string;
    author_email: string;
    [key: string]: unknown;
  }

  export interface LogResult {
    latest?: DefaultLogFields & { parents?: string | string[] };
    all: Array<DefaultLogFields & { parents?: string | string[] }>;
    total?: number;
  }

  export interface DiffResult {
    files: Array<{
      file: string;
      insertions?: number;
      deletions?: number;
      binary?: boolean;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }

  const simpleGit: (opts?: Partial<SimpleGitOptions>) => SimpleGit;
  export default simpleGit;
}
