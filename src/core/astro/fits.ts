// ==========================================================================
// FITS (Flexible Image Transport System) reader/writer — pure TypeScript.
//
// Standard-conformant subset sufficient for research image pipelines:
//  - 2880-byte header/data blocks, 80-char ASCII cards
//  - BITPIX 8 / 16 / 32 / -32 / -64, BSCALE / BZERO physical conversion
//  - NAXIS=2 images (the science case); NAXIS=0 header-only accepted
//  - Simple TAN WCS (CRVAL/CRPIX/CDELT) pixel ↔ sky mapping
// Writing emits BITPIX=-64 (float64, big-endian) images for lossless
// calibrated frames, matching what professional pipelines (DS9, astropy)
// read back.
// ==========================================================================

export interface FitsHeaderCard {
  keyword: string;
  value?: string | number | boolean;
  comment?: string;
}

export interface TandWcs {
  crval1: number; // RA at reference pixel (deg)
  crval2: number; // Dec at reference pixel (deg)
  crpix1: number; // reference pixel x (1-based, FITS convention)
  crpix2: number;
  cdelt1: number; // deg/pixel (negative for standard RA images)
  cdelt2: number;
}

export interface FitsImage {
  width: number;
  height: number;
  /** Pixel values after BSCALE/BZERO application (physical units). */
  pixels: Float64Array;
  bitpix: number;
  bscale: number;
  bzero: number;
  header: FitsHeaderCard[];
  wcs: TandWcs | null;
}

const BLOCK = 2880;
const CARD = 80;

// ---- header card parsing -----------------------------------------------------

function parseCardValue(raw: string): string | number | boolean | undefined {
  const v = raw.trim();
  if (v === '' || v === '&') return undefined;
  if (v === 'T') return true;
  if (v === 'F') return false;
  if (v.startsWith("'")) {
    // String value: ends at a single quote not doubled; strip doubled quotes.
    let out = '';
    for (let i = 1; i < v.length; i++) {
      if (v[i] === "'") {
        if (v[i + 1] === "'") {
          out += "'";
          i++;
        } else break;
      } else out += v[i];
    }
    return out;
  }
  const n = Number(v.replace(/[ ED](?=[+-]?\d)/gi, (m) => (m === 'D' ? 'E' : m)));
  return Number.isFinite(n) ? n : v;
}

function parseHeaderBlockText(text: string): { cards: FitsHeaderCard[]; ended: boolean } {
  const cards: FitsHeaderCard[] = [];
  let ended = false;
  for (let off = 0; off < text.length; off += CARD) {
    const card = text.slice(off, off + CARD);
    if (card.length < CARD) break;
    const keyword = card.slice(0, 8).trim();
    let value: string | number | boolean | undefined;
    let comment: string | undefined;
    if (keyword === 'COMMENT' || keyword === 'HISTORY' || keyword === '' || card[8] !== '=') {
      // Non-value card; keep the raw remainder as the comment text.
      const rest = card.slice(8).trim();
      value = rest === '' ? undefined : undefined;
      comment = rest === '' ? undefined : rest.replace(/^=\s*/, '');
      if (rest.startsWith('=')) value = parseCardValue(rest.slice(1).split('/')[0] ?? '');
    } else {
      const rest = card.slice(9); // after "= "
      const slash = findCommentSlash(rest);
      const valuePart = slash >= 0 ? rest.slice(0, slash) : rest;
      value = parseCardValue(valuePart);
      if (slash >= 0) comment = rest.slice(slash + 1).trim();
    }
    cards.push({ keyword, value, comment });
    if (keyword === 'END') {
      ended = true;
      break;
    }
  }
  return { cards, ended };
}

/** Finds the '/' comment separator outside quoted strings. */
function findCommentSlash(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      if (inQuote && s[i + 1] === "'") i++;
      else inQuote = !inQuote;
    } else if (c === '/' && !inQuote) return i;
  }
  return -1;
}

// ---- data reading --------------------------------------------------------------

function readPixels(
  view: DataView,
  byteOffset: number,
  count: number,
  bitpix: number,
): Float64Array {
  const out = new Float64Array(count);
  const size = Math.abs(bitpix) / 8;
  for (let i = 0; i < count; i++) {
    const o = byteOffset + i * size;
    switch (bitpix) {
      case 8:
        out[i] = view.getUint8(o);
        break;
      case 16:
        out[i] = view.getInt16(o, false);
        break;
      case 32:
        out[i] = view.getInt32(o, false);
        break;
      case -32:
        out[i] = view.getFloat32(o, false);
        break;
      case -64:
        out[i] = view.getFloat64(o, false);
        break;
      default:
        throw new Error(`Unsupported BITPIX ${bitpix}`);
    }
  }
  return out;
}

/**
 * Parses a FITS file (primary HDU image). Throws on malformed headers or
 * unsupported layouts (extensions, NAXIS ≠ 0/2).
 */
export function parseFits(buffer: ArrayBuffer): FitsImage {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let cards: FitsHeaderCard[] = [];
  let headerEnd = 0;
  {
    // Read header blocks until END.
    let off = 0;
    for (;;) {
      if (off + BLOCK > bytes.length) throw new Error('Truncated FITS header');
      const text = ascii(bytes.subarray(off, off + BLOCK));
      const { cards: blockCards, ended } = parseHeaderBlockText(text);
      cards = cards.concat(blockCards);
      off += BLOCK;
      if (ended) {
        headerEnd = off;
        break;
      }
    }
  }
  const get = (k: string): string | number | boolean | undefined =>
    cards.find((c) => c.keyword === k)?.value;

  if (get('SIMPLE') !== true) throw new Error('Not a conformant FITS file (SIMPLE ≠ T)');
  const bitpix = Number(get('BITPIX'));
  const naxis = Number(get('NAXIS') ?? 0);
  if (naxis === 0) {
    return { width: 0, height: 0, pixels: new Float64Array(0), bitpix, bscale: 1, bzero: 0, header: cards, wcs: null };
  }
  if (naxis !== 2) throw new Error(`Unsupported NAXIS=${naxis} (only 2-D images)`);
  const width = Number(get('NAXIS1'));
  const height = Number(get('NAXIS2'));
  const bscale = Number(get('BSCALE') ?? 1) || 1;
  const bzero = Number(get('BZERO') ?? 0) || 0;
  const count = width * height;
  const dataBlocks = Math.ceil((count * Math.abs(bitpix)) / 8 / BLOCK);
  const dataEnd = headerEnd + dataBlocks * BLOCK;
  if (dataEnd > bytes.length) throw new Error('Truncated FITS data');
  const raw = readPixels(view, headerEnd, count, bitpix);
  const pixels = new Float64Array(count);
  for (let i = 0; i < count; i++) pixels[i] = (raw[i] ?? 0) * bscale + bzero;

  const ctype1 = String(get('CTYPE1') ?? '');
  let wcs: TandWcs | null = null;
  if (ctype1.includes('TAN')) {
    wcs = {
      crval1: Number(get('CRVAL1') ?? 0),
      crval2: Number(get('CRVAL2') ?? 0),
      crpix1: Number(get('CRPIX1') ?? (width + 1) / 2),
      crpix2: Number(get('CRPIX2') ?? (height + 1) / 2),
      cdelt1: Number(get('CDELT1') ?? 1),
      cdelt2: Number(get('CDELT2') ?? 1),
    };
  }
  return { width, height, pixels, bitpix, bscale, bzero, header: cards, wcs };
}

/** TAN-projection pixel (0-based x, y) → sky (RA, Dec in degrees). */
export function pixelToSky(
  wcs: TandWcs,
  x: number,
  y: number,
): { raDeg: number; decDeg: number } {
  // FITS pixels are 1-based: interpolate to fractional then +1.
  const dx = ((x + 1) - wcs.crpix1) * Math.PI / 180;
  const dy = ((y + 1) - wcs.crpix2) * Math.PI / 180;
  const ra0 = wcs.crval1 * Math.PI / 180;
  const dec0 = wcs.crval2 * Math.PI / 180;
  // Standard TAN (gnomonic) deprojection.
  const xi = dx, eta = dy;
  const denom = dec0 === Math.PI / 2 ? eta : Math.cos(dec0) - eta * Math.sin(dec0);
  const ra = ra0 + Math.atan2(xi, denom);
  const dec = Math.atan2(
    Math.sin(dec0) + eta * Math.cos(dec0),
    Math.hypot(denom, xi),
  );
  const wrapDeg = (r: number) => (((r * 180) / Math.PI) % 360 + 360) % 360;
  return { raDeg: wrapDeg(ra), decDeg: (dec * 180) / Math.PI };
}

/** TAN-projection sky → pixel (0-based x, y). */
export function skyToPixel(
  wcs: TandWcs,
  raDeg: number,
  decDeg: number,
): { x: number; y: number } {
  const ra0 = wcs.crval1 * Math.PI / 180;
  const dec0 = wcs.crval2 * Math.PI / 180;
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cosC = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosC;
  const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosC;
  const x = xi * 180 / Math.PI / wcs.cdelt1 + wcs.crpix1 - 1;
  const y = eta * 180 / Math.PI / wcs.cdelt2 + wcs.crpix2 - 1;
  return { x, y };
}

// ---- writing ---------------------------------------------------------------------

/** Formats a FITS card; strings get the `'...'` quoting and 8-char keyword pad. */
function formatCard(keyword: string, value?: string | number | boolean, comment?: string): string {
  let body: string;
  if (value === undefined) {
    body = keyword === 'COMMENT' || keyword === 'HISTORY' ? (comment ?? '') : (comment ?? '');
  } else if (typeof value === 'boolean') {
    body = `= ${value ? 'T' : 'F'}`;
  } else if (typeof value === 'string') {
    const escaped = value.replace(/'/g, "''");
    body = `= '${escaped}'`;
  } else {
    body = `= ${String(value)}`;
  }
  if (comment && value !== undefined) {
    const pad = Math.max(1, CARD - 8 - body.length - comment.length - 3);
    body += ' '.repeat(Math.min(pad, 30)) + '/ ' + comment;
  }
  const card = (keyword.padEnd(8, ' ') + body).slice(0, CARD).padEnd(CARD, ' ');
  return card;
}

/**
 * Writes a 2-D float64 (BITPIX=-64) FITS image with a standard header.
 * `extraCards` are appended before END (e.g. OBJECT, EXPTIME, WCS).
 */
export function writeFits(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  extraCards: Array<[string, string | number | boolean, string?]> = [],
): Uint8Array {
  const cards: string[] = [formatCard('SIMPLE', true, 'conforms to FITS standard')];
  cards.push(formatCard('BITPIX', -64));
  cards.push(formatCard('NAXIS', 2));
  cards.push(formatCard('NAXIS1', width));
  cards.push(formatCard('NAXIS2', height));
  cards.push(formatCard('BSCALE', 1));
  cards.push(formatCard('BZERO', 0));
  for (const [k, v, c] of extraCards) cards.push(formatCard(k, v, c));
  cards.push(formatCard('END'));
  let header = cards.join('');
  const headerBlocks = Math.ceil(header.length / BLOCK);
  header = header.padEnd(headerBlocks * BLOCK, ' ');

  const dataBytes = width * height * 8;
  const dataBlocks = Math.ceil(dataBytes / BLOCK);
  const out = new Uint8Array(headerBlocks * BLOCK + dataBlocks * BLOCK);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  const view = new DataView(out.buffer);
  let off = headerBlocks * BLOCK;
  for (let i = 0; i < width * height; i++) {
    view.setFloat64(off, Number(pixels[i]), false);
    off += 8;
  }
  return out;
}

function ascii(bytes: Uint8Array): string {
  let s = '';
  const chunk = 4096;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return s;
}
