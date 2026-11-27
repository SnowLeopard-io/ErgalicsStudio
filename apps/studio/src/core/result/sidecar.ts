// ==========================================================================
// Export sidecar (FR-4)
//
// Every exported artifact carries a same-named .json sibling built from the
// ResultRecord, the export settings, and the SHA-256 of the exported bytes —
// so a reviewer can detect a tampered figure without reopening the app.
// ==========================================================================

import { downloadBlob } from '@/core/download';
import { saveTextArtifact, type ArtifactDir } from '@/core/workspace-artifacts';
import { Sha256Stream, sha256Hex, sha256Text } from './hash';
import type { ResultRecord } from './types';

export interface SidecarExportSettings {
  format: string;
  template?: string;
  dpi?: number;
  colorSpace?: 'rgb' | 'cmyk';
  /** Stable output name, e.g. `figure.svg`. */
  fileName: string;
}

export interface Sidecar {
  schema: 'ergalics.sidecar/1';
  resultId: string;
  createdAt: string;
  pluginId: string;
  pluginVersion: string;
  dataHash: string;
  params: Record<string, unknown>;
  metrics: ResultRecord['metrics'];
  seed?: number;
  environment: ResultRecord['environment'];
  export: SidecarExportSettings & {
    sha256: string;
  };
  /** When a figure mixes panels from several results, all of their ids. */
  sourceResultIds?: string[];
}

export function sidecarName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}.json`;
}

export function buildSidecar(
  record: ResultRecord,
  artifact: { name: string; hash: string },
  settings: Omit<SidecarExportSettings, 'fileName'>,
  sourceResultIds?: string[],
): Sidecar {
  return {
    schema: 'ergalics.sidecar/1',
    resultId: record.resultId,
    createdAt: record.createdAt,
    pluginId: record.pluginId,
    pluginVersion: record.pluginVersion,
    dataHash: record.input.dataHash,
    params: record.params,
    metrics: record.metrics,
    ...(record.seed !== undefined ? { seed: record.seed } : {}),
    environment: record.environment,
    export: { ...settings, fileName: artifact.name, sha256: artifact.hash },
    ...(sourceResultIds && sourceResultIds.length > 1 ? { sourceResultIds } : {}),
  };
}

export function sidecarText(sidecar: Sidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

export function downloadSidecar(sidecar: Sidecar): void {
  const name = sidecarName(sidecar.export.fileName);
  void downloadBlob(name, sidecarText(sidecar), 'application/json;charset=utf-8');
}

export function hashTextArtifact(content: string): string {
  return sha256Text(content);
}

export function hashBinaryArtifact(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

/** Hash any payload accepted by the shared download helper. */
export async function hashDownloadData(data: string | ArrayBuffer | Blob): Promise<string> {
  if (typeof data === 'string') return sha256Text(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const hasher = new Sha256Stream();
    for (let offset = 0; offset < data.size; offset += 1024 * 1024) {
      const chunk = await data
        .slice(offset, Math.min(offset + 1024 * 1024, data.size))
        .arrayBuffer();
      hasher.update(new Uint8Array(chunk));
    }
    return hasher.digestHex();
  }
  return sha256Hex(new Uint8Array(data as ArrayBuffer));
}

/** Store a sidecar next to an artifact already saved in the workspace. */
export function saveSidecarToWorkspace(
  project: Parameters<typeof saveTextArtifact>[0],
  artifactPath: string,
  sidecar: Sidecar,
  dir: ArtifactDir = 'figures',
): Promise<string> {
  const file = artifactPath.split(/[\\/]/).pop() ?? artifactPath;
  return saveTextArtifact(project, dir, sidecarName(file), sidecarText(sidecar));
}
