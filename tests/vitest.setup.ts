// Polyfill IndexedDB for the Node test environment.
//
// Several modules (lightning-fs / idb-keyval, used by the VFS and the git
// adapter) lazily construct an IndexedDB-backed filesystem on first use. The
// Vitest `node` environment does not provide `indexedDB` (jsdom doesn't
// implement it either), so without this shim those modules reject with
// `ReferenceError: indexedDB is not defined` as an unhandled rejection and
// fail the Vitest run even when every assertion passes. `fake-indexeddb/auto`
// installs an in-memory `indexedDB` (and `IDBKeyRange`) onto the global scope.
import 'fake-indexeddb/auto';
