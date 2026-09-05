// Zarr loader (zarrita). Zarr is a chunked, cloud-native format: a `.zarr`
// store is a *directory* of files, so a single dropped `File` cannot be read
// directly. `loadScientificData` therefore only reaches here via a URL (remote
// HTTP store, or a `blob:` URL the caller built from an unpacked directory).
//
// zarrita's `Array` has no `.get()` method — data is read with the free
// function `zarr.get(arr, selection)`. We read the whole array with a
// per-dimension `null` selection. Group *enumeration* is not exposed by the
// zarrita API, so a group root (rather than an array root) is reported as an
// explicit, actionable error rather than silently yielding no data.

// zarrita is loaded on demand (editor architecture §1.1): Zarr stores are
// almost always remote HTTP/cloud URLs, so the parser should not sit in the
// Standard-mode initial bundle.
import { asFloat64, type RawVariable } from './types';

export async function loadZarr(url: string | URL): Promise<RawVariable[]> {
  const { open, get, FetchStore } = await import('zarrita');
  const store = new FetchStore(String(url));
  // Open as an array first — the common, fully-supported case.
  try {
    const arr = await open(store, { kind: 'array' });
    const selection = arr.shape.map(() => null);
    const data = (await get(arr, selection)) as unknown as ArrayLike<number>;
    return [
      {
        name: String(arr.path),
        data: asFloat64(Array.from(data)),
        shape: arr.shape,
        labels: arr.dimensionNames ?? arr.shape.map((_, i) => `dim${i}`),
        attrs: (arr.attrs ?? {}) as Record<string, unknown>,
      },
    ];
  } catch (arrayErr) {
    // The root is a group (or not an array). zarrita provides no API to list a
    // group's children through the store, so we cannot enumerate variables here.
    throw new Error(
      'Zarr group roots are not yet enumerable from a single store; ' +
        'open an array URL directly (e.g. .../data.zarr/array_name). ' +
        `Root open failed: ${(arrayErr as Error).message}`,
    );
  }
}
