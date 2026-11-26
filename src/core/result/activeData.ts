// ==========================================================================
// Active data source fingerprint (FR-1 input.dataHash)
//
// Data-loading paths report the bytes they are about to feed a computation
// here; `publishResult` folds the latest fingerprint into every record that
// does not carry an explicit one. Pure module state — no store imports, so
// projectStore can call it without creating an import cycle.
//
// Fingerprints are tracked per plugin as well as globally: a project may hold
// several datasets at once (two-col.csv in a scatter plot, a different CSV in
// a fit), and a plugin's record must describe *its own* input. The global
// entry is the fallback for load paths that are not plugin-bound (a bare
// project file import, a drag-and-drop that has not been routed yet).
// ==========================================================================

export interface ActiveDataSource {
  /** Original file name as ingested. */
  name: string;
  /** SHA-256 hex of the ingested bytes. */
  hash: string;
  /** Byte length, when known. */
  bytes?: number;
}

let current: ActiveDataSource | null = null;
const perPlugin = new Map<string, ActiveDataSource>();

/** Report the data a load path is about to feed computations. */
export function setCurrentDataSource(source: ActiveDataSource | null): void {
  current = source && source.hash ? source : null;
}

/**
 * Report the data bound to one specific plugin. Keeps a second dataset from
 * stealing the fingerprint of an already-running plugin.
 */
export function setPluginDataSource(
  pluginId: string,
  source: ActiveDataSource | null,
): void {
  if (!pluginId) {
    setCurrentDataSource(source);
    return;
  }
  if (source && source.hash) perPlugin.set(pluginId, source);
  else perPlugin.delete(pluginId);
  setCurrentDataSource(source);
}

/** Hash-only variant for callers that do not know the file name. */
export function setCurrentDataHash(hash: string): void {
  setCurrentDataSource(hash ? { name: current?.name ?? '', hash } : null);
}

/**
 * The fingerprint bound to one plugin.
 *
 * Falls back to the global source ONLY when no plugin has claimed an input
 * yet — otherwise a second plugin would inherit the first plugin's dataset
 * hash and misattribute its numbers. Provenance that names the wrong file is
 * worse than provenance that admits it does not know.
 */
export function getPluginDataSource(pluginId: string): ActiveDataSource | null {
  if (pluginId) {
    const scoped = perPlugin.get(pluginId);
    if (scoped) return scoped;
    if (perPlugin.size > 0) return null;
  }
  return current;
}
export function getCurrentDataSource(): ActiveDataSource | null {
  return current;
}

export function getCurrentDataHash(): string {
  return current?.hash ?? '';
}

/** Clear on project open/switch so a hash can never leak across projects. */
export function resetCurrentDataSource(): void {
  current = null;
  perPlugin.clear();
}
