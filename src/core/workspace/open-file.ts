// ==========================================================================
// Ergalics Studio — open a project file in the workbench
//
// The single routing point for "open this file": the file explorer, the
// terminal's `open` command and the per-project tab restore all come through
// here, so one file always lands in the same place (the canvas surface that
// belongs to its type).
//
//   *.py/*.js/*.r        → code workbench surface (editor + run)
//   *.flow.json          → flow canvas (parsed DAG, read-only fallback)
//   *.block.json         → block canvas (parsed IR, read-only fallback)
//   *.tex/*.ltx/*.bib    → publishing suite (manuscript / citation library)
//   text/markdown        → text preview tab
//   image/pdf/video/audio→ binary preview tab (blob URL)
//   anything else        → info placeholder tab
// ==========================================================================

import { useAppStore, fileTabKey, type FileEditorKind } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { editorStoreOpenInMode } from '@/components/editor/fileEditors/openInMode';
import { readProjectFile } from '@/core/workspace/project-files';
import { getVfs } from '@/core/vfs';
import { adoptBibFile, adoptTexFile } from '@/core/publish/adopt';
import {
  classifyFile,
  isPublishSourceFile,
  PREVIEW_CAP_CHARS,
} from '@/core/workspace/file-classify';
import {
  codeLanguageForFile,
  editorKindForFile,
  parseBlockPayload,
  parseFlowPayload,
} from '@/components/editor/fileEditors/shared';
import type { BlockGraphState } from '@/types/block';
import type { IRProgram } from '@/editor/ir';
import type { WorkbenchMode } from '@/types/editor';

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

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Size of a workspace file, or undefined when it cannot be read. */
async function projectFileSize(path: string): Promise<number | undefined> {
  const project = useProjectStore.getState().project;
  if (!project) return undefined;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  try {
    const entries = await getVfs().readDir(getProjectRepoPath(project), dir);
    return entries.find((e) => e.name === basename(path) && !e.isDir)?.size;
  } catch {
    return undefined;
  }
}

/**
 * Open a text / image / PDF / media preview tab (no editor routing). Used by
 * the explorer, by the terminal for non-editable files, and by tab restore.
 */
export async function openProjectPreview(
  path: string,
  opts: { size?: number } = {},
): Promise<void> {
  const rel = toProjectPath(path);
  if (!rel) return;
  const project = useProjectStore.getState().project;
  if (!project) return;
  const repoPath = getProjectRepoPath(project);
  const name = basename(rel);
  const { kind, mime } = classifyFile(name);

  if (kind === 'text' || kind === 'markdown') {
    // A first open has no tab yet (openFilePreview creates it below), so only
    // a tab that existed BEFORE the read can be "closed mid-read"; do not
    // resurrect that one.
    const key = fileTabKey(rel);
    const existedBefore = useAppStore.getState().canvasTabs.some((tab) => tab.key === key);
    let raw: string;
    try {
      raw = await getVfs().readFile(repoPath, rel);
    } catch {
      return;
    }
    if (!useAppStore.getState().canvasTabs.some((tab) => tab.key === key) && existedBefore) return;
    const capped = raw.length > PREVIEW_CAP_CHARS ? raw.slice(0, PREVIEW_CAP_CHARS) : raw;
    useAppStore.getState().openFilePreview({
      name,
      path: rel,
      kind,
      mimeType: mime,
      content: capped,
      size: raw.length,
    });
    return;
  }

  if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') {
    const size = opts.size ?? (await projectFileSize(rel)) ?? 0;
    // Two-phase open: show the tab (with a loading placeholder) right away —
    // LightningFS binary reads can take noticeable time — then fill the blob
    // URL when the bytes arrive.
    useAppStore.getState().openFilePreview({ name, path: rel, kind, mimeType: mime, size });
    let bytes: Uint8Array;
    try {
      bytes = await getVfs().readFileBinary(repoPath, rel);
    } catch {
      return;
    }
    const key = fileTabKey(rel);
    // The read outlives the click: if the user closed the placeholder tab
    // while the bytes were in flight, do not resurrect it.
    if (!useAppStore.getState().canvasTabs.some((tab) => tab.key === key)) return;
    const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    useAppStore.getState().openFilePreview({
      name,
      path: rel,
      kind,
      mimeType: mime,
      blobUrl,
      size,
    });
    return;
  }

  // unknown (ppt/pptx/doc/zip/…): info placeholder, download allowed.
  useAppStore.getState().openFilePreview({
    name,
    path: rel,
    kind,
    mimeType: mime,
    size: opts.size ?? 0,
  });
}

/**
 * Open an editable file as a plain editor tab (Monaco / Blockly / DAG source).
 * Only used for tabs whose payload failed its format check — valid block/flow
 * files open in their canvas surface instead.
 */
export async function openProjectEditorTab(
  path: string,
  editor?: FileEditorKind,
): Promise<void> {
  const rel = toProjectPath(path);
  if (!rel) return;
  if (!useProjectStore.getState().project) return;
  const name = basename(rel);
  const kind = editor ?? editorKindForFile(name);
  if (!kind) {
    await openProjectPreview(rel);
    return;
  }
  let raw: string;
  try {
    raw = await readProjectFile(rel);
  } catch {
    return;
  }
  const broken =
    kind === 'flow'
      ? !parseFlowPayload(raw)
      : kind === 'block'
        ? !parseBlockPayload(raw)
        : false;
  useAppStore.getState().openFileEditor({
    path: rel,
    name,
    editor: kind,
    payload: raw,
    ...(broken ? { broken: true } : {}),
  });
}

/**
 * Open (or focus) a workbench surface tab. When the project carried a saved
 * editor session for the file it is reused; otherwise the surface hydrates
 * from the file on disk.
 */
export async function openProjectSurface(
  mode: WorkbenchMode,
  path?: string,
): Promise<void> {
  const app = useAppStore.getState();
  if (!path) {
    app.setMode(mode);
    return;
  }
  const rel = toProjectPath(path);
  if (!rel) {
    app.setMode(mode);
    return;
  }
  if (!useProjectStore.getState().project) return;
  // A session restored with the project already owns this file's program —
  // just focus it; regenerating from disk would drop unsaved edits.
  const session = useEditorStore.getState().sessions.find((s) => s.filePath === rel);
  if (session) {
    useEditorStore.getState().setActiveSession(session.id);
    app.setMode(mode, rel);
    return;
  }
  const name = basename(rel);
  try {
    if (mode === 'code') {
      const language = codeLanguageForFile(name);
      if (language) {
        const code = await readProjectFile(rel);
        editorStoreOpenInMode({ mode: 'code', language, code, path: rel });
        return;
      }
    } else if (mode === 'block' || mode === 'flow') {
      const raw = await readProjectFile(rel);
      if (mode === 'flow') {
        const parsed = parseFlowPayload(raw);
        if (parsed) {
          editorStoreOpenInMode({
            mode: 'flow',
            graph: parsed.graph as unknown as BlockGraphState,
            path: rel,
          });
          return;
        }
      } else {
        const parsed = parseBlockPayload(raw);
        if (parsed) {
          editorStoreOpenInMode({
            mode: 'block',
            ir: parsed.ir as unknown as IRProgram,
            path: rel,
          });
          return;
        }
      }
    }
  } catch {
    // Fall through to a bare surface tab: better an empty canvas than a tab
    // that silently fails to open.
  }
  useAppStore.getState().setMode(mode, rel);
}

/**
 * Open a workspace file in the canvas: route it to the surface / preview
 * that belongs to its type. The file explorer and the terminal both use
 * this, so exactly one tab is opened for a given path.
 */
export async function openProjectFile(
  path: string,
  opts: { size?: number } = {},
): Promise<void> {
  const rel = toProjectPath(path);
  if (!rel) return;
  if (!useProjectStore.getState().project) return;
  const name = basename(rel);

  // Manuscript sources open in the LaTeX editor, not the plain code editor.
  if (isPublishSourceFile(name)) {
    try {
      const raw = await readProjectFile(rel);
      if (name.toLowerCase().endsWith('.bib')) adoptBibFile(raw);
      else adoptTexFile(name, raw);
    } catch {
      // The editor can still be opened if the file read fails.
    }
    useAppStore.getState().setEmbeddedTool('latex-editor');
    return;
  }

  const kind = editorKindForFile(name);
  if (kind) {
    let raw: string;
    try {
      raw = await readProjectFile(rel);
    } catch {
      throw new Error(`cannot read ${rel}`);
    }
    if (kind === 'flow') {
      const parsed = parseFlowPayload(raw);
      // Block / flow files open in their real workbench (canvas + run), each
      // file getting its own surface tab and editor session. A malformed
      // payload degrades to the read-only editor tab.
      if (parsed) {
        editorStoreOpenInMode({
          mode: 'flow',
          graph: parsed.graph as unknown as BlockGraphState,
          path: rel,
        });
        return;
      }
      useAppStore.getState().openFileEditor({
        path: rel,
        name,
        editor: 'flow',
        payload: raw,
        broken: true,
      });
      return;
    }
    if (kind === 'block') {
      const parsed = parseBlockPayload(raw);
      if (parsed) {
        editorStoreOpenInMode({
          mode: 'block',
          ir: parsed.ir as unknown as IRProgram,
          path: rel,
        });
        return;
      }
      useAppStore.getState().openFileEditor({
        path: rel,
        name,
        editor: 'block',
        payload: raw,
        broken: true,
      });
      return;
    }
    const language = codeLanguageForFile(name);
    if (language) {
      // Source files open in the full code workbench (editor + console +
      // variables + preview), one session per file.
      editorStoreOpenInMode({ mode: 'code', language, code: raw, path: rel });
      return;
    }
    useAppStore.getState().openFileEditor({ path: rel, name, editor: 'code', payload: raw });
    return;
  }

  await openProjectPreview(rel, opts);
}

/**
 * Terminal `open` command: open the file in the canvas and reveal it in the
 * file explorer. Returns a short status message for the terminal to echo.
 */
export async function openWorkspaceFile(path: string): Promise<string> {
  const rel = toProjectPath(path);
  if (!rel) return 'open: missing file path';
  if (!useProjectStore.getState().project) return 'open: no project open';
  try {
    await openProjectFile(rel);
    // Keep the explorer in sync with the canvas: the tree reveals + selects
    // the file that was just opened.
    useAppStore.getState().setRevealFilePath(rel);
    return `opened ${rel}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `open: cannot open ${rel} (${message})`;
  }
}
