// ==========================================================================
// Ergalics Studio — workspace file classification
//
// One place that answers "what is this file?" for the workbench: does it open
// in a text/markdown preview, as an image/PDF/video/audio blob, or is it an
// unknown binary? The file explorer and the terminal `open` command (plus
// the per-project tab restore) all route through this, so a file opens the
// same way no matter how it was reached.
// ==========================================================================

import type { FilePreviewKind } from '@/stores/appStore';

/** Raw content is capped so a multi-MB snapshot never freezes the UI. */
export const PREVIEW_CAP_CHARS = 200_000;

/** Extensions previewed as UTF-8 text; everything else is treated as binary. */
const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'csv', 'tsv', 'yml', 'yaml', 'toml', 'svg',
  'clproj', 'lock', 'log', 'ini', 'sh', 'js', 'py', 'r',
  // Manuscript / bibliography sources are plain text too (the LaTeX editor
  // claims them first, but this keeps the preview fallback correct).
  'tex', 'ltx', 'sty', 'cls', 'bib', 'cff',
  // Other research-suite artifacts written into the workspace.
  'html', 'htm', 'ipynb',
]);

/** Extension-less files that are still text. */
const TEXT_NAME = new Set(['.gitignore', '.gitattributes', 'license', 'readme']);

/** True when the file's extension (or bare name) marks it as UTF-8 text. */
export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAME.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && TEXT_EXT.has(lower.slice(dot + 1));
}

export type FileClassification = { kind: FilePreviewKind; mime: string };

/** Classify a file by extension into a preview kind + MIME. */
export function classifyFile(name: string): FileClassification {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  switch (ext) {
    case 'md':
    case 'markdown':
      return { kind: 'markdown', mime: 'text/markdown' };
    case 'png':
      return { kind: 'image', mime: 'image/png' };
    case 'jpg':
    case 'jpeg':
      return { kind: 'image', mime: 'image/jpeg' };
    case 'gif':
      return { kind: 'image', mime: 'image/gif' };
    case 'webp':
      return { kind: 'image', mime: 'image/webp' };
    case 'svg':
      return { kind: 'image', mime: 'image/svg+xml' };
    case 'bmp':
      return { kind: 'image', mime: 'image/bmp' };
    case 'ico':
      return { kind: 'image', mime: 'image/x-icon' };
    case 'pdf':
      return { kind: 'pdf', mime: 'application/pdf' };
    case 'mp4':
      return { kind: 'video', mime: 'video/mp4' };
    case 'webm':
      return { kind: 'video', mime: 'video/webm' };
    case 'mov':
      return { kind: 'video', mime: 'video/quicktime' };
    case 'mp3':
      return { kind: 'audio', mime: 'audio/mpeg' };
    case 'wav':
      return { kind: 'audio', mime: 'audio/wav' };
    case 'ogg':
    case 'oga':
      return { kind: 'audio', mime: 'audio/ogg' };
    case 'm4a':
      return { kind: 'audio', mime: 'audio/mp4' };
    default:
      break;
  }
  if (isTextFile(name)) return { kind: 'text', mime: 'text/plain;charset=utf-8' };
  return { kind: 'unknown', mime: 'application/octet-stream' };
}

/** Manuscript sources open in the LaTeX editor suite by default. */
export function isPublishSourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tex') || lower.endsWith('.ltx') || lower.endsWith('.bib');
}
