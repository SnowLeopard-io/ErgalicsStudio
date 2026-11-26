// ==========================================================================
// Input fingerprint capture (FR-1 input.dataHash)
//
// Every path that hands data to a plugin funnels through `ingestForPlugin`,
// so one capture point covers the project-data picker, uploads, editor
// drafts and AI tools alike.
//
// The hash is the SHA-256 of the file's original bytes when the project
// file carries one (imported files), and the SHA-256 of the text payload
// otherwise (legacy project files, editor drafts, generated templates).
// Project files that predate the fingerprint feature get their hash
// back-filled and persisted, so later runs cite the same value.
// ==========================================================================

import { sha256TextAsync } from './hash';
import { setPluginDataSource, type ActiveDataSource } from './activeData';
import { useProjectStore } from '@/stores/projectStore';
import type { DataSourceOrigin } from '@/types/dataSchema';

export interface CaptureInputArgs {
  /** Plugin the data is bound to (the record's owner). */
  pluginId: string;
  /** File name as shown to the user. */
  fileName: string;
  /** The payload handed to the plugin. */
  text: string;
  /** Project data file id, when the payload came from the project. */
  fileId?: string;
  /** Where the payload came from (project file, upload, editor draft). */
  origin?: DataSourceOrigin;
}

/**
 * Resolve the fingerprint for one ingestion and bind it to the plugin.
 * Returns the registered source so callers can log or display it.
 */
export async function capturePluginInput(args: CaptureInputArgs): Promise<ActiveDataSource> {
  const files = useProjectStore.getState().project?.data.files;
  const entry = files?.find((f) => f.id === args.fileId);

  let source: ActiveDataSource;
  if (entry?.sha256) {
    // The input file is known and carries a fingerprint — cite it. This is
    // the value a reviewer reproduces with `sha256sum` against the file.
    source = { name: entry.name, hash: entry.sha256, bytes: entry.size };
  } else {
    const hash = await sha256TextAsync(args.text);
    source = { name: entry?.name ?? args.fileName, hash, bytes: args.text.length };
    // Back-fill a legacy project file so later runs cite the same value.
    if (entry && entry.content === args.text) {
      useProjectStore.getState().setDataFileHash(entry.id, hash);
    }
  }

  setPluginDataSource(args.pluginId, source);
  return source;
}
