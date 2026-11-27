// ==========================================================================
// Ergalics Studio — file editor flush registry
//
// Canvas file editors debounce their buffer pushes into appStore. Save and
// close flows must observe the LIVE editor content, not a buffer that is up
// to 300ms stale, so each editor registers a synchronous flush here on mount
// and store actions call it before reading the buffered payload.
//
// Deliberately dependency-free (no appStore import) so any store can use it
// without closing an import cycle.
// ==========================================================================

const registry = new Map<string, () => void>();

/** Register the flush for an editor tab key. Returns an unregister fn. */
export function registerEditorFlush(key: string, flush: () => void): () => void {
  registry.set(key, flush);
  return () => {
    if (registry.get(key) === flush) registry.delete(key);
  };
}

/** Invoke the registered flush (no-op when the editor is not mounted). */
export function flushEditorFile(key: string): void {
  const flush = registry.get(key);
  if (flush) flush();
}
