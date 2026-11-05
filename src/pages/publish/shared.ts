// ==========================================================================
// Ergalics Studio — shared helpers for the publishing pages
// ==========================================================================

import { usePublishStore } from '@/stores/publishStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { getVfs } from '@/core/vfs';
import { downloadBlob } from '@/core/download';
import { createPublishState, type PublishState } from '@/core/publish/state';

/** Current publish slice (never null, even for older projects). */
export function usePublishState(): PublishState {
  return useProjectStore((s) => s.project?.state.publish) ?? createPublishState();
}

export function downloadText(name: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(name, new TextEncoder().encode(text), mime);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write generated publishing artifacts into the project workspace and ask the
 * project store to commit them (`manuscript` conventional commit). Returns the
 * repo-relative paths that were written.
 */
export interface PublishArtifact {
  path: string;
  /** UTF-8 text content (source files, BibTeX, SVG). */
  content?: string;
  /** Binary content (PDF, PNG, …). Takes precedence over `content`. */
  bytes?: Uint8Array;
}

export async function writePublishArtifacts(
  files: PublishArtifact[],
  details: string,
): Promise<string[]> {
  const { project, autoCommit } = useProjectStore.getState();
  if (!project) return [];
  const root = getProjectRepoPath(project);
  const vfs = getVfs();
  for (const file of files) {
    if (file.bytes) await vfs.writeFileBinary(root, file.path, file.bytes);
    else await vfs.writeFile(root, file.path, file.content ?? '');
  }
  useAppStore.getState().bumpFileOps();
  await autoCommit('manuscript', details);
  return files.map((f) => f.path);
}

/** Open a print window for the generated HTML (browser "Save as PDF"). */
export function printHtml(html: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    useAppStore.getState().notify('warning', title);
    return;
  }
  win.opener = null;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}

/** Read a user-selected text file (used by BibTeX / CFF / Markdown import). */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/** Store helper bound to the active project. */
export function publishStore(): ReturnType<typeof usePublishStore.getState> {
  return usePublishStore.getState();
}
