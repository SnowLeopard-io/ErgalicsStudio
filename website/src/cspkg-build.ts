// Minimal dependency-free ZIP writer (STORE method) for building loadable
// .cspkg plugin archives in the browser. The workstation's cspkg loader
// (`src/core/cspkg.ts`) rejects a bare JSON manifest ("invalid zip archive"),
// so the marketplace must ship a real archive: manifest.json + dist/entry.
// Only STORE (no compression) archives are produced here — fine for the small
// official demos, and it keeps the website free of a zip dependency.

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/** Assemble a STORE-method ZIP archive from a map of path → file bytes. */
export function buildZipArchive(files: Record<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: { name: Uint8Array; lho: number; crc: number; size: number }[] = [];
  let offset = 0;

  for (const [path, data] of Object.entries(files)) {
    const name = enc.encode(path);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true);         // version needed to extract
    dv.setUint16(6, 0, true);          // flags
    dv.setUint16(8, 0, true);          // method = stored
    dv.setUint16(10, 0, true);         // mod time
    dv.setUint16(12, 0x21, true);      // mod date (1980-01-01)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); // compressed size
    dv.setUint32(22, data.length, true); // uncompressed size
    dv.setUint16(26, name.length, true); // file name length
    dv.setUint16(28, 0, true);           // extra field length
    chunks.push(local, name, data);
    central.push({ name, lho: offset, crc, size: data.length });
    offset += 30 + name.length + data.length;
  }

  const cdStart = offset;
  for (const e of central) {
    const cd = new Uint8Array(46);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory signature
    dv.setUint16(4, 20, true);         // version made by
    dv.setUint16(6, 20, true);         // version needed
    dv.setUint16(8, 0, true);          // flags
    dv.setUint16(10, 0, true);         // method = stored
    dv.setUint16(12, 0, true);         // mod time
    dv.setUint16(14, 0x21, true);      // mod date
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.size, true);    // compressed size
    dv.setUint32(24, e.size, true);    // uncompressed size
    dv.setUint16(28, e.name.length, true);
    dv.setUint16(30, 0, true); dv.setUint16(32, 0, true); // extra + comment
    dv.setUint16(34, 0, true);         // disk number start
    dv.setUint16(36, 0, true);         // internal attrs
    dv.setUint32(38, 0, true);         // external attrs
    dv.setUint32(42, e.lho, true);     // local header offset
    chunks.push(cd, e.name);
    offset += 46 + e.name.length;
  }

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true); // EOCD signature
  dv.setUint16(4, 0, true);          // disk number
  dv.setUint16(6, 0, true);          // disk with central dir
  dv.setUint16(8, central.length, true);  // entries on this disk
  dv.setUint16(10, central.length, true); // total entries
  dv.setUint32(12, offset - cdStart, true); // central dir size
  dv.setUint32(16, cdStart, true);         // central dir offset
  dv.setUint16(20, 0, true);               // comment length
  chunks.push(eocd);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Build a loadable .cspkg for a marketplace listing. The demo plugins have no
 * real bundle embedded on the website, so the archive ships a minimal plugin
 * that reports its own metadata (satisfying the workstation's manifest +
 * entry checks) — unsigned, so the workstation still runs its trust gate.
 */
export function buildCspkg(opts: {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: 'scientific' | 'fun' | 'utility';
}): Blob {
  const manifest = {
    id: opts.id,
    name: opts.name,
    version: opts.version,
    author: opts.author,
    description: opts.description,
    category: opts.category,
    icon: 'sparkles',
    sandbox: 'trusted',
    entry: 'dist/index.js',
  };
  // Build the entry as real JS source, NOT JSON.stringify: the workstation
  // `new Function('api', src)` runtime requires a callable object with
  // `manifest`, `init` and `getParams`. JSON.stringify would silently drop the
  // methods, so every downloaded plugin would crash on load ("plugin crashed").
  const entry = [
    '"use strict";',
    'return {',
    `  manifest: ${JSON.stringify(manifest)},`,
    '  getParams() { return []; },',
    '  init(api) {},',
    `  name: ${JSON.stringify(opts.name)},`,
    '};',
    '',
  ].join('\n');

  const zip = buildZipArchive({
    'manifest.json': enc.encode(JSON.stringify(manifest, null, 2)),
    'dist/index.js': enc.encode(entry),
  });
  return new Blob([zip], { type: 'application/zip' });
}