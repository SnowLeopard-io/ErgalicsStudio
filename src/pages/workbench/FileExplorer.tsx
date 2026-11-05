// ==========================================================================
// Ergalics Studio — sidebar file explorer (Standard mode, activity bar)
//
// 与科研套件的 FileExplorerPage 同源：浏览项目工作区（getVfs +
// getProjectRepoPath）的真实文件树，标准骨架为 project.clproj + runs/ +
// figures/ + data/ + code/ + manuscript/ + .ergalics/ + .gitignore/
// .gitattributes（§3.1）。与 git 完全解耦：资源管理器只依赖 Vfs 层，
// 版本控制是 Git 面板的可选功能。
//
// 常规文件管理：新建文件/文件夹、重命名、删除、复制/剪切/粘贴、
// 拖拽移动，以及 F2/Delete/Ctrl+C/X/V 等快捷键（A 需求）。全部写操作
// 直接作用于工作树，不触发 git add/commit（用户明确暂不关注 git）。
// 点击文件 → 中央画布区按类型预览（appStore.filePreview，B 需求）。
// ==========================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { useAppStore, fileTabKey, editorTabKey, type FilePreviewKind } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { usePublishStore } from '@/stores/publishStore';
import { getVfs, isValidVfsEntryName, type Vfs } from '@/core/vfs';
import type { VfsEntry } from '@/core/vfs';
import { parseBibtex } from '@/core/publish/bibtex';
import type { ManuscriptRecord } from '@/core/publish/state';
import {
  editorKindForFile,
  parseFlowPayload,
  parseBlockPayload,
} from '@/components/editor/fileEditors/shared';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshIcon,
  FilePlusIcon,
  FolderPlusIcon,
  ClipboardIcon,
  DownloadIcon,
} from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/** Raw content is capped so a multi-MB snapshot never freezes the UI. */
const PREVIEW_CAP_CHARS = 200_000;

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

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAME.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && TEXT_EXT.has(lower.slice(dot + 1));
}

/** Placeholder marker files used to keep empty dirs trackable (SKEL §3.1). */
const PLACEHOLDER_NAMES = new Set(['.gitkeep', '.keep']);

type Classification = { kind: FilePreviewKind; mime: string };

/** Classify a file by extension into a preview kind + MIME (B2). */
function classifyFile(name: string): Classification {
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
function isPublishSourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tex') || lower.endsWith('.ltx') || lower.endsWith('.bib');
}

/** Focus the matching manuscript, or adopt a workspace `.tex` as a new one. */
function adoptTexFile(name: string, source: string): void {
  const store = usePublishStore.getState();
  const manuscripts = useProjectStore.getState().project?.state.publish?.manuscripts ?? [];
  const existing = manuscripts.find((m) => m.source === source);
  if (existing) {
    store.setActiveManuscript(existing.id);
    return;
  }
  const now = Date.now();
  const record: ManuscriptRecord = {
    id: crypto.randomUUID(),
    name: name.replace(/\.[^.]+$/, '') || 'Manuscript',
    templateId: 'ieee',
    citationStyle: 'ieee',
    source,
    createdAt: now,
    updatedAt: now,
  };
  store.saveManuscript(record);
}

/** Merge a workspace `.bib` into the citation library (same-key replaces). */
function adoptBibFile(source: string): void {
  const entries = parseBibtex(source);
  if (entries.length > 0) usePublishStore.getState().addLibraryEntries(entries);
}

/** Static guide rows for the standard project skeleton (§3.1 templates). */
const GUIDE: ReadonlyArray<{ match: (p: string) => boolean; key: string }> = [
  { match: (p) => p === 'project.clproj', key: 'explorer.file_clproj' },
  { match: (p) => p === 'runs' || p.startsWith('runs/'), key: 'explorer.dir_runs' },
  { match: (p) => p === 'figures' || p.startsWith('figures/'), key: 'explorer.dir_figures' },
  { match: (p) => p === 'data' || p.startsWith('data/'), key: 'explorer.dir_data' },
  { match: (p) => p === 'code' || p.startsWith('code/'), key: 'explorer.dir_code' },
  { match: (p) => p === 'manuscript' || p.startsWith('manuscript/'), key: 'explorer.dir_manuscript' },
  { match: (p) => p === '.ergalics' || p.startsWith('.ergalics/'), key: 'explorer.dir_ergalics' },
  { match: (p) => p === '.git' || p.startsWith('.git/'), key: 'explorer.dir_git' },
  { match: (p) => p === '.gitignore' || p === '.gitattributes', key: 'explorer.dir_ignore' },
];

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirname = (path: string) => {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
};
const basename = (path: string) => {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
};
/** True when `target` is `src` itself or a descendant of `src`. */
const isSameOrUnder = (src: string, target: string) =>
  target === src || target.startsWith(`${src}/`);

/** Menu state for the right-click context menu. */
interface MenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

/** Repo file/items held in the explorer's own clipboard. */
interface ClipState {
  mode: 'copy' | 'cut';
  items: VfsEntry[];
}

/** Inline name-input row used for new file/folder and rename (module-scope so
 *  it never remounts when the parent re-renders, which would wipe typing). */
function InlineInput({
  initial,
  placeholder,
  autoSelect = true,
  depth,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  autoSelect?: boolean;
  depth: number;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <li className="explorer-inline" style={{ paddingLeft: 6 + depth * 14 }}>
      <input
        autoFocus
        className="input explorer-inline-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={(e) => autoSelect && e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onCommit(value);
          else if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
        onBlur={() => onCancel()}
      />
    </li>
  );
}

export function FileExplorer() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const openFilePreview = useAppStore((s) => s.openFilePreview);
  const openFileEditor = useAppStore((s) => s.openFileEditor);
  const activeTab = useAppStore((s) => s.activeTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const renameFileTab = useAppStore((s) => s.renameFileTab);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);
  const setEmbeddedTool = useAppStore((s) => s.setEmbeddedTool);

  /** Per-directory listings, keyed by repo-relative dir ('' = root). */
  const [tree, setTree] = useState<Record<string, VfsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  /** Currently selected row (single-click select; Enter/double-click opens). */
  const [selected, setSelected] = useState<VfsEntry | null>(null);
  /** Explorer-local clipboard (copy/cut). */
  const [clipboard, setClipboard] = useState<ClipState | null>(null);
  /** Right-click context menu. */
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** Inline create-input row: shown under this dir ('' = root). */
  const [inlineCreate, setInlineCreate] = useState<{ parentDir: string; type: 'file' | 'dir' } | null>(null);
  /** Row replaced by an inline rename input. */
  const [renaming, setRenaming] = useState<VfsEntry | null>(null);
  /** Directory currently highlighted as a drop target. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Entry awaiting delete confirmation (files and directories). */
  const [deleteTarget, setDeleteTarget] = useState<VfsEntry | null>(null);

  /** Repo root url ('' = root). */
  const rootDir = '';
  /** Drag source, tracked via ref so it survives the drop event. */
  const dragRef = useRef<VfsEntry | null>(null);

  /** Load a directory listing into `tree` and return the fetched entries (so
   *  async callers don't read the stale render closure afterwards). */
  const loadDir = useCallback(
    async (dir: string): Promise<VfsEntry[]> => {
      if (!project) return [];
      try {
        const adapter = getVfs();
        const entries = await adapter.readDir(getProjectRepoPath(project), dir);
        setTree((prev) => ({ ...prev, [dir]: entries }));
        return entries;
      } catch {
        setTree((prev) => ({ ...prev, [dir]: [] }));
        return [];
      }
    },
    [project],
  );

  const refreshDirs = useCallback(
    (dirs: string[]) => {
      const seen = new Set<string>();
      return Promise.all(dirs.map((d) => (seen.has(d) ? undefined : (seen.add(d), loadDir(d)))).filter(Boolean));
    },
    [loadDir],
  );

  // Fresh project → clean slate + root listing. The tree is git-independent:
  // readDir works on a plain directory, and repo state is the Git panel's
  // concern (folder imports defer git init on purpose).
  useEffect(() => {
    setTree({});
    setExpanded(new Set());
    setSelected(null);
    setClipboard(null);
    if (!project) return;
    void loadDir('').catch(() => undefined);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // External working-tree changes (e.g. an MD preview save) refresh listings.
  useEffect(() => {
    if (!project) return;
    // Refresh every directory we have a listing for (not only expanded ones):
    // a bump may arrive while a subtree was collapsed after an earlier load,
    // and its cached listing must not resurface stale content on re-expand.
    void refreshDirs(['', ...expanded, ...Object.keys(tree)]);
  }, [fileOpsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        // Always reload on expand: the cached listing may predate external
        // writes (imports, explorer ops in another view) — cheap and fresh.
        void loadDir(dir);
      }
      return next;
    });
  };

  const refresh = async () => {
    if (!project) return;
    setLoading(true);
    try {
      const dirs = ['', ...expanded];
      await refreshDirs(dirs);
    } finally {
      setLoading(false);
    }
  };

  const openPreview = async (entry: VfsEntry) => {
    if (!project || entry.isDir) return;
    try {
      const adapter = getVfs();
      const repoPath = getProjectRepoPath(project);
      // Manuscript sources open in the LaTeX editor, not the plain code
      // editor: .tex is adopted as a manuscript, .bib is merged into the
      // citation library the editor previews against.
      if (isPublishSourceFile(entry.name)) {
        try {
          const raw = await adapter.readFile(repoPath, entry.path);
          if (entry.name.toLowerCase().endsWith('.bib')) adoptBibFile(raw);
          else adoptTexFile(entry.name, raw);
        } catch {
          // The editor can still be opened if the file read fails.
        }
        useAppStore.getState().setEmbeddedTool('latex-editor');
        return;
      }
      // Editable files (design doc P2-P4) open as editor tabs: `.py/.js/.r` →
      // Monaco code, `*.flow.json` → flow DAG, `*.block.json` → Blockly. A
      // payload that fails its format check degrades to a read-only view.
      const editorKind = editorKindForFile(entry.name);
      if (editorKind) {
        const raw = await adapter.readFile(repoPath, entry.path);
        if (editorKind === 'flow') {
          openFileEditor({
            path: entry.path,
            name: entry.name,
            editor: 'flow',
            payload: raw,
            broken: parseFlowPayload(raw) === null,
          });
        } else if (editorKind === 'block') {
          openFileEditor({
            path: entry.path,
            name: entry.name,
            editor: 'block',
            payload: raw,
            broken: parseBlockPayload(raw) === null,
          });
        } else {
          openFileEditor({ path: entry.path, name: entry.name, editor: 'code', payload: raw });
        }
        return;
      }
      const { kind, mime } = classifyFile(entry.name);
      if (kind === 'text' || kind === 'markdown') {
        // A first open has no tab yet (openFilePreview creates it below), so
        // only a tab that existed BEFORE the read can be "closed mid-read";
        // do not resurrect that one.
        const textKey = fileTabKey(entry.path);
        const existedBefore = useAppStore.getState().canvasTabs.some((tab) => tab.key === textKey);
        const raw = await adapter.readFile(repoPath, entry.path);
        if (existedBefore && !useAppStore.getState().canvasTabs.some((tab) => tab.key === textKey)) return;
        const capped = raw.length > PREVIEW_CAP_CHARS ? raw.slice(0, PREVIEW_CAP_CHARS) : raw;
        openFilePreview({
          name: entry.name,
          path: entry.path,
          kind,
          mimeType: mime,
          content: capped,
          size: entry.size,
        });
        return;
      }
      if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') {
        // Two-phase open: show the tab (with a loading placeholder) right
        // away — LightningFS binary reads can take noticeable time — then
        // fill the blob URL when the bytes arrive.
        openFilePreview({
          name: entry.name,
          path: entry.path,
          kind,
          mimeType: mime,
          size: entry.size,
        });
        const bytes = await adapter.readFileBinary(repoPath, entry.path);
        // The read outlives the click: if the user closed the placeholder tab
        // while the bytes were in flight, do not resurrect it.
        const key = fileTabKey(entry.path);
        if (!useAppStore.getState().canvasTabs.some((tab) => tab.key === key)) return;
        const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        openFilePreview({
          name: entry.name,
          path: entry.path,
          kind,
          mimeType: mime,
          blobUrl,
          size: entry.size,
        });
        return;
      }
      // unknown (ppt/pptx/doc/zip/…): info placeholder, download allowed.
      openFilePreview({
        name: entry.name,
        path: entry.path,
        kind,
        mimeType: mime,
        size: entry.size,
      });
    } catch {
      notify('error', t('workbench.explorer.read_failed'));
    }
  };

  const guideFor = (path: string): string | undefined => {
    const row = GUIDE.find((g) => g.match(path));
    return row ? t(row.key) : undefined;
  };

  const entryAt = (dir: string, name: string): VfsEntry | undefined =>
    (tree[dir] ?? []).find((e) => e.name === name);

  const existsName = (dir: string, name: string): boolean => !!entryAt(dir, name);

  /** Pick an unused name in `dir` for a copy/paste target. `exists` lets
   *  async callers check freshly loaded listings instead of the stale
   *  render-closure `tree`. */
  const suggestUniqueName = (
    dir: string,
    name: string,
    exists: (n: string) => boolean = (n) => existsName(dir, n),
  ): string => {
    if (!exists(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i += 1) {
      const cand = `${stem} (${i})${ext}`;
      if (!exists(cand)) return cand;
    }
  };

  const copyItem = useCallback(
    async (adapter: Vfs, repoPath: string, from: string, to: string, isDir: boolean) => {
      if (!isDir) {
        const data = await adapter.readFileBinary(repoPath, from);
        await adapter.writeFileBinary(repoPath, to, data);
        return;
      }
      const entries = await adapter.readDir(repoPath, from);
      for (const e of entries) {
        await copyItem(
          adapter,
          repoPath,
          joinPath(from, e.name),
          joinPath(to, e.name),
          e.isDir,
        );
      }
    },
    [],
  );

  /** Paste the clipboard into `targetDir`. copy → write copies; cut → move. */
  const paste = async (targetDir: string) => {
    if (!project || !clipboard || clipboard.items.length === 0) return;
    const adapter = getVfs();
    const repoPath = getProjectRepoPath(project);
    try {
      // The target dir may never have been listed; load it now so conflict
      // checks and unique-name suggestions see the real contents. The `tree`
      // state in this render closure stays stale for directories loaded here,
      // so checks must use the freshly returned listing.
      const fresh = tree[targetDir] ? null : await loadDir(targetDir);
      const exists = (name: string): boolean =>
        fresh ? fresh.some((e) => e.name === name) : existsName(targetDir, name);
      let failed = false;
      for (const item of clipboard.items) {
        if (clipboard.mode === 'cut') {
          const target = joinPath(targetDir, basename(item.path));
          if (isSameOrUnder(item.path, targetDir)) {
            notify('error', t('workbench.explorer.move_failed'));
            failed = true;
            continue;
          }
          if (exists(basename(item.path))) {
            notify('error', t('workbench.explorer.name_conflict', { name: basename(item.path) }));
            failed = true;
            continue;
          }
          await adapter.renameEntry(repoPath, item.path, target);
        } else {
          const target = joinPath(targetDir, suggestUniqueName(targetDir, basename(item.path), exists));
          await copyItem(adapter, repoPath, item.path, target, item.isDir);
        }
      }
      if (clipboard.mode === 'cut' && !failed) setClipboard(null);
      void refreshDirs([targetDir, ...clipboard.items.map((i) => dirname(i.path))]);
      if (!failed) notify('success', t('workbench.explorer.pasted_hint'));
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  const setClip = (entry: VfsEntry, mode: 'copy' | 'cut') => {
    if (entry.isDir) void loadDir(entry.path); // ensure sub-list exists for conflict checks
    setClipboard({ mode, items: [entry] });
    notify('info', t(mode === 'copy' ? 'workbench.explorer.copied_hint' : 'workbench.explorer.cut_hint'));
    setMenu(null);
    setSelected(entry);
  };

  const requestDelete = (entry: VfsEntry) => {
    setMenu(null);
    // Files are destructive to delete permanently too — route every delete
    // (context menu, button, keyboard) through the confirm dialog.
    setDeleteTarget(entry);
  };

  const doDelete = async (entry: VfsEntry) => {
    if (!project) return;
    const adapter = getVfs();
    const repoPath = getProjectRepoPath(project);
    try {
      await adapter.deleteEntry(repoPath, entry.path, entry.isDir);
      closeTab(fileTabKey(entry.path));
      closeTab(editorTabKey(entry.path));
      if (entry.isDir) {
        // Close every editor tab under the deleted directory — a surviving
        // dirty tab would recreate the file on its next save.
        const prefix = `${entry.path}/`;
        const tabs = useAppStore.getState().canvasTabs;
        for (const tab of tabs) {
          if (tab.kind === 'editor' && (tab.path === entry.path || tab.path.startsWith(prefix))) {
            closeTab(tab.key);
          }
        }
      }
      if (selected?.path === entry.path) setSelected(null);
      await refreshDirs([dirname(entry.path)]);
      // 顶部栏「数据」列表（project.data.files）与 data/ 目录是双轨存储：
      // 删除镜像文件时必须同步移除列表条目，否则顶栏计数与「载入插件」
      // 仍能看到已删除的文件。removeDataFile 的 VFS 重复删除会被静默吞掉。
      if (!entry.isDir && entry.path.startsWith('data/')) {
        const name = entry.path.slice('data/'.length);
        const match = useProjectStore
          .getState()
          .project?.data.files.find((f) => f.name === name);
        if (match) useProjectStore.getState().removeDataFile(match.id);
      }
      notify('success', t('workbench.explorer.deleted_hint'));
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  // ---- 顶部栏「数据」列表与 data/ 目录的双轨同步 ---------------------------
  // 重命名 / 移动 data/ 下的文件时，project.data.files 里的条目必须跟着变，
  // 否则顶栏计数与「载入插件」仍指向旧路径。仅处理 data/ 顶层的普通文件。

  /** Is `path` a file directly under the project's data/ folder? */
  const isTopLevelDataFile = (path: string) => path.startsWith('data/') && !path.slice(5).includes('/');

  /** Sync the in-project data-files list after the VFS entry at `oldPath`
   *  became `newPath` (rename or move). Read-only on the VFS except the
   *  move-into-data/ case, which upserts the entry from the file content. */
  const syncDataTrack = async (oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    const wasData = isTopLevelDataFile(oldPath);
    const isData = isTopLevelDataFile(newPath);
    const store = useProjectStore.getState();
    if (!store.project) return;
    if (wasData && isData) {
      const match = store.project.data.files.find((f) => f.name === oldPath.slice(5));
      if (match) store.renameDataFile(match.id, newPath.slice(5));
    } else if (wasData && !isData) {
      const match = store.project.data.files.find((f) => f.name === oldPath.slice(5));
      if (match) store.removeDataFile(match.id);
    } else if (!wasData && isData) {
      try {
        const content = await getVfs().readFile(getProjectRepoPath(store.project), newPath);
        await store.addDataFile(new File([content], newPath.slice(5), { type: 'text/plain' }));
      } catch {
        // Unsupported format — the file lives on in the workspace tree only.
      }
    }
  };

  const beginRename = (entry: VfsEntry) => {
    setMenu(null);
    setSelected(entry);
    setRenaming(entry);
    setInlineCreate(null);
  };

  const commitRename = async (entry: VfsEntry, rawName: string) => {
    const name = rawName.trim();
    setRenaming(null);
    if (!project || !name || name === entry.name) return;
    if (!isValidVfsEntryName(name)) {
      notify('error', t('workbench.explorer.name_invalid', { name }));
      return;
    }
    const parent = dirname(entry.path);
    const target = joinPath(parent, name);
    if (existsName(parent, name)) {
      notify('error', t('workbench.explorer.name_conflict', { name }));
      return;
    }
    const adapter = getVfs();
    const repoPath = getProjectRepoPath(project);
    try {
      await adapter.renameEntry(repoPath, entry.path, target);
      renameFileTab(entry.path, name, target);
      await syncDataTrack(entry.path, target);
      await refreshDirs([parent]);
      notify('success', t('workbench.explorer.renamed_hint'));
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  const beginCreate = (parentDir: string, type: 'file' | 'dir') => {
    setMenu(null);
    setRenaming(null);
    setInlineCreate({ parentDir, type });
    // Auto-expand a collapsed parent dir so the inline input row is visible.
    if (parentDir) {
      if (!expanded.has(parentDir)) {
        setExpanded((prev) => new Set(prev).add(parentDir));
      }
      if (!(parentDir in tree)) void loadDir(parentDir);
    }
  };

  const commitCreate = async (type: 'file' | 'dir', parentDir: string, rawName: string) => {
    const name =
      rawName.trim() ||
      (type === 'dir'
        ? t('workbench.explorer.default_folder')
        : t('workbench.explorer.default_file'));
    setInlineCreate(null);
    if (!project) return;
    if (!isValidVfsEntryName(name)) {
      notify('error', t('workbench.explorer.name_invalid', { name }));
      return;
    }
    if (existsName(parentDir, name)) {
      notify('error', t('workbench.explorer.name_conflict', { name }));
      return;
    }
    const path = joinPath(parentDir, name);
    const adapter = getVfs();
    const repoPath = getProjectRepoPath(project);
    try {
      if (type === 'dir') {
        // Real dirs are supported by LightningFS; the .gitkeep marker keeps
        // the dir trackable by git (§3.1 convention) and is hidden in the UI.
        await adapter.writeFile(repoPath, `${path}/.gitkeep`, '');
      } else {
        await adapter.writeFile(repoPath, path, '');
      }
      await refreshDirs([parentDir]);
      if (type === 'file') await openPreview({ name, path, isDir: false, size: 0 });
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  // ---- drag & drop (move) --------------------------------------------------

  const canDropInto = (src: VfsEntry | null, targetDir: string) =>
    !!src && !isSameOrUnder(src.path, targetDir);

  const onDropTarget = (targetDir: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (!project) return;
    // External OS drop (no internal drag in flight): import the files into
    // the target directory instead of treating the event as a move.
    const files = Array.from(e.dataTransfer.files);
    if (!dragRef.current && files.length > 0) {
      await importExternalFiles(files, targetDir);
      return;
    }
    const src = dragRef.current;
    if (!canDropInto(src, targetDir)) return;
    if (src) {
      const adapter = getVfs();
      const repoPath = getProjectRepoPath(project);
      const target = joinPath(targetDir, basename(src.path));
      // The target directory may never have been expanded, in which case the
      // conflict table is empty and the guard below would silently pass —
      // load it first so an existing same-name entry is actually detected.
      // Use the freshly returned listing: `tree` in this render closure stays
      // stale for directories loaded here.
      const targetEntries = tree[targetDir] ?? (await loadDir(targetDir));
      if (targetEntries.some((e) => e.name === basename(src.path))) {
        notify('error', t('workbench.explorer.name_conflict', { name: basename(src.path) }));
        return;
      }
      try {
        await adapter.renameEntry(repoPath, src.path, target);
        await syncDataTrack(src.path, target);
        await refreshDirs([targetDir, dirname(src.path)]);
        notify('success', t('workbench.explorer.moved_hint'));
      } catch {
        notify('error', t('workbench.explorer.move_failed'));
      }
    }
  };

  /** Import files dragged in from the OS into `targetDir`. Name conflicts are
   *  auto-suffixed ("name (1).ext") instead of overwriting workspace files.
   *  Only flat file lists are supported (folder drags from the OS expose no
   *  portable tree without the async entry API — those fall back to flat). */
  const importExternalFiles = async (files: File[], targetDir: string) => {
    if (!project) return;
    const adapter = getVfs();
    const repoPath = getProjectRepoPath(project);
    let ok = 0;
    for (const file of files) {
      try {
        if (!isValidVfsEntryName(file.name)) continue;
        const existing = new Set(
          (tree[targetDir] ?? (await loadDir(targetDir))).map((e) => e.name),
        );
        const dot = file.name.lastIndexOf('.');
        const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
        const ext = dot > 0 ? file.name.slice(dot) : '';
        let name = file.name;
        for (let i = 1; existing.has(name); i += 1) name = `${stem} (${i})${ext}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await adapter.writeFileBinary(repoPath, joinPath(targetDir, name), bytes);
        existing.add(name);
        ok += 1;
      } catch {
        /* counted as failed below */
      }
    }
    await refreshDirs([targetDir]);
    useAppStore.getState().bumpFileOps();
    if (files.length === 0) return;
    if (ok === files.length) notify('success', t('workbench.explorer.imported', { n: ok }));
    else notify('warning', t('workbench.explorer.import_partial', { ok, total: files.length }));
  };

  // ---- keyboard shortcuts (F2 / Delete / Copy/Cut/Paste / Ctrl+N / Enter) ---

  const pasteTargetDir = (): string => {
    if (!selected || selected.isDir) return selected?.path ?? rootDir;
    return dirname(selected.path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F2') {
      if (selected) {
        e.preventDefault();
        beginRename(selected);
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected && !e.shiftKey) {
        e.preventDefault();
        requestDelete(selected);
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'c' && selected) {
      e.preventDefault();
      setClip(selected, 'copy');
      return;
    }
    if (mod && e.key.toLowerCase() === 'x' && selected) {
      e.preventDefault();
      setClip(selected, 'cut');
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      void paste(pasteTargetDir());
      return;
    }
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      beginCreate(pasteTargetDir(), 'file');
      return;
    }
    if (e.key === 'Enter' && selected && !selected.isDir) {
      e.preventDefault();
      void openPreview(selected);
    }
  };

  const openMenu = (e: React.MouseEvent, entry: VfsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(entry);
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    setMenu({ x, y, path: entry.path, isDir: entry.isDir });
  };

  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // ---- inline input elements ----------------------------------------------

  const renderEntries = (
    entries: VfsEntry[],
    depth: number,
    dir: string,
  ): ReactNode => {
    const isRoot = dir === rootDir;
    return (
      <ul
        className={`explorer-list${isRoot && dropTarget === rootDir ? ' drop-target' : ''}`}
        role={depth === 0 ? 'tree' : 'group'}
        onDragOver={
          isRoot
            ? (e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setDropTarget(rootDir);
                } else if (canDropInto(dragRef.current, rootDir)) {
                  e.preventDefault();
                  setDropTarget(rootDir);
                }
              }
            : undefined
        }
        onDragLeave={isRoot ? () => setDropTarget((d) => (d === rootDir ? null : d)) : undefined}
        onDrop={
          isRoot
            ? (e) => {
                void onDropTarget(rootDir)(e);
              }
            : undefined
        }
      >
        {entries.map((e) => {
          const rowPath = e.path;
          if (renaming?.path === rowPath) {
            return (
              <InlineInput
                key={rowPath}
                initial={e.name}
                placeholder={e.name}
                onCommit={(v) => void commitRename(e, v)}
                onCancel={() => setRenaming(null)}
                depth={depth}
              />
            );
          }
          if (e.isDir) {
            const isOpen = expanded.has(e.path);
            const guide = guideFor(e.path);
            const isDrop = dropTarget === e.path;
            return (
              <li key={e.path}>
                <div
                  className={`explorer-row explorer-dir${selected?.path === e.path ? ' selected' : ''}${
                    isDrop ? ' drop-target' : ''
                  }`}
                  style={{ paddingLeft: 6 + depth * 14 }}
                  aria-expanded={isOpen}
                  title={guide ? `${e.path} — ${guide}` : e.path}
                  draggable
                  onClick={() => {
                    setSelected(e);
                    toggleDir(e.path);
                  }}
                  onContextMenu={(ev) => openMenu(ev, e)}
                  onDragStart={(ev) => {
                    ev.stopPropagation();
                    dragRef.current = e;
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', e.path);
                  }}
                  onDragOver={(ev) => {
                    if (ev.dataTransfer.types.includes('Files')) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDropTarget(e.path);
                    } else if (canDropInto(dragRef.current, e.path)) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDropTarget(e.path);
                    }
                  }}
                  onDragLeave={() => setDropTarget((d) => (d === e.path ? null : d))}
                  onDrop={(ev) => {
                    void onDropTarget(e.path)(ev);
                  }}
                >
                  {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  <span className="explorer-name">{e.name}</span>
                </div>
                {isOpen &&
                  (renderEntries(tree[e.path] ?? [], depth + 1, e.path) as ReactNode)}
              </li>
            );
          }
          const active = activeTab === fileTabKey(e.path);
          const isPlaceholder = PLACEHOLDER_NAMES.has(e.name);
          if (isPlaceholder) return null;
          return (
            <li key={e.path}>
              <div
                className={`explorer-row explorer-file${active ? ' active' : ''}${
                  selected?.path === e.path ? ' selected' : ''
                }`}
                style={{ paddingLeft: 6 + depth * 14 }}
                title={e.path}
                draggable
                onClick={() => {
                  setSelected(e);
                  void openPreview(e);
                }}
                onContextMenu={(ev) => openMenu(ev, e)}
                onDragStart={(ev) => {
                  ev.stopPropagation();
                  dragRef.current = e;
                  ev.dataTransfer.effectAllowed = 'move';
                  ev.dataTransfer.setData('text/plain', e.path);
                }}
                onDragOver={(ev) => {
                  // Files land in the row's parent directory.
                  if (ev.dataTransfer.types.includes('Files')) ev.preventDefault();
                }}
                onDrop={(ev) => {
                  void onDropTarget(dir)(ev);
                }}
              >
                <span className="explorer-name">{e.name}</span>
              </div>
            </li>
          );
        })}
        {inlineCreate && inlineCreate.parentDir === dir && (
          <InlineInput
            key="__create"
            initial=""
            placeholder={t(
              inlineCreate.type === 'dir'
                ? 'workbench.explorer.folder_placeholder'
                : 'workbench.explorer.name_placeholder',
            )}
            onCommit={(v) => void commitCreate(inlineCreate.type, dir, v)}
            onCancel={() => setInlineCreate(null)}
            depth={depth}
          />
        )}
      </ul>
    );
  };

  const target = menu ? entryAt(dirname(menu.path), basename(menu.path)) : null;

  return (
    <div
      className="file-explorer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragEnd={() => {
        dragRef.current = null;
        setDropTarget(null);
      }}
      // 点击树区域以外的空白（容器、提示文字、区块边缘）→ 取消当前选中；
      // 行/按钮/右键菜单/内联输入框内的按下不受影响。
      onMouseDown={(e) => {
        const el = e.target as HTMLElement;
        if (
          !el.closest('.explorer-row') &&
          !el.closest('.explorer-context-menu') &&
          !el.closest('.explorer-inline') &&
          !el.closest('button')
        ) {
          setSelected(null);
        }
      }}
    >
      {!project && <EmptyState title={t('workbench.explorer.no_project')} />}

      {project && (
        <section className="explorer-section">
          <header className="explorer-section-header">
            <h4 className="explorer-heading" title={getProjectRepoPath(project)}>
              {t('workbench.explorer.workspace')}
            </h4>
            <div className="explorer-actions">
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.explorer.new_file')}
                aria-label={t('workbench.explorer.new_file')}
                onClick={() => beginCreate(pasteTargetDir(), 'file')}
              >
                <FilePlusIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.explorer.new_folder')}
                aria-label={t('workbench.explorer.new_folder')}
                onClick={() => beginCreate(pasteTargetDir(), 'dir')}
              >
                <FolderPlusIcon size={14} />
              </button>
              <button
                type="button"
                className={`icon-btn${clipboard ? ' has-clipboard' : ''}`}
                title={t('workbench.explorer.paste')}
                aria-label={t('workbench.explorer.paste')}
                onClick={() => void paste(pasteTargetDir())}
              >
                <ClipboardIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.explorer.export_supplement')}
                aria-label={t('workbench.explorer.export_supplement')}
                onClick={() => setEmbeddedTool('supplement')}
              >
                <DownloadIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('explorer.refresh')}
                aria-label={t('explorer.refresh')}
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshIcon size={14} />
              </button>
            </div>
          </header>
          {clipboard && (
            <p className="explorer-clip-hint">
              {t('workbench.explorer.clip_hint')}:{' '}
              {clipboard.items.map((i) => i.name).join(', ')}
            </p>
          )}
          {loading && <p className="explorer-hint">{t('workbench.explorer.loading')}</p>}
          {renderEntries(tree[rootDir] ?? [], 0, rootDir)}

          {menu && target && (
            <div
              className="explorer-context-menu"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {(
                [
                  {
                    key: 'open',
                    label: t('workbench.explorer.context.open'),
                    disabled: target.isDir,
                    onClick: () => void openPreview(target),
                  },
                  { key: 'rename', label: t('workbench.explorer.context.rename'), onClick: () => beginRename(target) },
                  { key: 'copy', label: t('workbench.explorer.context.copy'), onClick: () => setClip(target, 'copy') },
                  { key: 'cut', label: t('workbench.explorer.context.cut'), onClick: () => setClip(target, 'cut') },
                  target.isDir
                    ? { key: 'paste', label: t('workbench.explorer.context.paste'), onClick: () => void paste(target.path) }
                    : null,
                  { key: 'sep1', separator: true },
                  target.isDir
                    ? { key: 'newfile', label: t('workbench.explorer.context.new_file'), onClick: () => beginCreate(target.path, 'file') }
                    : null,
                  target.isDir
                    ? { key: 'newfolder', label: t('workbench.explorer.context.new_folder'), onClick: () => beginCreate(target.path, 'dir') }
                    : null,
                  { key: 'sep2', separator: true },
                  { key: 'delete', label: t('workbench.explorer.context.delete'), onClick: () => requestDelete(target) },
                ] as Array<
                  | { key: string; separator: true }
                  | { key: string; label: string; disabled?: boolean; onClick: () => void }
                  | null
                >
              ).map((item) => {
                if (!item) return null;
                if ('separator' in item) return <div key={item.key} className="explorer-context-sep" />;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="explorer-context-item"
                    disabled={item.disabled}
                    onClick={item.onClick}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('workbench.explorer.delete_title')}
        message={t('workbench.explorer.delete_confirm')}
        name={deleteTarget?.name}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteTarget) void doDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}