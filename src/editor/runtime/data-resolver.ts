// ==========================================================================
// Ergalics Studio — example data resolver (block/code mode)
//
// `studio.load(path)` resolves project files by name. The bundled example
// datasets (examples/data/*) are imported at build time via import.meta.glob
// so the canonical "load galaxy.dat → normalize → scatter" pipeline runs with
// zero setup. User-dropped files are not persisted into ProjectState.data.files
// yet (that's a separate integration); this resolver covers the bundled set.
// ==========================================================================

const dataFiles = import.meta.glob('../../../examples/data/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Resolve a project file path to its raw text, or undefined when unknown. */
export function resolveExampleFile(path: string): string | undefined {
  const base = basename(path);
  for (const [key, text] of Object.entries(dataFiles)) {
    if (basename(key) === base) return text;
  }
  return undefined;
}

/** All resolvable example file names (for error hints). */
export function listExampleFiles(): string[] {
  return Object.keys(dataFiles).map((k) => basename(k));
}
