// Parquet loader (parquet-wasm). parquet-wasm returns an Arrow-based `Table`;
// column values live on `RecordBatch` via the Arrow prototype `getChild`, which
// is not surfaced in the generated d.ts. We access it defensively and flatten
// the wide table into a single 2-D `RawVariable` (rows x columns) with column
// names preserved in `attrs.columns`.

// parquet-wasm is a WASM package: load it on demand (editor architecture §1.1)
// so it never enters the Standard-mode initial bundle.
import type { Table } from 'parquet-wasm';
import { asFloat64, type RawVariable } from './types';

interface ArrowBatch {
  numRows?: number;
  numColumns?: number;
  getChild?: (index: number) => { toArray?: () => ArrayLike<number> } | null;
}

export async function loadParquet(buffer: ArrayBuffer): Promise<RawVariable[]> {
  const { readParquet } = await import('parquet-wasm');
  const table = readParquet(new Uint8Array(buffer)) as unknown as Table;
  const schema = table.schema as unknown as { fields?: { name?: string }[] };
  const fields = schema.fields ?? [];
  const names: string[] = fields.map((f) => f?.name ?? 'col');

  const batches = table.recordBatches();
  const batch = batches[0] as unknown as ArrowBatch | undefined;
  if (!batch) return [];

  const nRows = batch.numRows ?? 0;
  const nCols = names.length;
  if (nRows === 0 || nCols === 0) return [];

  const columns: Float64Array[] = names.map((_, i) => {
    const vec = batch.getChild?.(i);
    const arr = vec?.toArray ? vec.toArray() : [];
    return asFloat64(Array.from(arr as ArrayLike<number>));
  });

  const flat = new Float64Array(nRows * nCols);
  for (let r = 0; r < nRows; r += 1) {
    for (let c = 0; c < nCols; c += 1) {
      flat[r * nCols + c] = columns[c]?.[r] ?? NaN;
    }
  }

  return [
    {
      name: 'parquet',
      data: flat,
      shape: [nRows, nCols],
      labels: [null, null],
      attrs: { columns: names },
    },
  ];
}
