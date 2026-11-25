// ==========================================================================
// Active data source fingerprint (FR-1 input.dataHash)
//
// Data-loading paths report the bytes they are about to feed a computation
// here; `publishResult` folds the latest fingerprint into every record that
// does not carry an explicit one. Pure module state — no store imports, so
// projectStore can call it without creating an import cycle.
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

/** Report the data a load path is about to feed computations. */
export function setCurrentDataSource(source: ActiveDataSource | null): void {
  current = source && source.hash ? source : null;
}

/** Hash-only variant for callers that do not know the file name. */
export function setCurrentDataHash(hash: string): void {
  setCurrentDataSource(hash ? { name: current?.name ?? '', hash } : null);
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
}
