// ==========================================================================
// Ergalics Studio — scientific data dispatcher
//
// Single entry point: given a dropped/opened `File`, detect whether it is a
// scientific binary format and route it to the right loader, returning a list
// of `RawVariable`s (one per variable/dataset/HDU). The caller is responsible
// for turning those into `Dataset`s / project data files.
// ==========================================================================

import {
  detectScientificFormat,
  scientificFormatFromName,
  type ScientificFormat,
} from '@/core/fileFormat';
import { loadHdf5 } from './hdf5';
import { loadParquet } from './parquet';
import { loadFits } from './fits';
import { loadNetcdf } from './netcdf';
import { loadZarr } from './zarr';
import type { RawVariable } from './types';

export { toDataset, dataTableToCSV, sanitizeName, asFloat64 } from './types';
export type { RawVariable, NumericArray } from './types';

async function readHead(file: File, n = 512): Promise<Uint8Array | null> {
  try {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf).subarray(0, n);
  } catch {
    return null;
  }
}

/** Parse a scientific-format file into its constituent numeric variables. */
export async function loadScientificData(file: File): Promise<RawVariable[]> {
  const head = await readHead(file);
  const fmt: ScientificFormat | null =
    (head && detectScientificFormat(head)) ?? scientificFormatFromName(file.name);
  if (!fmt) throw new Error(`unsupported scientific format: ${file.name}`);

  const buf = await file.arrayBuffer();
  let variables: RawVariable[];
  switch (fmt) {
    case 'hdf5':
      variables = await loadHdf5(buf);
      break;
    case 'parquet':
      variables = await loadParquet(buf);
      break;
    case 'fits':
      variables = await loadFits(buf);
      break;
    case 'netcdf':
      variables = await loadNetcdf(buf);
      break;
    case 'zarr':
      // A dropped File can't represent a Zarr directory; build a blob URL so the
      // reader can fetch individual chunk files. Real remote stores pass a URL.
      variables = await loadZarr(URL.createObjectURL(file));
      break;
  }
  for (const v of variables) if (v.source === undefined) v.source = file.name;
  return variables;
}
