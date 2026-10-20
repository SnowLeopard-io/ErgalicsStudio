// ==========================================================================
// Browser download helper
// ==========================================================================
//
// Shared by project export, plugin `api.exportFile`, and the diagnostics
// export so object URLs are revoked consistently (an un-revoked blob URL
// pins the whole blob in memory for the lifetime of the document).

import { IS_DESKTOP, desktopBridge } from './platform';

export type DownloadData = string | ArrayBuffer | Blob;

/** Default MIME for `downloadBlob` when the caller does not supply one. */
function defaultMime(data: DownloadData): string {
  if (typeof data === 'string') return 'text/plain;charset=utf-8';
  if (data instanceof Blob) return data.type || 'application/octet-stream';
  return 'application/octet-stream';
}

/** Encode download data for the desktop save dialog. */
async function toDesktopPayload(data: DownloadData): Promise<string | Uint8Array> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new Uint8Array(data);
}

function extFor(mime?: string): string {
  if (!mime) return 'txt';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('json')) return 'json';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('zip')) return 'zip';
  return 'txt';
}

/**
 * Trigger a file download. On the desktop edition this opens the native save
 * dialog and writes through the main-process fs bridge; on the web it uses
 * the object-URL anchor flow. No-op when there is no DOM (SSR, tests, or the
 * plugin worker sandbox) so callers do not have to guard every site.
 */
export async function downloadBlob(
  fileName: string,
  data: DownloadData,
  mimeType?: string,
): Promise<void> {
  if (IS_DESKTOP) {
    try {
      const payload = await toDesktopPayload(data);
      const target = await desktopBridge().fs.pickFileSave({
        title: 'Save file',
        defaultName: fileName,
        filters: [{ name: 'File', extensions: [extFor(mimeType ?? defaultMime(data))] }],
      });
      if (!target) return; // user cancelled — not an error
      await desktopBridge().fs.writeFile(target, payload);
      return;
    } catch (err) {
      // Never lose the download to a dialog failure: fall through to web path.
      console.error('desktop save dialog failed, falling back to anchor download', err);
    }
  }
  if (typeof document === 'undefined') return;
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data as BlobPart], { type: mimeType ?? defaultMime(data) });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoking: in some browsers revoking synchronously cancels the
    // download before the browser has begun fetching the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
