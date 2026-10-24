// ==========================================================================
// Platform detection + desktop bridge types.
// ==========================================================================
// The single detection point between the web edition and the Electron
// desktop edition. Business code never branches on platform directly; it
// goes through the adapters exported here.

export interface DesktopFsApi {
  pickDirectory(title: string): Promise<string | null>;
  pickFileSave(opts: {
    title?: string;
    defaultName?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  pickFileOpen(opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    multi?: boolean;
  }): Promise<string[] | null>;
  registerRoot(root: string): Promise<void>;
  readFile(path: string, encoding?: 'utf8' | 'binary'): Promise<string | Uint8Array>;
  writeFile(path: string, data: unknown): Promise<void>;
  stat(path: string): Promise<{ isFile: boolean; isDir: boolean; size: number; mtime: number }>;
  readDir(path: string): Promise<{ name: string; isDir: boolean; size: number }[]>;
  ensureDir(path: string): Promise<void>;
  delete(path: string, isDir: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  revealInShell(path: string): Promise<void>;
}

export interface DesktopGitApi {
  invoke<T = unknown>(method: string, args: unknown[]): Promise<T>;
}

export interface DesktopPythonApi {
  status(): Promise<{ available: boolean; pythonPath: string; portable: boolean; version?: string }>;
  sessionStart(): Promise<{ sessionId: string }>;
  run(msg: {
    sessionId: string;
    code: string;
    files?: Record<string, string>;
    params?: Record<string, unknown>;
    loadPackages?: string[];
  }): Promise<{ ok: boolean; variables: Record<string, unknown>; error?: string; durationMs: number }>;
  repl(sessionId: string, code: string): Promise<{ ok: boolean; text: string; error?: string }>;
  interrupt(sessionId: string): Promise<void>;
  sessionEnd(sessionId: string): Promise<void>;
  onEvent(cb: (payload: Record<string, unknown>) => void): () => void;
}

export interface DesktopPtyApi {
  start(opts: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<{
    id: string;
    shellName: string;
    mode: 'pty' | 'pipe';
  }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  onData(cb: (id: string, data: string) => void): () => void;
  onExit(cb: (id: string, code: string) => void): () => void;
}

export interface DesktopBridge {
  appInfo(): Promise<{ version: string; electron: string; platform: string }>;
  fs: DesktopFsApi;
  git: DesktopGitApi;
  python: DesktopPythonApi;
  pty: DesktopPtyApi;
}

function getBridge(): DesktopBridge | null {
  // Worker-sandbox safe: `window` is undefined inside plugin/parse workers.
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ergalicsDesktop?: DesktopBridge };
  return w.ergalicsDesktop ?? null;
}

/** True when the renderer is running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return getBridge() !== null;
}

/** The desktop bridge; throws when called from the web edition. */
export function desktopBridge(): DesktopBridge {
  const bridge = getBridge();
  if (!bridge) throw new Error('desktop bridge unavailable (web edition)');
  return bridge;
}

/** Cached desktop detection (the bridge cannot appear/disappear at runtime). */
export const IS_DESKTOP = isDesktop();
