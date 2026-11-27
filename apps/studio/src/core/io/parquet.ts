// Parquet loader (parquet-wasm + Apache Arrow).
//
// Why Arrow is involved: parquet-wasm 0.7.x's `Table.recordBatches()` returns
// thin wasm-bindgen wrappers that expose metadata only — `numRows` / `numColumns`
// / `schema` — and have **no column accessors** (`getChild` exists neither at
// runtime nor in the d.ts). Reading values therefore requires exporting the
// table as an Arrow IPC stream and decoding it with Apache Arrow, which also
// concatenates every record batch / row group for us, so multi-batch files are
// no longer silently truncated to the first batch.
//
// Both dependencies are heavy/WASM, so they load on demand (editor architecture
// §1.1) and never enter the Standard-mode initial bundle.

import { asFloat64, type RawVariable } from './types';

/** Coerce a single Arrow cell to a float64; null / non-numeric become NaN. */
function cellToNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  // Arrow Int64/Uint64 surface as BigInt; values beyond 2^53 lose precision
  // (as with any float64 round-trip) but the alternative is NaN for every
  // large integer.
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export async function loadParquet(buffer: ArrayBuffer): Promise<RawVariable[]> {
  const { readParquet } = await import('parquet-wasm');
  const { tableFromIPC } = await import('apache-arrow');

  let table;
  try {
    const wasmTable = readParquet(new Uint8Array(buffer));
    // `intoIPCStream` consumes the wasm table, releasing its memory as it goes,
    // so no explicit `free()` is needed on this path.
    table = tableFromIPC(wasmTable.intoIPCStream());
  } catch (err) {
    throw new Error(
      `parquet: failed to decode file — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const nRows = table.numRows;
  const nCols = table.numCols;
  if (nRows === 0 || nCols === 0) return [];

  const names = table.schema.fields.map((f) => f.name || 'col');

  // Read each column once, then interleave into the row-major layout.
  // `getChildAt` only returns null for an out-of-range index, which the loop
  // bounds already exclude; the null branch is kept as a defensive fallback.
  const columns: Float64Array[] = [];
  for (let c = 0; c < nCols; c += 1) {
    const vec = table.getChildAt(c);
    const col = new Float64Array(nRows);
    if (vec) {
      for (let r = 0; r < nRows; r += 1) col[r] = cellToNumber(vec.get(r));
    } else {
      col.fill(NaN);
    }
    columns.push(col);
  }

  const flat = new Float64Array(nRows * nCols);
  for (let r = 0; r < nRows; r += 1) {
    const rowBase = r * nCols;
    for (let c = 0; c < nCols; c += 1) {
      flat[rowBase + c] = columns[c]?.[r] ?? NaN;
    }
  }

  return [
    {
      name: 'parquet',
      data: asFloat64(flat),
      shape: [nRows, nCols],
      labels: [null, null],
      attrs: { columns: names },
    },
  ];
}
