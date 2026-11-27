// ==========================================================================
// Ergalics Studio — Unicode font embedding for PDF exports
//
// jsPDF's built-in Times/Courier/Helvetica fonts only cover WinAnsi. Any text
// outside Latin-1 (Chinese, Greek, CJK punctuation) is truncated or mapped to
// an unrelated Symbol glyph, which is why Chinese titles and π rendered as
// mojibake/¼. This module loads one Apache-2.0 TrueType font (jsPDF cannot
// embed CFF/OTF or WOFF) and registers it on demand.
// ==========================================================================

export const CJK_FONT_FILE = 'DroidSansFallback.ttf';
export const CJK_FONT_FAMILY = 'DroidSansFallback';
/** True when text contains a character the built-in WinAnsi fonts cannot encode. */
export const NON_LATIN1 = /[\u0100-\uffff]/;

export interface PdfFontDoc {
  addFileToVFS(filename: string, data: string): void;
  addFont(filename: string, family: string, style?: string): void;
}

const CJK_FONT_URL = `${import.meta.env.BASE_URL}fonts/${CJK_FONT_FILE}`;

let fontBytesPromise: Promise<ArrayBuffer | null> | null = null;
let fontBase64Promise: Promise<string | null> | null = null;
let fontFacePromise: Promise<boolean> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Keep each spread below the engine's argument limit for large fonts.
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetch + cache the font bytes. Returns `null` when the asset is unavailable
 * so Latin-only exports still work and CJK text degrades to placeholders
 * instead of silently producing mojibake.
 */
export function loadFontBytes(): Promise<ArrayBuffer | null> {
  if (!fontBytesPromise) {
    fontBytesPromise = (async () => {
      try {
        const response = await fetch(CJK_FONT_URL);
        if (!response.ok) return null;
        return await response.arrayBuffer();
      } catch {
        return null;
      }
    })();
  }
  return fontBytesPromise;
}

function loadFontBase64(): Promise<string | null> {
  if (!fontBase64Promise) {
    fontBase64Promise = loadFontBytes().then((bytes) => (bytes ? toBase64(bytes) : null));
  }
  return fontBase64Promise;
}

/**
 * Register the font on a jsPDF document. Only the requested styles are added:
 * each style embeds another copy of the (subsetted) font, so callers pass the
 * styles their text actually uses.
 */
export async function registerFont(
  doc: PdfFontDoc,
  needed: boolean,
  styles: readonly string[] = ['normal'],
): Promise<boolean> {
  if (!needed) return false;
  const base64 = await loadFontBase64();
  if (!base64) return false;
  doc.addFileToVFS(CJK_FONT_FILE, base64);
  for (const style of styles) doc.addFont(CJK_FONT_FILE, CJK_FONT_FAMILY, style);
  return true;
}

/**
 * Install the font in the live document so canvas measurements and `getBBox`
 * (both used by svg2pdf) see the real metrics rather than a fallback face.
 */
export function ensureFontFace(): Promise<boolean> {
  if (!fontFacePromise) {
    fontFacePromise = (async () => {
      if (typeof document === 'undefined' || typeof FontFace === 'undefined') return false;
      const bytes = await loadFontBytes();
      if (!bytes) return false;
      try {
        const face = new FontFace(CJK_FONT_FAMILY, bytes);
        await face.load();
        document.fonts.add(face);
        return true;
      } catch {
        return false;
      }
    })();
  }
  return fontFacePromise;
}

/** Replace unencodable characters when no Unicode font could be loaded. */
export function winAnsiSafe(text: string): string {
  return text.replace(/[\u0100-\uffff]/g, '?');
}
