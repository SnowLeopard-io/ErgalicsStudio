// ==========================================================================
// Ergalics Studio — open a workspace file from anywhere (terminal `open`)
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { editorStoreOpenInMode } from '@/components/editor/fileEditors/openInMode';
import { readProjectFile } from '@/core/workspace/project-files';
import {
  codeLanguageForFile,
  editorKindForFile,
} from '@/components/editor/fileEditors/shared';

/** The interpreter's workspace root — the project tree is mounted there. */
const WORKSPACE_ROOT = '/workspace';

/**
 * Resolve a terminal path to a project-relative path.
 * `/workspace/data/x.csv` → `data/x.csv`; `x.csv` stays `x.csv`.
 */
export function toProjectPath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith(WORKSPACE_ROOT + '/')) p = p.slice(WORKSPACE_ROOT.length + 1);
  else if (p === WORKSPACE_ROOT) p = '';
  if (p.startsWith('./')) p = p.slice(2);
  return p.replace(/^\/+/, '');
}

/**
 * Open a project file in the workbench: code files open in the code surface,
 * everything else in the preview tab. Returns a short status message for the
 * terminal to echo.
 */
export async function openWorkspaceFile(path: string): Promise<string> {
  const rel = toProjectPath(path);
  if (!rel) return 'open: missing file path';
  if (!useProjectStore.getState().project) return 'open: no project open';
  const name = rel.split('/').pop() ?? rel;
  try {
    const raw = await readProjectFile(rel);
    // Keep the explorer in sync with the editor: the tree reveals + selects
    // the file that was just opened.
    useAppStore.getState().setRevealFilePath(rel);
    const kind = editorKindForFile(name);
    if (kind === 'code') {
      const language = codeLanguageForFile(name);
      if (language) {
        editorStoreOpenInMode({ mode: 'code', language, code: raw, path: rel });
        return `opened ${rel}`;
      }
      useAppStore.getState().openFileEditor({ path: rel, name, editor: 'code', payload: raw });
      return `opened ${rel}`;
    }
    useAppStore.getState().openFilePreview({
      name,
      path: rel,
      kind: 'text',
      mimeType: 'text/plain',
      content: raw,
      size: raw.length,
    });
    return `opened ${rel}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `open: cannot open ${rel} (${message})`;
  }
}
