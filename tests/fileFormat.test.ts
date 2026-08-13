// File format detection tests (spec §5.2, §5.3)
import { describe, it, expect } from 'vitest';
import {
  detectByExtension,
  detectFormats,
  detectFormatByMagic,
  matchesFormats,
  collectSupportedExtensions,
} from '@/core/fileFormat';
import type { SupportedFormat } from '@/types/plugin';

function fileOf(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' });
}

describe('detectByExtension', () => {
  it('maps known extensions (case-insensitive)', () => {
    expect(detectByExtension('data.xyz')?.format).toBe('xyz');
    expect(detectByExtension('notes.TXT')?.format).toBe('text');
    expect(detectByExtension('scene.glb')?.format).toBe('glb');
  });

  it('returns null for unknown extensions', () => {
    expect(detectByExtension('archive.7z')).toBeNull();
    expect(detectByExtension('noext')).toBeNull();
  });

  it('marks results as extension-based', () => {
    expect(detectByExtension('a.csv')).toMatchObject({ format: 'csv', byMagic: false });
  });
});

describe('detectFormatByMagic', () => {
  it('detects PNG by its magic header', async () => {
    const result = await detectFormatByMagic(fileOf('image.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    expect(result.some((r) => r.format === 'png' && r.byMagic)).toBe(true);
  });

  it('detects ZIP by PK header', async () => {
    const result = await detectFormatByMagic(fileOf('bundle.zip', [0x50, 0x4b, 0x03, 0x04, 9, 9]));
    expect(result.some((r) => r.format === 'zip')).toBe(true);
  });

  it('returns empty for unknown magic', async () => {
    const result = await detectFormatByMagic(fileOf('random.bin', [1, 2, 3, 4, 5, 6, 7, 8]));
    expect(result).toHaveLength(0);
  });
});

describe('detectFormats', () => {
  it('combines magic + extension without duplicates', async () => {
    const result = await detectFormats(fileOf('img.png', [0x89, 0x50, 0x4e, 0x47]));
    const formats = result.map((r) => r.format);
    expect(formats).toContain('png');
    expect(formats.filter((f) => f === 'png')).toHaveLength(1);
  });
});

describe('matchesFormats / collectSupportedExtensions', () => {
  const pluginFormats: SupportedFormat[] = [
    { extension: '.xyz', mimeTypes: ['chemical/x-xyz'] },
    { extension: '.dat', mimeTypes: ['application/octet-stream'] },
  ];

  it('matches by extension', () => {
    expect(matchesFormats([{ format: 'xyz', extension: '.xyz', byMagic: false }], pluginFormats)).toBe(true);
    expect(matchesFormats([{ format: 'csv', extension: '.csv', byMagic: false }], pluginFormats)).toBe(false);
  });

  it('matches by format name without dot', () => {
    expect(matchesFormats([{ format: 'dat', extension: '.dat', byMagic: true }], pluginFormats)).toBe(true);
  });

  it('collects unique extensions', () => {
    expect(
      collectSupportedExtensions([
        { pluginId: 'a', formats: pluginFormats },
        { pluginId: 'b', formats: [{ extension: '.xyz', mimeTypes: [] }] },
      ]),
    ).toEqual(['.xyz', '.dat']);
  });
});
