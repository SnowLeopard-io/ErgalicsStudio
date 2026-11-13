// ==========================================================================
// Ergalics Studio — Python package registry (vendored set + pinned list)
//
// Pure state: which Pyodide packages the app vendors (scripts/copy-pyodide.mjs
// downloads their wheels into public/pyodide, so installing them needs no
// network) and which ones the user pinned for auto-install at interpreter
// boot (persisted in localStorage — the interpreter itself is session-scoped,
// so without this a terminal `pip install` evaporated on every refresh).
//
// Keep this module free of runtime imports (code-runtime, stores): the boot
// path imports it, and the unit tests run it in plain jsdom.
// ==========================================================================

/** Packages vendored into the same-origin /pyodide bundle (offline-installable). */
export const VENDORED_PYTHON_PACKAGES = [
  'numpy',
  'scipy',
  'pandas',
  'matplotlib',
  'sympy',
] as const;

export type VendoredPythonPackage = (typeof VENDORED_PYTHON_PACKAGES)[number];

const PINNED_KEY = 'ergalics:python:pinned-packages';

function readPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set<string>(VENDORED_PYTHON_PACKAGES);
    return [...new Set(parsed.filter((v): v is string => typeof v === 'string' && valid.has(v)))];
  } catch {
    return [];
  }
}

function writePinned(names: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable — pinning silently degrades to session-only */
  }
}

/**
 * Packages the user pinned for auto-install at every interpreter boot
 * (invalid / unknown names are silently dropped — the vendored set is the
 * installable universe).
 */
export function getPinnedPythonPackages(): string[] {
  return readPinned();
}

/** Pin packages for boot-time auto-install; returns the updated list. */
export function addPinnedPythonPackages(names: readonly string[]): string[] {
  const valid = new Set<string>(VENDORED_PYTHON_PACKAGES);
  const next = [...new Set([...readPinned(), ...names.filter((n) => valid.has(n))])];
  writePinned(next);
  return next;
}

/** Unpin a package (takes effect at the next interpreter restart). */
export function removePinnedPythonPackage(name: string): string[] {
  const next = readPinned().filter((n) => n !== name);
  writePinned(next);
  return next;
}

/** Which vendored packages are NOT yet pinned (install-picker options). */
export function unpinnedVendoredPackages(): string[] {
  const pinned = new Set(readPinned());
  return VENDORED_PYTHON_PACKAGES.filter((p) => !pinned.has(p));
}
