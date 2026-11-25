// ==========================================================================
// Export hook (FR-4)
//
// The plugin host owns the single `api.exportFile` funnel. This tiny registry
// lets the result store attach sidecar emission without importing a store
// from the host layer (which would create a store ↔ store cycle).
// ==========================================================================

import type { DownloadData } from '@/core/download';

export type ExportSidecarHook = (
  fileName: string,
  data: DownloadData,
  mimeType: string | undefined,
  pluginId: string,
) => void;

let hook: ExportSidecarHook | null = null;

export function setExportSidecarHook(next: ExportSidecarHook | null): void {
  hook = next;
}

export function emitExportSidecar(
  fileName: string,
  data: DownloadData,
  mimeType: string | undefined,
  pluginId: string,
): void {
  try {
    hook?.(fileName, data, mimeType, pluginId);
  } catch {
    // Provenance must never break the user's export.
  }
}
