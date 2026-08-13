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
      const kind = wasm.detect_file_kind(prefix);
      if (kind === 'Magic' || kind === 'Extension') {
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
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
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