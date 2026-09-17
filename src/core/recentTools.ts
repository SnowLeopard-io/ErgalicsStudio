// ==========================================================================
// Ergalics Studio — recently used research tools (localStorage)
//
// Powers the "recent" group of the top-bar lab launcher. Cap is small:
// the launcher only ever shows the top 3–4, but we keep a few more so
// pruning never exposes gaps.
// ==========================================================================

const STORAGE_KEY = 'ergalics:recent-tools';
const MAX_RECENT = 8;

export function getRecentTools(limit = MAX_RECENT): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, limit);
  } catch {
    return [];
  }
}

/** Move a tool to the front of the recency list (most-recent-first). */
export function recordTool(id: string): void {
  try {
    const next = [id, ...getRecentTools().filter((x) => x !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode — launcher simply shows no recents */
  }
}
