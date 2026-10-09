// ==========================================================================
// Ergalics Studio — sidebar file explorer (Standard mode, activity bar)
//
// 与科研套件的 FileExplorerPage 同源：浏览项目 Git 仓库（虚拟工作区，
// getGitAdapter + getProjectRepoPath）的真实工作树，标准骨架为
// project.clproj + runs/ + figures/ + data/ + code/ + manuscript/ +
// .ergalics/ + .git/ + .gitignore/.gitattributes（§3.1）。
//
// 常规文件管理：新建文件/文件夹、重命名、删除、复制/剪切/粘贴、
// 拖拽移动，以及 F2/Delete/Ctrl+C/X/V 等快捷键（A 需求）。全部写操作
// 直接作用于工作树，不触发 git add/commit（用户明确暂不关注 git）。
// 点击文件 → 中央画布区按类型预览（appStore.filePreview，B 需求）。
// ==========================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { useAppStore, fileTabKey, type FilePreviewKind } from '@/stores/appStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getGitAdapter } from '@/core/git';
import type { RepoEntry } from '@/core/git';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshIcon,
  FilePlusIcon,
  FolderPlusIcon,
  ClipboardIcon,
} from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/** Raw content is capped so a multi-MB snapshot never freezes the UI. */
const PREVIEW_CAP_CHARS = 200_000;

/** Extensions previewed as UTF-8 text; everything else is treated as binary. */
const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'csv', 'tsv', 'yml', 'yaml', 'toml', 'svg',
  'clproj', 'lock', 'log', 'ini', 'sh', 'js', 'py', 'r',
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
  items: RepoEntry[];
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
          if (e.key === 'Enter') onCommit(value);
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
  const activeTab = useAppStore((s) => s.activeTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const renameFileTab = useAppStore((s) => s.renameFileTab);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);

  /** Per-directory listings, keyed by repo-relative dir ('' = root). */
  const [tree, setTree] = useState<Record<string, RepoEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hasRepo, setHasRepo] = useState(true);
  const [loading, setLoading] = useState(false);

  /** Currently selected row (single-click select; Enter/double-click opens). */
  const [selected, setSelected] = useState<RepoEntry | null>(null);
  /** Explorer-local clipboard (copy/cut). */
  const [clipboard, setClipboard] = useState<ClipState | null>(null);
  /** Right-click context menu. */
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** Inline create-input row: shown under this dir ('' = root). */
  const [inlineCreate, setInlineCreate] = useState<{ parentDir: string; type: 'file' | 'dir' } | null>(null);
  /** Row replaced by an inline rename input. */
  const [renaming, setRenaming] = useState<RepoEntry | null>(null);
  /** Directory currently highlighted as a drop target. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Entry awaiting delete confirmation (directories only). */
  const [deleteTarget, setDeleteTarget] = useState<RepoEntry | null>(null);

  /** Repo root url ('' = root). */
  const rootDir = '';
  /** Drag source, tracked via ref so it survives the drop event. */
  const dragRef = useRef<RepoEntry | null>(null);

  const loadDir = useCallback(
    async (dir: string) => {
      if (!project) return;
      try {
        const adapter = getGitAdapter();
        const entries = await adapter.readDir(getProjectRepoPath(project), dir);
        setTree((prev) => ({ ...prev, [dir]: entries }));
      } catch {
        setTree((prev) => ({ ...prev, [dir]: [] }));
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

  // Fresh project → clean slate + root listing + repo probe.
  useEffect(() => {
    setTree({});
    setExpanded(new Set());
    setSelected(null);
    setClipboard(null);
    if (!project) return;
    let cancelled = false;
    void (async () => {
      try {
        const adapter = getGitAdapter();
        const repoOk = await adapter.isRepo(getProjectRepoPath(project));
        if (cancelled) return;
        setHasRepo(repoOk);
        if (repoOk) await loadDir('');
      } catch {
        if (!cancelled) setHasRepo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // External working-tree changes (e.g. an MD preview save) refresh listings.
  useEffect(() => {
    if (!project) return;
    void refreshDirs(['', ...expanded]);
  }, [fileOpsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        if (!(dir in tree)) void loadDir(dir);
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

  const openPreview = async (entry: RepoEntry) => {
    if (!project || entry.isDir) return;
    try {
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      const { kind, mime } = classifyFile(entry.name);
      if (kind === 'text' || kind === 'markdown') {
        const raw = await adapter.readFile(repoPath, entry.path);
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
        const bytes = await adapter.readFileBinary(repoPath, entry.path);
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

  const entryAt = (dir: string, name: string): RepoEntry | undefined =>
    (tree[dir] ?? []).find((e) => e.name === name);

  const existsName = (dir: string, name: string): boolean => !!entryAt(dir, name);

  /** Pick an unused name in `dir` for a copy/paste target. */
  const suggestUniqueName = (dir: string, name: string): string => {
    if (!existsName(dir, name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i += 1) {
      const cand = `${stem} (${i})${ext}`;
      if (!existsName(dir, cand)) return cand;
    }
  };

  const copyItem = useCallback(
    async (adapter: ReturnType<typeof getGitAdapter>, repoPath: string, from: string, to: string, isDir: boolean) => {
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
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    try {
      let failed = false;
      for (const item of clipboard.items) {
        if (clipboard.mode === 'cut') {
          const target = joinPath(targetDir, basename(item.path));
          if (isSameOrUnder(item.path, targetDir)) {
            notify('error', t('workbench.explorer.move_failed'));
            failed = true;
            continue;
          }
          if (existsName(targetDir, basename(item.path))) {
            notify('error', t('workbench.explorer.name_conflict', { name: basename(item.path) }));
            failed = true;
            continue;
          }
          await adapter.renameEntry(repoPath, item.path, target);
        } else {
          const target = joinPath(targetDir, suggestUniqueName(targetDir, basename(item.path)));
          await copyItem(adapter, repoPath, item.path, target, item.isDir);
        }
      }
      if (clipboard.mode === 'cut') setClipboard(null);
      void refreshDirs([targetDir, ...clipboard.items.map((i) => dirname(i.path))]);
      if (!failed) notify('success', t('workbench.explorer.pasted_hint'));
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  const setClip = (entry: RepoEntry, mode: 'copy' | 'cut') => {
    if (entry.isDir) void loadDir(entry.path); // ensure sub-list exists for conflict checks
    setClipboard({ mode, items: [entry] });
    notify('info', t(mode === 'copy' ? 'workbench.explorer.copied_hint' : 'workbench.explorer.cut_hint'));
    setMenu(null);
    setSelected(entry);
  };

  const requestDelete = (entry: RepoEntry) => {
    setMenu(null);
    if (entry.isDir) {
      setDeleteTarget(entry);
    } else {
      void doDelete(entry);
    }
  };

  const doDelete = async (entry: RepoEntry) => {
    if (!project) return;
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    try {
      await adapter.deleteEntry(repoPath, entry.path, entry.isDir);
      closeTab(fileTabKey(entry.path));
      if (selected?.path === entry.path) setSelected(null);
      await refreshDirs([dirname(entry.path)]);
      notify('success', t('workbench.explorer.deleted_hint'));
    } catch {
      notify('error', t('workbench.explorer.op_failed'));
    }
  };

  const beginRename = (entry: RepoEntry) => {
    setMenu(null);
    setSelected(entry);
    setRenaming(entry);
    setInlineCreate(null);
  };

  const commitRename = async (entry: RepoEntry, rawName: string) => {
    const name = rawName.trim();
    setRenaming(null);
    if (!project || !name || name === entry.name) return;
    const parent = dirname(entry.path);
    const target = joinPath(parent, name);
    if (existsName(parent, name)) {
      notify('error', t('workbench.explorer.name_conflict', { name }));
      return;
    }
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    try {
      await adapter.renameEntry(repoPath, entry.path, target);
      renameFileTab(entry.path, name, target);
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
    if (existsName(parentDir, name)) {
      notify('error', t('workbench.explorer.name_conflict', { name }));
      return;
    }
    const path = joinPath(parentDir, name);
    const adapter = getGitAdapter();
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

  const canDropInto = (src: RepoEntry | null, targetDir: string) =>
    !!src && !isSameOrUnder(src.path, targetDir);

  const onDropTarget = (targetDir: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const src = dragRef.current;
    if (!project || !canDropInto(src, targetDir)) return;
    if (src) {
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      const target = joinPath(targetDir, basename(src.path));
      if (existsName(targetDir, basename(src.path))) {
        notify('error', t('workbench.explorer.name_conflict', { name: basename(src.path) }));
        return;
      }
      try {
        await adapter.renameEntry(repoPath, src.path, target);
        await refreshDirs([targetDir, dirname(src.path)]);
        notify('success', t('workbench.explorer.moved_hint'));
      } catch {
        notify('error', t('workbench.explorer.move_failed'));
      }
    }
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

  const openMenu = (e: React.MouseEvent, entry: RepoEntry) => {
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
    entries: RepoEntry[],
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
                if (canDropInto(dragRef.current, rootDir)) {
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
                    if (canDropInto(dragRef.current, e.path)) {
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

      {project && !hasRepo && <EmptyState title={t('explorer.no_repo')} />}

      {project && hasRepo && (
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