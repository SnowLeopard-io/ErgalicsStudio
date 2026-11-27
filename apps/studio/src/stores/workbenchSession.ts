// ==========================================================================
// Ergalics Studio — per-project workbench session
//
// The workbench remembers what the user was doing in each project: which
// files / suites are open in the canvas tab strip, which tab was in front,
// which folders were expanded in the explorer, and the last run's console
// output. Everything is keyed by PROJECT id, so switching projects never
// leaks one project's tabs into another (and reopening a project restores
// exactly its own layout).
//
// Only the durable description is stored — tab keys / paths, not file
// contents. Tabs are re-opened from the workspace tree on restore, so a file
// edited on disk (or by another tool) shows its current content.
// ==========================================================================

import type { CanvasTab, FileEditorKind } from './appStore';
import type { ConsoleEntry } from '@/types/editor';
import type { WorkbenchMode } from '@/types/editor';

/** One tab, as persisted (the live store types carry no extra payload). */
export type PersistedTab =
  | { kind: 'file'; key: string; path: string }
  | { kind: 'editor'; key: string; path: string; editor: FileEditorKind }
  | { kind: 'surface'; key: string; mode: WorkbenchMode; path?: string }
  | { kind: 'tool'; key: string; id: string }
  | { kind: 'settings'; key: string };

export interface WorkbenchSession {
  tabs: PersistedTab[];
  activeTab: string | null;
  mode: WorkbenchMode;
  /** Expanded folders in the file explorer ('' is the root, never stored). */
  expandedDirs: string[];
  /** Last run's console output (the "run results" the terminal mirrors). */
  console: ConsoleEntry[];
  error: string | null;
  savedAt: number;
}

const STORAGE_PREFIX = 'ergalics:workbench-session:';
/** Console entries are capped so a chatty run cannot bloat localStorage. */
export const MAX_PERSISTED_CONSOLE = 200;

const MODES: readonly WorkbenchMode[] = ['standard', 'flow', 'block', 'code'];
const EDITOR_KINDS: readonly FileEditorKind[] = ['code', 'block', 'flow'];
const STREAMS: readonly ConsoleEntry['stream'][] = ['stdout', 'stderr', 'info'];

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Persisted tabs are external input (localStorage can be stale/hand-edited). */
function sanitizeTab(raw: unknown): PersistedTab | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.key !== 'string' || raw.key === '') return null;
  switch (raw.kind) {
    case 'file':
      return typeof raw.path === 'string' && raw.path !== ''
        ? { kind: 'file', key: raw.key, path: raw.path }
        : null;
    case 'editor':
      return typeof raw.path === 'string' &&
        raw.path !== '' &&
        EDITOR_KINDS.includes(raw.editor as FileEditorKind)
        ? { kind: 'editor', key: raw.key, path: raw.path, editor: raw.editor as FileEditorKind }
        : null;
    case 'surface':
      if (!MODES.includes(raw.mode as WorkbenchMode)) return null;
      return typeof raw.path === 'string' && raw.path !== ''
        ? { kind: 'surface', key: raw.key, mode: raw.mode as WorkbenchMode, path: raw.path }
        : { kind: 'surface', key: raw.key, mode: raw.mode as WorkbenchMode };
    case 'tool':
      return typeof raw.id === 'string' && raw.id !== ''
        ? { kind: 'tool', key: raw.key, id: raw.id }
        : null;
    case 'settings':
      return { kind: 'settings', key: raw.key };
    default:
      return null;
  }
}

function sanitizeConsole(raw: unknown): ConsoleEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ConsoleEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (!STREAMS.includes(item.stream as ConsoleEntry['stream'])) continue;
    if (typeof item.text !== 'string') continue;
    entries.push({
      stream: item.stream as ConsoleEntry['stream'],
      text: item.text,
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : 0,
    });
  }
  return entries.slice(-MAX_PERSISTED_CONSOLE);
}

/** Coerce whatever was stored into a valid session (null when unusable). */
export function sanitizeWorkbenchSession(raw: unknown): WorkbenchSession | null {
  if (!isRecord(raw)) return null;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs
        .map(sanitizeTab)
        .filter((t): t is PersistedTab => t !== null)
    : [];
  const keys = new Set(tabs.map((t) => t.key));
  const activeTab =
    typeof raw.activeTab === 'string' && keys.has(raw.activeTab) ? raw.activeTab : null;
  const expandedDirs = Array.isArray(raw.expandedDirs)
    ? [...new Set(raw.expandedDirs.filter((d): d is string => typeof d === 'string' && d !== ''))]
    : [];
  return {
    tabs,
    activeTab,
    mode: MODES.includes(raw.mode as WorkbenchMode)
      ? (raw.mode as WorkbenchMode)
      : 'standard',
    expandedDirs,
    console: sanitizeConsole(raw.console),
    error: typeof raw.error === 'string' ? raw.error : null,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

/** Read the stored session for a project. Null when nothing (valid) exists. */
export function loadWorkbenchSession(projectId: string): WorkbenchSession | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    return sanitizeWorkbenchSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Write the session for a project (best-effort — storage may be unavailable). */
export function saveWorkbenchSession(projectId: string, session: WorkbenchSession): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(session));
  } catch {
    /* private mode / quota — the layout simply does not persist */
  }
}

/** Forget a project's session (project deleted). */
export function clearWorkbenchSession(projectId: string): void {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    /* nothing to clean up */
  }
}

/** Strip the live store shape down to the persisted tab description. */
export function persistableTab(tab: CanvasTab): PersistedTab {
  switch (tab.kind) {
    case 'file':
      return { kind: 'file', key: tab.key, path: tab.path };
    case 'editor':
      return { kind: 'editor', key: tab.key, path: tab.path, editor: tab.editor };
    case 'surface':
      return tab.path
        ? { kind: 'surface', key: tab.key, mode: tab.mode, path: tab.path }
        : { kind: 'surface', key: tab.key, mode: tab.mode };
    case 'tool':
      return { kind: 'tool', key: tab.key, id: tab.id };
    case 'settings':
      return { kind: 'settings', key: tab.key };
  }
}
