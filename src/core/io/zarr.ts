// Zarr loader (zarrita). Zarr is a chunked, cloud-native format: a `.zarr`
// store is a *directory* of files, so a single dropped `File` cannot be read
// directly. `loadScientificData` therefore only reaches here via a URL (remote
// HTTP store, or a `blob:` URL the caller built from an unpacked directory).
//
// zarrita's `Array` has no `.get()` method — data is read with the free
// function `zarr.get(arr, selection)`. We read the whole array with a
// per-dimension `null` selection.
//
// Group enumeration (D1): a group root is enumerated via consolidated
// metadata (`.zmetadata` for Zarr v2, the experimental consolidated block in
// `zarr.json` for v3) wrapped with `withMaybeConsolidatedMetadata`. Over HTTP
// a store cannot list its children, so consolidated metadata is the *only*
// honest enumeration path; when it is absent we say so explicitly instead of
// silently yielding no data.

// zarrita is loaded on demand (editor architecture §1.1): Zarr stores are
// almost always remote HTTP/cloud URLs, so the parser should not sit in the
// Standard-mode initial bundle.
import { asFloat64, type RawVariable } from './types';

/** Minimal readable-store shape needed here (subset of zarrita's Readable). */
interface ReadableStore {
  get(key: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array | undefined>;
}

interface ListNode {
  path: string;
  kind: 'array' | 'group';
}

export async function loadZarr(url: string | URL): Promise<RawVariable[]> {
  const { FetchStore } = await import('zarrita');
  return loadZarrFromStore(new FetchStore(String(url)));
}

/** Store-agnostic core: `loadZarr` passes a FetchStore, tests pass a Map. */
export async function loadZarrFromStore(
  rawStore: ReadableStore | Map<string, Uint8Array>,
): Promise<RawVariable[]> {
  const zarr = await import('zarrita');
  const store = rawStore as never;
  // Wrap with consolidated metadata when present. withMaybeConsolidatedMetadata
  // returns the ORIGINAL store unchanged when none exists, so probing stays
  // free for the common "root is an array" case.
  const wrapped = (await zarr.withMaybeConsolidatedMetadata(store)) as
    | (ReadableStore & { contents(): ListNode[] })
    | ReadableStore;

  if ('contents' in wrapped && typeof wrapped.contents === 'function') {
    const arrays = wrapped
      .contents()
      .filter((node) => node.kind === 'array' && node.path && node.path !== '/');
    const root = zarr.root(wrapped as never);
    const vars: RawVariable[] = [];
    for (const node of arrays) {
      // Skip unreadable / non-numeric members rather than failing the whole
      // store: a group commonly mixes scalar attrs arrays with data arrays.
      try {
        const loc = root.resolve(node.path.replace(/^\//, ''));
        const arr = await zarr.open(loc, { kind: 'array' });
        vars.push(await readZarrArray(zarr, arr));
      } catch {
        // Member not readable as a numeric array (string dtype, codec
        // unsupported, ...) — leave it out of the variable list.
      }
    }
    return vars;
  }

  // No consolidated metadata: the common, fully-supported case is an array
  // root — try it first.
  try {
    const arr = await zarr.open(store, { kind: 'array' });
    return [await readZarrArray(zarr, arr)];
  } catch (arrayErr) {
    // Distinguish "root is a group" from "store is broken" for the error text.
    let isGroup = false;
    try {
      await zarr.open(store, { kind: 'group' });
      isGroup = true;
    } catch {
      /* not a group either — report the original array error below */
    }
    if (isGroup) {
      throw new Error(
        'Zarr group root cannot be enumerated: the store has no consolidated ' +
          'metadata (.zmetadata for v2 / consolidated zarr.json for v3), which is ' +
          'the only way to list children over HTTP. Open an array URL directly ' +
          '(e.g. .../data.zarr/array_name) or serve the store with consolidated ' +
          `metadata. Root open failed: ${(arrayErr as Error).message}`,
      );
    }
    throw arrayErr;
  }
}

/** Read a whole zarrita array into a float64 RawVariable. */
async function readZarrArray(
  zarr: typeof import('zarrita'),
  arr: import('zarrita').Array<import('zarrita').DataType, never>,
): Promise<RawVariable> {
  // No selection = full read. zarrita returns a Chunk wrapper ({ data, shape,
  // stride }) for N-d arrays and the bare scalar for 0-d arrays (shape=[]).
  const result = (await zarr.get(arr)) as unknown;
  const chunkData = (result as { data?: unknown }).data;
  const flat =
    arr.shape.length === 0
      ? [Number(result as number)]
      : Array.from(chunkData as ArrayLike<number>);
  return {
    name: arr.path.replace(/^\//, '') || 'array',
    data: asFloat64(flat),
    shape: arr.shape,
    labels: arr.dimensionNames ?? arr.shape.map((_, i) => `dim${i}`),
    attrs: (arr.attrs ?? {}) as Record<string, unknown>,
  };
}
