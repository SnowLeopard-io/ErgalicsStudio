// ==========================================================================
// File format detection (spec §5.2, §5.3)
// ==========================================================================

import { getWasm } from './wasm';
import type { SupportedFormat } from '@/types/plugin';

export interface DetectedFormat {
  format: string;
  extension: string;
  byMagic: boolean;
}

const KNOWN_MAGIC: { bytes: number[]; format: string }[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], format: 'zip' },
  { bytes: [0x25, 0x50, 0x44, 0x46], format: 'pdf' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], format: 'png' },
  { bytes: [0xff, 0xd8, 0xff], format: 'jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], format: 'gif' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], format: 'elf' },
];

const EXTENSION_FORMATS: Record<string, string> = {
  '.clproj': 'clproj',
  '.cspkg': 'cspkg',
  '.json': 'json',
  '.xyz': 'xyz',
  '.pdb': 'pdb',
  '.csv': 'csv',
  '.txt': 'text',
  '.glb': 'glb',
  '.gltf': 'gltf',
  '.stl': 'stl',
  '.obj': 'obj',
  '.dat': 'dat',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
};

/** Detect a file's format by magic number (and WASM where available). */
export async function detectFormatByMagic(file: File): Promise<DetectedFormat[]> {
  const results: DetectedFormat[] = [];
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  for (const magic of KNOWN_MAGIC) {
    const match = magic.bytes.every((b, i) => prefix[i] === b);
    if (match) {
      results.push({ format: magic.format, extension: `.${magic.format}`, byMagic: true });
    }
  }

  const wasm = getWasm();
  if (wasm) {
    try {
      // Numeric FileKind enum from the native core: Magic = 0, Extension = 1,
      // Unknown = 2 (see `@/native/ergalics_core`). Comparing against string
      // literals would be always-false and silently disable this branch.
      const kind = wasm.detect_file_kind(prefix);
      if (kind === 0 || kind === 1) {
        if (prefix[0] === 0x50) {
          // PK header → zip-family format
          if (!results.some((r) => r.format === 'zip')) {
            results.push({ format: 'zip', extension: '.zip', byMagic: true });
          }
        } else if (prefix[0] === 0x7b) {
          // '{' → JSON
          if (!results.some((r) => r.format === 'json')) {
            results.push({ format: 'json', extension: '.json', byMagic: true });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return results;
}

export function detectByExtension(name: string): DetectedFormat | null {
  const dot = name.lastIndexOf('.');
  // A name without a dot must not be treated as its last character.
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  const format = EXTENSION_FORMATS[ext];
  if (!format) return null;
  return { format, extension: ext, byMagic: false };
}

export async function detectFormats(file: File): Promise<DetectedFormat[]> {
  const magic = await detectFormatByMagic(file);
  const ext = detectByExtension(file.name);
  const combined = [...magic];
  if (ext && !combined.some((c) => c.format === ext.format)) {
    combined.push(ext);
  }
  return combined;
}

/** Does a plugin support this detected format? */
export function matchesFormats(
  detected: DetectedFormat[],
  pluginFormats: SupportedFormat[],
): boolean {
  return detected.some((d) =>
    pluginFormats.some(
      (f) =>
        f.extension.toLowerCase() === d.extension.toLowerCase() ||
        f.extension.toLowerCase().replace('.', '') === d.format.toLowerCase(),
    ),
  );
}

/** Collect all supported extensions across plugins for error messages. */
export function collectSupportedExtensions(
  formats: { pluginId: string; formats: SupportedFormat[] }[],
): string[] {
  const set = new Set<string>();
  for (const { formats: list } of formats) {
    for (const f of list) set.add(f.extension);
  }
  return [...set];
}

// ---- Scientific binary formats (research data) -------------------------
//
// These cannot travel the text path used by CSV/XYZ, so they are detected by
// magic number up front. The actual decoders live in `@/core/io` and are wired
// once their WASM dependencies (h5wasm, parquet-wasm, fitsjs, netcdfjs,
// zarrita) are installed — detection here has no such dependency.

export type ScientificFormat = 'hdf5' | 'parquet' | 'fits' | 'netcdf' | 'zarr';

const SCIENTIFIC_MAGIC: { bytes: number[]; format: ScientificFormat }[] = [
  // HDF5 family: HDF5, h5ad (single-cell), MAT v7.3 — all HDF5 containers.
  { bytes: [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], format: 'hdf5' },
  // Parquet: "PAR1" appears at both ends of the file.
  { bytes: [0x50, 0x41, 0x52, 0x31], format: 'parquet' },
  // FITS: the primary HDU header begins with the ASCII "SIMPLE  = ".
  { bytes: [0x53, 0x49, 0x4d, 0x50, 0x4c, 0x45], format: 'fits' },
  // NetCDF classic: "CDF\x01" / "CDF\x02". (NetCDF-4 is HDF5-based → 'hdf5'.)
  { bytes: [0x43, 0x44, 0x46, 0x01], format: 'netcdf' },
  { bytes: [0x43, 0x44, 0x46, 0x02], format: 'netcdf' },
];

const SCIENTIFIC_EXTENSIONS: Record<string, ScientificFormat> = {
  '.h5': 'hdf5',
  '.hdf5': 'hdf5',
  '.hdf': 'hdf5',
  '.mat': 'hdf5', // MAT v7.3 (HDF5-based); legacy MAT v7 is unsupported.
  '.parquet': 'parquet',
  '.fits': 'fits',
  '.fit': 'fits',
  '.nc': 'netcdf',
  '.zarr': 'zarr',
};

/** Detect a scientific binary format from a file's leading bytes. */
export function detectScientificFormat(bytes: Uint8Array): ScientificFormat | null {
  for (const magic of SCIENTIFIC_MAGIC) {
    if (magic.bytes.every((b, i) => bytes[i] === b)) return magic.format;
  }
  return null;
}

/** Resolve a scientific format from a file name (extension fallback). */
export function scientificFormatFromName(name: string): ScientificFormat | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return SCIENTIFIC_EXTENSIONS[name.slice(dot).toLowerCase()] ?? null;
}