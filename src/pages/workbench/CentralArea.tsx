import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lazyRetry } from '@/core/lazyRetry';
import { useT, useLocale } from '@/i18n';
import { usePluginStore, setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { useAppStore, type FilePreviewState } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { flushEditorFile } from '@/stores/editorFlush';
import { useModeConvert } from '@/stores/useModeConvert';
import { CloseIcon, ToolIcon, SettingsIcon } from '@/components/icons';
import { syncSurfaceTabSession } from '@/components/editor/fileEditors/openInMode';
// Settings embedded in a canvas tab — lazy chunk, same rationale as scene3d.
const LazySettingsPage = lazyRetry(() => import('@/pages/settings/SettingsPage'));
// File editor tabs (design doc P2-P4): Monaco code / Blockly block / flow DAG.
// Each lazy so the editors (and their heavy runtimes) load on first use.
const LazyCodeFileEditor = lazyRetry(() =>
  import('@/components/editor/fileEditors/CodeFileEditor').then((m) => ({ default: m.CodeFileEditor })),
);
const LazyBlockFileEditor = lazyRetry(() =>
  import('@/components/editor/fileEditors/BlockFileEditor').then((m) => ({ default: m.BlockFileEditor })),
);
const LazyFlowFileEditor = lazyRetry(() =>
  import('@/components/editor/fileEditors/FlowFileEditor').then((m) => ({ default: m.FlowFileEditor })),
);
// The three editing surfaces are canvas tabs too (never full-page swaps):
// flow DAG, Blockly workspace and the Monaco/Pyodide code editor.
const LazyFlowSurface = lazyRetry(() =>
  import('@/components/blocks/BlockWorkbench').then((m) => ({ default: m.BlockWorkbench })),
);
const LazyBlockSurface = lazyRetry(() =>
  import('@/components/editor/BlockEditor').then((m) => ({ default: m.BlockEditor })),
);
const LazyCodeSurface = lazyRetry(() =>
  import('@/components/editor/CodeEditor').then((m) => ({ default: m.CodeEditor })),
);
import { Modal } from '@/components/Modal';
import { ToolShell } from '@/components/ToolShell';
import { EmptyProject } from '@/components/EmptyState';
import { getTool } from '@/pages/research/toolRegistry';
import { logger } from '@/core/logger';
import { mdToHtml } from '@/core/notebook/notebook';
import { enhanceMarkdownDom } from '@/core/markdown/enhance';
import { downloadBlob } from '@/core/download';
import { getVfs } from '@/core/vfs';
import { dataUrlToBlob } from '@/core/plugin-tools/enhance';
import { saveBinaryArtifact } from '@/core/workspace-artifacts';
import { DownloadIcon, MaximizeIcon, MinimizeIcon } from '@/components/icons';
// B1: three (~400KB) must stay out of the first-screen bundle. The scene3d
// module is dynamically imported on first 3-D demand; the created handle is
// still cached in `scene3dRef` and exposed synchronously via `getThree`, while
// `ensureThree` lets the plugin-activation path await the handle's existence.
let scene3dModule: Promise<typeof import('@/core/scene3d')> | null = null;
const loadScene3dModule = () => (scene3dModule ??= import('@/core/scene3d'));
import {
  getViewport2d,
  setViewport2d,
  resetViewport2d,
  wrapCanvas2d,
  clearCanvas2dInViewport,
  type Viewport2D,
} from '@/core/viewport2d';
import type { Scene3DHandle } from '@/types/plugin';
import { FileRouterDialog } from '../plugin-dialog/FileRouterDialog';
import { PluginDialog } from '../plugin-dialog/PluginDialog';
import { DataDialog } from './DataDialog';
import { RightPanel } from './RightPanel';
import { ScienceOutputStrip } from '@/components/ScienceOutputStrip';
import { useFileRouting } from './useFileRouting';
import { WorkbenchModeCards, ModeIcon } from '@/components/WorkbenchModes';

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

/** True when a markdown image src must not be touched (external / inline). */
function isExternalImgSrc(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:)/i.test(src) || src.startsWith('#');
}

function imgExt(path: string): string {
  const m = /\.(\w+)$/.exec(path);
  return m ? (m[1]?.toLowerCase() ?? '') : '';
}

/** Join a base dir with a relative segment path, resolving `.` / `..`. */
function joinRelPath(base: string, rel: string): string {
  const parts = base ? base.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Candidate project paths for a markdown image src: resolved against the md
 * file's directory first, then the project root (the common case — artifacts
 * saved into `figures/` at the repo root are referenced root-relatively).
 */
function mdImageCandidates(src: string, mdPath: string): string[] {
  const raw = src.trim();
  if (!raw || isExternalImgSrc(raw)) return [];
  const dir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/')) : '';
  const rel = raw.startsWith('/') ? raw.slice(1) : raw.replace(/^\.\//, '');
  const candidates: string[] = [];
  const fromDir = raw.startsWith('/') ? '' : joinRelPath(dir, rel);
  if (fromDir && fromDir !== rel) candidates.push(fromDir);
  if (rel) candidates.push(rel);
  // Browsers percent-encode hrefs; also try the decoded form for non-ASCII names.
  try {
    const decoded = decodeURIComponent(rel);
    if (decoded !== rel && !candidates.includes(decoded)) candidates.push(decoded);
  } catch {
    /* malformed percent-encoding — literal form already covered */
  }
  return candidates;
}

const MD_VIEWS = ['edit', 'preview', 'split'] as const;
type MdView = (typeof MD_VIEWS)[number];

/** Bounded recursive walk of the workspace tree collecting image files for
 *  the markdown "insert image" picker (workspace-sourced only — no local
 *  file dialog). Depth/amount caps keep pathological trees responsive. */
async function listWorkspaceImages(rootPath: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || out.length >= 500) return;
    const entries = await getVfs().readDir(rootPath, dir); // missing dir → []
    for (const entry of entries) {
      if (entry.isDir) await walk(entry.path, depth + 1);
      else if (IMG_MIME[imgExt(entry.name)]) out.push({ path: entry.path, size: entry.size });
    }
  };
  await walk('', 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * File preview overlay (VS Code editor-area style). Renders by kind:
 * text → monospace `<pre>`; markdown → editable preview/split with save-back
 * to the working tree; image/pdf/video/audio → binary blob URL embed;
 * unknown → info placeholder + download. The canvas stays mounted underneath.
 */

/** Binary content placeholder shown between "tab opened" and "bytes ready". */
function PreviewLoading() {
  return (
    <div className="central-file-loading" role="status">
      <span className="central-file-loading-spinner" aria-hidden="true" />
      <p>{useT()('workbench.preview.loading')}</p>
    </div>
  );
}

/**
 * unknown → info placeholder + download. The canvas stays mounted underneath.
 */
function PreviewOverlay({ preview }: { preview: FilePreviewState }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const bumpFileOps = useAppStore((s) => s.bumpFileOps);

  const [view, setView] = useState<MdView>('preview');
  const [mdText, setMdText] = useState(preview.content ?? '');
  // Markdown preview host — upgraded in place after each render (mermaid
  // diagrams, KaTeX math) via the async enhancer.
  const mdPreviewRef = useRef<HTMLDivElement>(null);
  const mdEditRef = useRef<HTMLTextAreaElement>(null);
  // Blob URLs created for project-relative markdown images (resolved VFS path
  // → URL). Cached so React re-renders don't re-read bytes; revoked on unmount.
  const mdImgUrlsRef = useRef(new Map<string, string>());

  // "Insert image" picker: online URL or a clickable workspace-file table —
  // deliberately no OS file dialog (workspace discipline + portable md).
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [wsImages, setWsImages] = useState<{ path: string; size: number }[] | null>(null);

  // Plugins whose declared formats accept this file's extension. The preview
  // footer offers "open with <plugin>" so a recognized file (e.g. a .cif unit
  // cell) can be handed straight to its plugin from the preview overlay.
  const { locale } = useLocale();
  const registry = usePluginStore((s) => s.registry);
  const { loadIntoPlugin } = useFileRouting();
  const pluginMatches = useMemo(() => {
    const dot = preview.name.lastIndexOf('.');
    if (dot <= 0) return [];
    const ext = preview.name.slice(dot).toLowerCase();
    return registry.filter((e) => e.formats.some((f) => f.extension.toLowerCase() === ext));
  }, [preview.name, registry]);

  /** Read the previewed file from the workspace and route it into the chosen
   *  plugin via the same ingestion pipeline the drop handler uses. */
  const openWithPlugin = async (pluginId: string) => {
    if (!project) return;
    const rootPath = getProjectRepoPath(project);
    try {
      const blob = preview.blobUrl
        ? await (await fetch(preview.blobUrl)).blob()
        : new Blob([(await getVfs().readFileBinary(rootPath, preview.path)) as BlobPart], {
            type: preview.mimeType,
          });
      await loadIntoPlugin(pluginId, new File([blob], preview.name, { type: preview.mimeType }));
      // Hand the view back to the plugin, but KEEP the file tab open — closing
      // it here used to yank the tab away mid-interaction, which felt like the
      // file was lost. showPluginCanvas switches back to the canvas while the
      // preview tab stays in the strip (user closes it explicitly if wanted).
      useAppStore.getState().showPluginCanvas();
    } catch (err) {
      logger.warn('workbench', 'open-with-plugin read failed', err);
      notify('error', t('workbench.preview.open_failed'));
    }
  };

  // Re-arm the draft + view whenever a different file is opened.
  useEffect(() => {
    setMdText(preview.content ?? '');
    setView('preview');
  }, [preview.path, preview.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enhance the rendered markdown (mermaid → SVG, TeX → KaTeX) whenever the
  // preview text or the visible pane changes.
  useEffect(() => {
    if (view !== 'preview' && view !== 'split') return;
    const el = mdPreviewRef.current;
    if (el) void enhanceMarkdownDom(el);
  }, [mdText, view]);

  // Resolve project-relative markdown images to blob URLs read from the VFS:
  // `<img src="figures/x.png">` would otherwise hit the app origin and 404.
  // Runs after the enhancer effect, so DOMPurify-stripped-free relative srcs
  // are rewritten in place; the cache keeps keystroke re-renders cheap.
  useEffect(() => {
    if ((view !== 'preview' && view !== 'split') || !project) return;
    const host = mdPreviewRef.current;
    if (!host) return;
    const rootPath = getProjectRepoPath(project);
    const cache = mdImgUrlsRef.current;
    let cancelled = false;
    const apply = async () => {
      const imgs = Array.from(host.querySelectorAll('img[src]'));
      for (const img of imgs) {
        const raw = img.getAttribute('src') ?? '';
        const candidates = mdImageCandidates(raw, preview.path);
        if (!candidates.length) continue;
        let url = '';
        for (const path of candidates) {
          const hit = cache.get(path);
          if (hit) {
            url = hit;
            break;
          }
          try {
            const bytes = await getVfs().readFileBinary(rootPath, path);
            if (cancelled) return;
            const blob = new Blob([bytes as BlobPart], {
              type: IMG_MIME[imgExt(path)] ?? 'application/octet-stream',
            });
            url = URL.createObjectURL(blob);
            cache.set(path, url);
            break;
          } catch {
            /* try the next candidate path */
          }
        }
        if (!cancelled && url && img.getAttribute('src') !== url) img.setAttribute('src', url);
      }
    };
    void apply();
    return () => {
      cancelled = true;
    };
  }, [mdText, view, project, preview.path]);

  // Revoke the markdown image blob URLs when the overlay unmounts.
  useEffect(() => {
    const cache = mdImgUrlsRef.current;
    return () => {
      for (const url of cache.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already revoked */
        }
      }
      cache.clear();
    };
  }, []);

  // Revoke the binary blob URL when the overlay unmounts (the store also
  // revokes on close, so this guards the mode-switch / new-file path).
  useEffect(() => {
    return () => {
      if (preview.blobUrl) {
        try {
          URL.revokeObjectURL(preview.blobUrl);
        } catch {
          /* already revoked */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMarkdown = async () => {
    if (!project) return;
    const vfs = getVfs();
    const rootPath = getProjectRepoPath(project);
    try {
      await vfs.writeFile(rootPath, preview.path, mdText);
      notify('success', t('workbench.preview.saved'));
      bumpFileOps(); // let the explorer refresh its listings
    } catch {
      notify('error', t('workbench.preview.save_failed'));
    }
  };

  const downloadFile = async () => {
    if (!project) return;
    const vfs = getVfs();
    const rootPath = getProjectRepoPath(project);
    try {
      const blob = preview.blobUrl
        ? await (await fetch(preview.blobUrl)).blob()
        : new Blob([(await vfs.readFileBinary(rootPath, preview.path)) as BlobPart], {
            type: preview.mimeType,
          });
      downloadBlob(preview.name, blob, preview.mimeType);
    } catch {
      notify('error', t('workbench.preview.download_failed'));
    }
  };

  /** Insert an image reference into the md draft at the cursor. `ref` is a
   *  workspace-relative path (picked from the workspace table) or an external
   *  http(s) URL typed by the user. Switches to split view first so the
   *  result is visible. */
  const insertImageRef = (ref: string) => {
    if (view === 'preview') setView('split');
    const snippet = `![](${ref})`;
    const ta = mdEditRef.current;
    const start = ta && view !== 'preview' ? (ta.selectionStart ?? mdText.length) : mdText.length;
    const end = ta && view !== 'preview' ? (ta.selectionEnd ?? start) : start;
    const next = mdText.slice(0, start) + snippet + mdText.slice(end);
    setMdText(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // Load the workspace image table each time the picker opens.
  useEffect(() => {
    if (!imgPickerOpen || !project) return undefined;
    let alive = false;
    void listWorkspaceImages(getProjectRepoPath(project)).then((list) => {
      if (!alive) setWsImages(list);
    });
    return () => {
      alive = true;
    };
  }, [imgPickerOpen, project]);

  const insertOnlineImage = () => {
    const url = imgUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      notify('warning', t('workbench.preview.image_url_invalid'));
      return;
    }
    insertImageRef(url);
    setImgUrl('');
    setImgPickerOpen(false);
  };

  let body: JSX.Element;
  switch (preview.kind) {
    case 'text':
      body = (
        <>
          <pre className="central-file-preview-content">{preview.content}</pre>
          {(preview.content?.length ?? 0) >= 200_000 && (
            <p className="central-file-preview-note">{t('workbench.preview.truncated')}</p>
          )}
        </>
      );
      break;
    case 'markdown':
      body = (
        <div className="central-md">
          <div className="central-md-toolbar">
            <div className="central-md-modes" role="group" aria-label={t('workbench.preview.mode_label')}>
              {MD_VIEWS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`explorer-pill${view === m ? ' active' : ''}`}
                  onClick={() => setView(m)}
                >
                  {t(`workbench.preview.mode_${m}`)}
                </button>
              ))}
            </div>
            <div className="central-md-actions">
              <button type="button" className="btn btn-sm" onClick={() => setImgPickerOpen(true)}>
                {t('workbench.preview.insert_image')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void saveMarkdown()}>
                {t('workbench.preview.save')}
              </button>
            </div>
          </div>
          <Modal
            open={imgPickerOpen}
            title={t('workbench.preview.insert_image')}
            onClose={() => setImgPickerOpen(false)}
            width={520}
          >
            <div className="md-img-picker">
              <div className="md-img-url">
                <input
                  type="url"
                  value={imgUrl}
                  placeholder={t('workbench.preview.image_url_placeholder')}
                  onChange={(e) => setImgUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') insertOnlineImage();
                  }}
                />
                <button type="button" className="btn btn-sm" onClick={insertOnlineImage}>
                  {t('workbench.preview.image_insert')}
                </button>
              </div>
              <div className="md-img-workspace">{t('workbench.preview.image_workspace')}</div>
              {wsImages === null ? (
                <p className="md-img-empty">{t('workbench.preview.loading')}</p>
              ) : wsImages.length === 0 ? (
                <p className="md-img-empty">{t('workbench.preview.image_workspace_empty')}</p>
              ) : (
                <div className="md-img-list" role="listbox" aria-label={t('workbench.preview.image_workspace')}>
                  {wsImages.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="md-img-row"
                      title={t('workbench.preview.image_pick')}
                      onClick={() => {
                        insertImageRef(f.path);
                        setImgPickerOpen(false);
                      }}
                    >
                      <span className="md-img-path">{f.path}</span>
                      <span className="md-img-size">{fmtSize(f.size)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Modal>
          <div className={`central-md-body mode-${view}`}>
            {(view === 'edit' || view === 'split') && (
              <textarea
                ref={mdEditRef}
                className="central-md-edit"
                value={mdText}
                spellCheck={false}
                onChange={(e) => setMdText(e.target.value)}
                onKeyDown={(e) => {
                  // Editor-standard save shortcut: Ctrl/Cmd+S writes the
                  // draft back to the working tree without leaving the keys.
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    void saveMarkdown();
                  }
                }}
              />
            )}
            {(view === 'preview' || view === 'split') && (
              <div
                ref={mdPreviewRef}
                className="central-md-preview"
                dangerouslySetInnerHTML={{ __html: mdToHtml(mdText) }}
              />
            )}
          </div>
        </div>
      );
      break;
    case 'image':
      body = (
        <div className="central-file-media">
          {preview.blobUrl ? (
            <img src={preview.blobUrl} alt={preview.name} />
          ) : (
            <PreviewLoading />
          )}
        </div>
      );
      break;
    case 'pdf':
      body = (
        <div className="central-file-media">
          {preview.blobUrl ? (
            // object 带内建回退：环境阻止内嵌 PDF 查看器时显示下载提示。
            <object data={preview.blobUrl} type="application/pdf" title={preview.name}>
              <div className="central-file-unknown">
                <p className="central-file-unknown-title">{t('workbench.preview.pdf_blocked')}</p>
                <button type="button" className="btn" onClick={() => void downloadFile()}>
                  {t('workbench.preview.download')}
                </button>
              </div>
            </object>
          ) : (
            <PreviewLoading />
          )}
        </div>
      );
      break;
    case 'video':
      body = (
        <div className="central-file-media">
          {preview.blobUrl ? <video src={preview.blobUrl} controls /> : <PreviewLoading />}
        </div>
      );
      break;
    case 'audio':
      body = (
        <div className="central-file-media">
          {preview.blobUrl ? <audio src={preview.blobUrl} controls /> : <PreviewLoading />}
        </div>
      );
      break;
    default:
      body = (
        <div className="central-file-unknown">
          <div className="central-file-unknown-icon">?</div>
          <p className="central-file-unknown-title">{t('workbench.preview.unsupported')}</p>
          <p className="central-file-unknown-desc">
            {preview.mimeType}
            {preview.size > 0 ? ` · ${fmtSize(preview.size)}` : ''}
          </p>
          <button type="button" className="btn" onClick={() => void downloadFile()}>
            {t('workbench.preview.download')}
          </button>
        </div>
      );
  }

  // 画布标签条已提供文件名、只读标识与关闭按钮，这里只渲染预览本体，
  // 避免标签行下方再出现一条重复的头部标签（与内嵌套件同一约定）。
  return (
    <div className="central-file-preview">
      {body}
      {pluginMatches.length > 0 && (
        <div className="central-file-openwith">
          <span className="central-file-openwith-label">{t('workbench.preview.open_with')}</span>
          {pluginMatches.map((e) => (
            <button
              key={e.id}
              type="button"
              className="btn btn-sm"
              onClick={() => void openWithPlugin(e.id)}
            >
              {e.nameI18n?.[locale] ?? e.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Research suite embedded in the canvas area (opaque overlay, canvas stays
 * mounted underneath — same contract as PreviewOverlay). The tool page ships
 * its own ToolShell, which drops its header/status bar in embedded mode; the
 * canvas tab strip (see CentralArea) carries the title and close affordance,
 * so no per-suite header is rendered here.
 */
function EmbeddedToolView({ toolId }: { toolId: string }) {
  const toolDef = getTool(toolId);
  // Project gate (mirrors the /studio route): project-bound tools must not
  // render their body without a project — several suites produce a blank
  // pane in that case instead of a usable empty state.
  const project = useProjectStore((s) => s.project);
  if (!toolDef) return null;
  if (toolDef.requireProject && !project) {
    return (
      <div className="central-tool-view">
        <div className="central-tool-view-body">
          <ToolShell toolId={toolId}>
            <EmptyProject />
          </ToolShell>
        </div>
      </div>
    );
  }
  const Page = toolDef.component;
  return (
    <div className="central-tool-view">
      <div className="central-tool-view-body">
        <Suspense
          fallback={
            <div className="central-tool-loading">
              <span className="spinner" />
            </div>
          }
        >
          <Page />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Unified plugin-canvas export control (single consolidation point for the
 * former per-plugin "Snapshot PNG" buttons): captures the foreground canvas
 * (2-D bitmap or 3-D scene snapshot) and either downloads it or writes it
 * into the project workspace `figures/` dir. 3-D viewports additionally get
 * transparent-background variants.
 */
function PluginExportMenu({
  canvasRef,
  scene3dRef,
  fullscreen,
  onToggleFullscreen,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  scene3dRef: React.RefObject<Scene3DHandle | null>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const activePluginName = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin?.manifest.name ?? null,
  );
  const [open, setOpen] = useState(false);
  // Probed when the menu opens: transparent variants exist only for a 3-D
  // viewport (`Scene3DHandle.snapshot({ transparent })` drops background +
  // reference furniture; the 2-D bitmap always carries its painted backdrop).
  const [is3d, setIs3d] = useState(false);

  // Close on outside click / Escape (same contract as the explorer menu).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** `<plugin-name>-20260101-120000` — collision-free, filesystem-safe. */
  const baseName = (): string => {
    const safe = (activePluginName ?? 'canvas').replace(/[^\w.-]+/g, '_').slice(0, 40);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${safe}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };

  /** Current frame as a PNG data URL: 3-D snapshot handle first, else the 2-D
   *  bitmap. `transparent` only affects the 3-D path. */
  const snapshotDataUrl = (transparent: boolean): string | null => {
    const three = scene3dRef.current;
    if (three?.isVisible()) {
      try {
        return three.snapshot(transparent ? { transparent: true } : undefined);
      } catch {
        return null;
      }
    }
    const canvas = canvasRef.current;
    if (!canvas) return null;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const grabPng = (transparent: boolean): Blob | null => {
    const url = snapshotDataUrl(transparent);
    return url ? dataUrlToBlob(url) : null;
  };

  const doDownload = (transparent: boolean) => {
    const blob = grabPng(transparent);
    if (!blob) {
      notify('warning', t('workbench.export.no_canvas'));
      return;
    }
    downloadBlob(`${baseName()}.png`, blob, 'image/png');
  };

  const doSaveWorkspace = async (transparent: boolean) => {
    if (!project) {
      notify('warning', t('workbench.export.no_project'));
      return;
    }
    try {
      const blob = grabPng(transparent);
      if (!blob) {
        notify('warning', t('workbench.export.no_canvas'));
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await saveBinaryArtifact(project, 'figures', `${baseName()}.png`, bytes);
      notify('success', t('workbench.export.saved', { path }));
    } catch (err) {
      logger.error('workbench', 'plugin canvas export failed', err);
      notify('error', t('workbench.export.failed'));
    }
  };

  /** True 1920×1080 re-render, independent of the on-screen viewport size.
   *  3-D: the scene handle re-renders off-size via its sized snapshot. 2-D:
   *  temporarily stretch the live canvas to 1920×1080 CSS px (plugins size
   *  their bitmap from clientWidth at draw start), force one synchronous
   *  re-render, let two frames flush, snapshot, then restore and re-render. */
  const grabPng1080 = async (): Promise<Blob | null> => {
    const three = scene3dRef.current;
    if (three?.isVisible()) {
      try {
        return dataUrlToBlob(three.snapshot({ width: 1920, height: 1080 }));
      } catch {
        return null;
      }
    }
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const prevStyle = canvas.getAttribute('style') ?? '';
    canvas.style.width = '1920px';
    canvas.style.height = '1080px';
    try {
      rerenderActivePlugin();
      // Two rAFs: first flushes layout + plugin draw, second guarantees the
      // bitmap blit is committed before toDataURL reads it back.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return dataUrlToBlob(canvas.toDataURL('image/png'));
    } catch {
      return null;
    } finally {
      canvas.setAttribute('style', prevStyle);
      rerenderActivePlugin();
    }
  };

  const doDownload1080 = async () => {
    const blob = await grabPng1080();
    if (!blob) {
      notify('warning', t('workbench.export.no_canvas'));
      return;
    }
    downloadBlob(`${baseName()}-1080p.png`, blob, 'image/png');
  };

  /** Encode the active 3-D scene as a downloadable model file. */
  const exportModel = async (format: 'glb' | 'stl', toWorkspace: boolean) => {
    const three = scene3dRef.current;
    if (!three?.isVisible()) {
      notify('warning', t('workbench.export.no_canvas'));
      return;
    }
    try {
      const bytes = new Uint8Array(await three.exportModel(format));
      const name = `${baseName()}.${format}`;
      if (toWorkspace) {
        if (!project) {
          notify('warning', t('workbench.export.no_project'));
          return;
        }
        const path = await saveBinaryArtifact(project, 'data', name, bytes);
        notify('success', t('workbench.export.saved', { path }));
      } else {
        const mime = format === 'glb' ? 'model/gltf-binary' : 'model/stl';
        downloadBlob(name, new Blob([bytes], { type: mime }), mime);
      }
    } catch (err) {
      logger.error('workbench', `3D model export (${format}) failed`, err);
      notify('error', t('workbench.export.failed'));
    }
  };

  const runAndClose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const menuBtn = (label: string, onClick: () => void, key: string) => (
    <button key={key} type="button" role="menuitem" className="central-export-item" onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="central-export" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="central-export-btn"
        title={fullscreen ? t('workbench.export.fullscreen_exit') : t('workbench.export.fullscreen')}
        aria-label={fullscreen ? t('workbench.export.fullscreen_exit') : t('workbench.export.fullscreen')}
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? <MinimizeIcon size={13} /> : <MaximizeIcon size={13} />}
        <span>{fullscreen ? t('workbench.export.fullscreen_exit') : t('workbench.export.fullscreen')}</span>
      </button>
      <button
        type="button"
        className="central-export-btn"
        title={t('workbench.export.menu')}
        aria-label={t('workbench.export.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setIs3d(!!scene3dRef.current?.isVisible());
          setOpen((o) => !o);
        }}
      >
        <DownloadIcon size={13} />
        <span>{t('workbench.export.menu')}</span>
      </button>
      {open && (
        <div className="central-export-menu" role="menu">
          {menuBtn(t('workbench.export.download_png'), runAndClose(() => doDownload(false)), 'dl')}
          {menuBtn(
            t('workbench.export.download_png_1080p'),
            runAndClose(() => void doDownload1080()),
            'dl1080',
          )}
          {menuBtn(
            t('workbench.export.save_workspace'),
            runAndClose(() => void doSaveWorkspace(false)),
            'ws',
          )}
          {is3d && (
            <>
              {menuBtn(
                t('workbench.export.download_png_transparent'),
                runAndClose(() => doDownload(true)),
                'dlt',
              )}
              {menuBtn(
                t('workbench.export.save_workspace_transparent'),
                runAndClose(() => void doSaveWorkspace(true)),
                'wst',
              )}
              {menuBtn(
                t('workbench.export.download_glb'),
                runAndClose(() => void exportModel('glb', false)),
                'glb',
              )}
              {menuBtn(
                t('workbench.export.download_stl'),
                runAndClose(() => void exportModel('stl', false)),
                'stl',
              )}
              {menuBtn(
                t('workbench.export.save_model'),
                runAndClose(() => void exportModel('glb', true)),
                'gws',
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function CentralArea() {
  const t = useT();
  // Immersive fullscreen: the fullscreen element is the canvas wrap itself —
  // the LEFT sidebar stays behind (immersion), but the RIGHT panel is
  // portaled in as a floating layer so it can still extend over the canvas
  // (both instances share the same zustand state; the non-fullscreen one is
  // simply not displayed by the browser). The existing ResizeObserver
  // re-renders the plugin at the new size automatically.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement != null,
  );
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const request =
      el.requestFullscreen ??
      (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen;
    void request?.call(el).catch(() => undefined);
  };
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const status = useAppStore((s) => s.status);
  // Plugin that started the in-flight computation (null = host-driven, e.g.
  // a project load). The overlay only masks the owning plugin's own viewport:
  // a background compute must never cover the plugin the user switched to.
  // `activeId` is selected further below (viewport-reset hook).
  const computingId = usePluginStore((s) => s.computingId);
  // Canvas tab strip (VS Code editor-area style): file previews opened from
  // the explorer and embedded research suites share one tab list. Every open
  // tab stays mounted — switching tabs only toggles visibility, so edit
  // buffers, scroll positions and tool state survive the switch.
  const canvasTabs = useAppStore((s) => s.canvasTabs);
  const activeTab = useAppStore((s) => s.activeTab);
  const mode = useAppStore((s) => s.mode);
  const filePreviews = useAppStore((s) => s.filePreviews);
  // Mode surfaces opened from a file are labelled with that file: one file is
  // one tab ("coupler.py"), not a preview tab plus a generic "代码" tab.
  const boundFilePath = useEditorStore(
    (s) => s.sessions.find((session) => session.id === s.activeSessionId)?.filePath ?? null,
  );
  const editorFiles = useAppStore((s) => s.editorFiles);
  const activateTab = useAppStore((s) => s.activateTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const saveEditorFile = useAppStore((s) => s.saveEditorFile);
  // Editor tab with unsaved edits pending a close confirmation (design doc
  // P5): key of the tab, null when no confirmation is active.
  const [confirmCloseKey, setConfirmCloseKey] = useState<string | null>(null);
  // Tab drag-reorder: source key while a native drag is in flight (ref —
  // read in dragover without re-rendering), and the tab currently hovered
  // as a drop target (state — drives the drop-target highlight).
  const dragTabKey = useRef<string | null>(null);
  const [dragOverTabKey, setDragOverTabKey] = useState<string | null>(null);
  // Tab strip panning: the scrollbar stays hidden, so the strip pans via
  // wheel (vertical delta → horizontal) and mouse drag; a small movement
  // threshold keeps tab clicks working while dragging pans the row. The
  // active tab also auto-scrolls into view when tabs switch or open.
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabStripCleanupRef = useRef<(() => void) | null>(null);
  const setTabStripEl = useCallback((el: HTMLDivElement | null) => {
    if (tabStripCleanupRef.current) {
      tabStripCleanupRef.current();
      tabStripCleanupRef.current = null;
    }
    tabStripRef.current = el;
    if (!el) return;
    let dragging = false;
    let moved = false;
    let suppressClick = false;
    let startX = 0;
    let startScroll = 0;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // A press on a tab starts a native HTML5 drag (tab reorder); capturing
      // the pointer for strip-panning would suppress that drag, so presses
      // landing on tabs are left to the drag driver (wheel still pans).
      if ((e.target as HTMLElement | null)?.closest?.('.central-tool-tab')) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };
    el.addEventListener('pointerdown', onPointerDown);
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-dragging');
      }
      if (moved) el.scrollLeft = startScroll - dx;
    };
    el.addEventListener('pointermove', onPointerMove);
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
      // A drag ending over a tab must not also activate it.
      suppressClick = moved;
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('click', onClickCapture, true);
    tabStripCleanupRef.current = () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);
  const showPluginCanvas = useAppStore((s) => s.showPluginCanvas);
  // Keep the active tab visible: switching tabs (or opening one beyond the
  // visible edge of the pannable strip) nudges the strip so it stays in view.
  useEffect(() => {
    const el = tabStripRef.current;
    if (!el || !activeTab) return;
    el.querySelector<HTMLElement>('.central-tool-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, canvasTabs.length]);
  // 插件画布标签：只要当前激活了插件、或本次会话曾激活过（切到文件/
  // 套件标签时插件会被自动停用以省资源），标签就常驻标签条，点击可
  // 恢复插件视图。真正卸载（uninstall）后 registry 中已无条目，标签消失。
  const lastActivePluginId = useAppStore((s) => s.lastActivePluginId);
  const pluginTabId = usePluginStore((s) => s.activeId) ?? lastActivePluginId;
  const pluginTabEntry = usePluginStore((s) =>
    pluginTabId ? (s.registry.find((e) => e.id === pluginTabId) ?? null) : null,
  );

  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Identity used to claim/release the shared plugin render host. */
  const hostOwnerRef = useRef({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scene3dRef = useRef<Scene3DHandle | null>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false);
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false);
  // Mirror of the viewport for rendering: the viewport store lives outside
  // React, so this state exists purely to surface a visible zoom badge /
  // reset affordance (invisible viewport state already caused two "render is
  // broken" reports — pan drift and accidental wheel shrink).
  const [vp2d, setVp2d] = useState<Viewport2D>({ x: 0, y: 0, scale: 1 });

  // File ingestion (drop → sniff → scientific import / plugin routing) lives
  // in its own hook so this component stays focused on the viewport.
  const { chooser, routeFile, loadIntoPlugin, closeChooser } = useFileRouting();

  // 2D viewport pan/zoom. The pan/zoom lives in a host-level viewport store and
  // is injected into the plugin's drawing through the canvas context transform
  // (re-applied on every canvas resize at the start of each draw), so the
  // frame stays put and the *content* moves — re-rendered from data on every
  // change, revealing content that was previously outside the frame. Rendering
  // is synchronous on input so the content tracks the cursor 1:1.
  const drag2d = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  // Touch multi-pointer state. One finger pans; two fingers pinch-zoom.
  // Without dedicated pinch handling the second finger's moves were read as
  // pan deltas against the first finger's origin, so the viewport flipped
  // between two far-apart offsets on every event (the tablet flicker) and
  // pinch could never zoom.
  const touchPoints = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  // Pan/zoom only makes sense on a bare 2D viewport: the 3D canvas is up
  // (OrbitControls owns the input there) and plugin DOM must keep its own
  // pointer interactions. The 2D canvas is pointer-events:none, so pointer
  // events on a 2D viewport land exactly on the dom-host root.
  const pan2dAllowed = (target: EventTarget | null) =>
    !scene3dRef.current?.isVisible() && target === domRef.current;

  // Clamp the drag so the frame can never be shifted fully out of view. At
  // scale 1 most plugins paint exactly the canvas area, and an unbounded pan
  // used to reveal a fully empty bitmap that read as "the render broke".
  // Reaching content a plugin draws beyond its frame needs slack, so the cap
  // is 2× the host size — enough for off-frame data, never empty-screenable.
  const clampPan = (x: number, y: number): { x: number; y: number } => {
    const host = wrapperRef.current;
    if (!host) return { x, y };
    const r = host.getBoundingClientRect();
    const maxX = r.width * 2;
    const maxY = r.height * 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan2dAllowed(e.target)) return;
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.current.size === 2) {
      // Second finger down: switch from pan to pinch-zoom.
      const [a, b] = [...touchPoints.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = {
        dist: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        cx: (a!.x + b!.x) / 2,
        cy: (a!.y + b!.y) / 2,
      };
      drag2d.current = null;
    } else if (touchPoints.current.size === 1) {
      const v = getViewport2d();
      drag2d.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: v.x,
        baseY: v.y,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const tracked = touchPoints.current.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }
    if (pinch.current && touchPoints.current.size >= 2) {
      // Pinch: scale around the finger midpoint and follow its translation.
      const [a, b] = [...touchPoints.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y));
      const cx = (a!.x + b!.x) / 2;
      const cy = (a!.y + b!.y) / 2;
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const v = getViewport2d();
        // Host-space midpoint before/after this move.
        const mx = pinch.current.cx - rect.left;
        const my = pinch.current.cy - rect.top;
        const nx = cx - rect.left;
        const ny = cy - rect.top;
        const next = Math.min(12, Math.max(0.1, v.scale * (dist / pinch.current.dist)));
        const k = next / v.scale;
        const p = clampPan(nx - (mx - v.x) * k + (nx - mx), ny - (my - v.y) * k + (ny - my));
        setViewport2d({ x: p.x, y: p.y, scale: next });
        setVp2d({ x: p.x, y: p.y, scale: next });
        rerenderActivePlugin();
      }
      pinch.current = { dist, cx, cy };
      return;
    }
    const drag = drag2d.current;
    if (drag) {
      const v = getViewport2d();
      const p = clampPan(
        drag.baseX + (e.clientX - drag.startX),
        drag.baseY + (e.clientY - drag.startY),
      );
      setViewport2d({ x: p.x, y: p.y, scale: v.scale });
      setVp2d({ x: p.x, y: p.y, scale: v.scale });
      rerenderActivePlugin();
    } else if (pan2dAllowed(e.target)) {
      e.currentTarget.style.cursor = 'grab';
    } else {
      e.currentTarget.style.cursor = '';
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const tracked = touchPoints.current.delete(e.pointerId);
    if (!tracked && !drag2d.current && !pinch.current) return;
    if (touchPoints.current.size >= 2) {
      // A third finger lifted; re-anchor the pinch on the remaining two.
      const [a, b] = [...touchPoints.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = {
        dist: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        cx: (a!.x + b!.x) / 2,
        cy: (a!.y + b!.y) / 2,
      };
      return;
    }
    pinch.current = null;
    if (touchPoints.current.size === 1) {
      // One finger left on the glass: resume panning from its position so the
      // view does not jump back to the stale single-finger drag origin.
      const [p] = [...touchPoints.current.values()] as [{ x: number; y: number }];
      const v = getViewport2d();
      drag2d.current = { startX: p!.x, startY: p!.y, baseX: v.x, baseY: v.y };
      return;
    }
    drag2d.current = null;
    e.currentTarget.style.cursor = '';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pan2dAllowed(e.target)) return;
    resetViewport2d();
    setVp2d({ x: 0, y: 0, scale: 1 });
    rerenderActivePlugin();
  };

  // Wheel is attached natively with passive:false so preventDefault works.
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (scene3dRef.current?.isVisible()) return;
      if (e.target !== domRef.current) return;
      // Plain wheel zooms around the cursor — the universal canvas gesture.
      // Ctrl/cmd+wheel (trackpad pinch arrives as ctrl+wheel) also works.
      // An accidental zoom is never "stuck": the badge offers one-click reset
      // and double-click resets too.
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = getViewport2d();
      const factor = Math.exp(-e.deltaY * 0.0012);
      const next = Math.min(12, Math.max(0.1, v.scale * factor));
      const k = next / v.scale;
      // Keep the point under the cursor stationary while zooming.
      const nextVp = {
        x: px - (px - v.x) * k,
        y: py - (py - v.y) * k,
        scale: next,
      };
      setViewport2d(nextVp);
      setVp2d(nextVp);
      rerenderActivePlugin();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  // Reset the viewport when the active plugin changes so pan/zoom never leaks
  // between plugins.
  const activeId = usePluginStore((s) => s.activeId);
  useEffect(() => {
    resetViewport2d();
    setVp2d({ x: 0, y: 0, scale: 1 });
    rerenderActivePlugin();
  }, [activeId]);

  useEffect(() => {
    if (activeTab !== null) return;
    if (!domRef.current || !canvasRef.current) return;
    // Inject the 2D viewport transform into the shared canvas context before
    // any plugin draws into it.
    wrapCanvas2d(canvasRef.current);
    const ensureThree = async (): Promise<Scene3DHandle | undefined> => {
      if (!domRef.current) return scene3dRef.current ?? undefined;
      if (!scene3dRef.current) {
        const mod = await loadScene3dModule();
        // Re-check after the await: the component may have unmounted (or a
        // concurrent ensure may already have created the handle).
        if (!scene3dRef.current && domRef.current) {
          scene3dRef.current = mod.createScene3D(domRef.current);
        }
      }
      return scene3dRef.current ?? undefined;
    };
    setHostContainers({
      dom: domRef.current,
      canvas2d: canvasRef.current,
      reportDataScale: (n) => useAppStore.getState().setDataScale(n),
      // Lazily create the 3D scene on first demand; cached for the session.
      getThree: () => {
        if (!scene3dRef.current && domRef.current) {
          void ensureThree();
        }
        return scene3dRef.current ?? undefined;
      },
      ensureThree,
      setThreeVisible: (visible) => {
        if (scene3dRef.current) scene3dRef.current.setVisible(visible);
      },
      clearCanvas2d: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        clearCanvas2dInViewport(canvas);
      },
    }, hostOwnerRef.current);
    // If a plugin is still active (e.g. CentralArea just remounted after a
    // block-mode toggle), redraw it into the fresh container elements. The
    // canvas must carry its final CSS size *before* that first draw — during
    // mount the element can still be mid-layout, and a draw that samples a
    // transient clientWidth allocates a mismatched bitmap that shows as a
    // briefly squashed frame until the next pan/resize redraw.
    if (canvasRef.current) {
      canvasRef.current.style.width = '100%';
      canvasRef.current.style.height = '100%';
    }
    rerenderActivePlugin();
    // One more redraw once layout has fully settled (double rAF: style flush
    // + layout), so the first stable frame always matches the real box.
    let settle = 0;
    settle = requestAnimationFrame(() => {
      settle = requestAnimationFrame(() => rerenderActivePlugin());
    });
    return () => {
      cancelAnimationFrame(settle);
      setHostContainers(null, hostOwnerRef.current);
      scene3dRef.current?.dispose();
      scene3dRef.current = null;
    };
  }, [activeTab]);

  useEffect(() => {
    if (!canvasRef.current) return;
    // 面板拖拽 / 窗口缩放会改变宿主尺寸：2D 画布的 CSS 尺寸跟着变，但
    // 位图仍是旧尺寸——若不重绘，旧位图会被拉伸变形（横向压扁/拉宽）。
    // 触发活动插件重绘即可：插件每次绘制都以 `canvas.width = clientWidth`
    // 重新分配位图并从数据重画（rAF 合并同帧的多次 RO 回调）。
    let raf = 0;
    const obs = new ResizeObserver(() => {
      if (canvasRef.current) {
        canvasRef.current.style.width = '100%';
        canvasRef.current.style.height = '100%';
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => rerenderActivePlugin());
    });
    obs.observe(canvasRef.current);
    return () => {
      obs.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await routeFile(file);
    }
  };

  const openProjectFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.clproj,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) {
        // An unparseable .clproj rejects inside openFromFile; without this the
        // failure was an unhandled rejection with no user-visible feedback
        // (every other open entry point already reports it).
        void useProjectStore
          .getState()
          .openFromFile(f)
          .catch((err: unknown) => {
            logger.error('project', 'open from file failed', err);
            useAppStore.getState().notify('error', t('project.open_failed'));
          });
      }
    };
    input.click();
  };

  return (
    <div className="central-wrap" ref={wrapRef}>
      <div
        className="central"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div
        ref={wrapperRef}
        className="central-plugin-host"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={onDoubleClick}
      >
        <div ref={domRef} className="central-dom-host" />
        <canvas ref={canvasRef} className="central-canvas" />
        {(status === 'computing' || status === 'loading') && activePlugin && (computingId === null || computingId === activeId) && (
          <div className="central-progress">
            <span className="spinner" />
            <span>{t(`status.${status}`)}</span>
          </div>
        )}
        {(vp2d.x !== 0 || vp2d.y !== 0 || vp2d.scale !== 1) && (
          <button
            type="button"
            className="central-zoom-badge"
            title={t('ux.view.reset')}
            aria-label={t('ux.view.reset')}
            onClick={() => {
              resetViewport2d();
              setVp2d({ x: 0, y: 0, scale: 1 });
              rerenderActivePlugin();
            }}
          >
            {Math.round(vp2d.scale * 100)}%
          </button>
        )}
        {/* Unified export control: only on the foreground plugin canvas —
            file/suite tabs cover it with an opaque overlay anyway. */}
        {activeTab === null && activePlugin && (
          <PluginExportMenu
            canvasRef={canvasRef}
            scene3dRef={scene3dRef}
            fullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        )}
        {/* Immersive fullscreen: floating instance of the right panel so it
            can extend over the canvas (state is shared with the docked one). */}
        {isFullscreen && wrapRef.current && createPortal(<RightPanel />, wrapRef.current)}
      </div>
      {/* 画布标签体系（VS Code 编辑区风格）：插件画布本身是第一个"标签"，
          文件预览与内嵌套件跟在后面。所有已打开的标签保持挂载，切换仅改
          可见性——编辑缓冲、滚动位置与套件状态在切换过程中全部保留。
          activeTab 为 null 即插件画布处于前台。 */}
      {(canvasTabs.length > 0 || pluginTabEntry) && (
        <div className="central-overlay-stack">
          <div
            ref={setTabStripEl}
            className="central-tool-tabs"
            role="tablist"
            aria-label={t('suite.tabs')}
            onKeyDown={(e) => {
              // Roving-tabindex tabs: Arrow keys move focus between tabs, and
              // Enter/Space activates the focused one. Without this the strip
              // was mouse-only — a keyboard user could never reach an open
              // file/suite tab.
              const tabs = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
              );
              const i = tabs.indexOf(document.activeElement as HTMLElement);
              if (i < 0) return;
              let next = -1;
              if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = tabs.length - 1;
              if (next >= 0) {
                e.preventDefault();
                tabs[next]?.focus();
                tabs[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }
            }}
          >
            {/* 插件画布标签：点击回到插件视图（不关闭其他标签）。插件被
                自动停用时标签仍然显示——点击会重新激活它。 */}
            {pluginTabEntry && (
              <div
                role="tab"
                aria-selected={activeTab === null && pluginTabEntry.id === activeId}
                tabIndex={activeTab === null && pluginTabEntry.id === activeId ? 0 : -1}
                className={`central-tool-tab plugin-tab${
                  activeTab === null && pluginTabEntry.id === activeId ? ' active' : ''
                }`}
                title={pluginTabEntry.name}
                onClick={() => showPluginCanvas()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showPluginCanvas();
                  }
                }}
              >
                <span className="central-tool-tab-icon" aria-hidden="true">
                  {pluginTabEntry.icon ?? '◈'}
                </span>
                <span className="central-tool-tab-name">{pluginTabEntry.name}</span>
              </div>
            )}
            {canvasTabs.map((tab) => {
              const active = tab.key === activeTab;
              const label =
                tab.kind === 'tool'
                  ? (() => {
                      const def = getTool(tab.id);
                      return def ? t(def.titleKey) : tab.id;
                    })()
                  : tab.kind === 'settings'
                    ? t('settings.title')
                    : tab.kind === 'editor'
                      ? (editorFiles[tab.key]?.name ?? tab.path)
                      : tab.kind === 'surface'
                        ? (tab.path?.split('/').pop() ??
                          (boundFilePath && tab.mode === mode
                            ? boundFilePath.split('/').pop()!
                            : t(`workbench.mode.${tab.mode}`)))
                        : (filePreviews[tab.key]?.name ?? tab.path);
              // Editor tabs surface unsaved edits with a dirty dot, and their
              // close button routes through the save/discard confirmation.
              const dirty = tab.kind === 'editor' && (editorFiles[tab.key]?.dirty ?? false);
              // Shared by the × button and middle-click close: pull any
              // debounced-but-unpushed edit into the store first, and route
              // dirty editors through the save/discard confirmation.
              const requestClose = () => {
                if (tab.kind === 'editor') flushEditorFile(tab.key);
                const nowDirty =
                  tab.kind === 'editor'
                    ? (useAppStore.getState().editorFiles[tab.key]?.dirty ?? false)
                    : false;
                if (nowDirty) {
                  setConfirmCloseKey(tab.key);
                  return;
                }
                closeTab(tab.key);
              };
              return (
                <div
                  key={tab.key}
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className={`central-tool-tab${active ? ' active' : ''}${
                    tab.kind === 'file' ? ' file-tab' : ''
                  }${tab.kind === 'editor' ? ' editor-tab' : ''}${
                    dragOverTabKey === tab.key && dragTabKey.current !== tab.key ? ' drop-target' : ''
                  }`}
                  title={label}
                  onClick={() => {
                    activateTab(tab.key);
                    // File-bound code surfaces share one mounted editor: move
                    // the active session to this tab's own file session.
                    syncSurfaceTabSession(tab);
                  }}
                  onAuxClick={(e) => {
                    // VS Code convention: middle-click closes the tab without
                    // activating it first.
                    if (e.button === 1) {
                      e.preventDefault();
                      requestClose();
                    }
                  }}
                  draggable
                  onDragStart={(e) => {
                    dragTabKey.current = tab.key;
                    // Required for Firefox to initiate the drag at all.
                    e.dataTransfer.setData('text/plain', tab.key);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    dragTabKey.current = null;
                    setDragOverTabKey(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragTabKey.current) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverTabKey !== tab.key) setDragOverTabKey(tab.key);
                  }}
                  onDragLeave={(e) => {
                    // Child elements (icon/name spans) fire dragleave while
                    // crossing; only clear when actually leaving the tab.
                    if (!e.currentTarget.contains(e.relatedTarget as Node) && dragOverTabKey === tab.key) {
                      setDragOverTabKey(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragTabKey.current;
                    dragTabKey.current = null;
                    setDragOverTabKey(null);
                    if (from && from !== tab.key) reorderTabs(from, tab.key);
                  }}
                  onKeyDown={(e) => {
                    // The tablist handler already handles arrows; here we only
                    // forward Enter/Space so the focused tab can be activated
                    // without a pointer (Space/Enter do not fire onClick on a
                    // non-button element).
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activateTab(tab.key);
                      syncSurfaceTabSession(tab);
                    }
                  }}
                >
                  {tab.kind === 'tool' &&
                    (() => {
                      const def = getTool(tab.id);
                      return def ? (
                        <span className="central-tool-tab-icon" aria-hidden="true">
                          <ToolIcon kind={def.icon} size={12} />
                        </span>
                      ) : null;
                    })()}
                  {tab.kind === 'settings' && (
                    <span className="central-tool-tab-icon" aria-hidden="true">
                      <SettingsIcon size={12} />
                    </span>
                  )}
                  {tab.kind === 'surface' && (
                    <span className="central-tool-tab-icon" aria-hidden="true">
                      <ModeIcon kind={tab.mode} />
                    </span>
                  )}
                  {dirty && <span className="central-editor-dirty-dot" aria-hidden="true" />}
                  <span className="central-tool-tab-name">{label}</span>
                  <button
                    type="button"
                    className="central-tool-tab-close"
                    aria-label={t('suite.close')}
                    title={t('suite.close')}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestClose();
                    }}
                  >
                    <CloseIcon size={10} />
                  </button>
                </div>
              );
            })}
          </div>
          {/* 所有标签的窗格保持挂载（display 切换），关闭标签才会卸载并
              回收其 blob URL——这是"切换保留状态"的关键。 */}
          {canvasTabs.map((tab) => (
            <div
              key={tab.key}
              className={`central-tab-pane${tab.key === activeTab ? '' : ' tab-hidden'}`}
            >
              {(() => {
                if (tab.kind === 'tool') return <EmbeddedToolView toolId={tab.id} />;
                if (tab.kind === 'settings')
                  return (
                    <Suspense fallback={null}>
                      <LazySettingsPage embedded />
                    </Suspense>
                  );
                if (tab.kind === 'editor') {
                  const Cmp =
                    tab.editor === 'code'
                      ? LazyCodeFileEditor
                      : tab.editor === 'block'
                        ? LazyBlockFileEditor
                        : LazyFlowFileEditor;
                  return (
                    <Suspense fallback={<PreviewLoading />}>
                      <Cmp path={tab.path} />
                    </Suspense>
                  );
                }
                if (tab.kind === 'surface') {
                  // Only the focused surface stays mounted: Blockly/Monaco
                  // each own an editor session, so keeping hidden surfaces
                  // alive would let them fight over the active IR.
                  if (tab.key !== activeTab) return null;
                  const Cmp =
                    tab.mode === 'flow'
                      ? LazyFlowSurface
                      : tab.mode === 'block'
                        ? LazyBlockSurface
                        : LazyCodeSurface;
                  return (
                    <Suspense fallback={<PreviewLoading />}>
                      <Cmp />
                    </Suspense>
                  );
                }
                const preview = filePreviews[tab.key];
                return preview ? <PreviewOverlay preview={preview} /> : null;
              })()}
            </div>
          ))}
        </div>
      )}
      {!activePlugin && (
        <div className="central-empty">
          {/* Viewfinder mark echoing the corner brackets of the canvas frame. */}
          <svg className="central-empty-mark" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M6 18 V6 H18" />
            <path d="M46 6 H58 V18" />
            <path d="M58 46 V58 H46" />
            <path d="M18 58 H6 V46" />
            <circle className="central-empty-mark-ring" cx="32" cy="32" r="11" />
            <circle className="central-empty-mark-core" cx="32" cy="32" r="2.6" />
          </svg>
          <h2 className="central-empty-title">{t('workbench.empty.title')}</h2>
          <p className="central-empty-subtitle">{t('workbench.empty.subtitle')}</p>
          <div className="central-empty-actions">
            <button type="button" className="btn" onClick={() => setPluginDialogOpen(true)}>
              {t('workbench.empty.load_plugin')}
            </button>
            <button type="button" className="btn" onClick={() => setExampleDialogOpen(true)}>
              {t('workbench.empty.example_data')}
            </button>
            <button type="button" className="btn" onClick={openProjectFile}>
              {t('workbench.empty.open_project')}
            </button>
          </div>
          <div className="central-empty-modes">
            <WorkbenchModeCards onMode={(m) => useModeConvert.getState().requestMode(m)} />
          </div>
          <div className="central-dropzone">{t('workbench.empty.drag_file')}</div>
          <p className="central-empty-tip">
            <kbd>Ctrl</kbd>+<kbd>S</kbd> {t('workbench.empty.tip_save')}
          </p>
        </div>
      )}

      {dragOver && (
        <div className="central-drop-hint">
          <svg className="central-drop-hint-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="M7 9l5-5 5 5" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          <span>{t('workbench.drag_hint')}</span>
        </div>
      )}

      <FileRouterDialog
        open={chooser.open}
        file={chooser.file}
        pluginIds={chooser.pluginIds}
        onClose={closeChooser}
        onPick={async (id) => {
          const file = chooser.file;
          if (file) await loadIntoPlugin(id, file);
          closeChooser();
        }}
      />

      <PluginDialog open={pluginDialogOpen} onClose={() => setPluginDialogOpen(false)} />
      <DataDialog open={exampleDialogOpen} onClose={() => setExampleDialogOpen(false)} />

      {/* Dirty editor close confirmation (design doc P5): save & close,
          discard, or cancel. Stays open if the save fails so nothing is lost. */}
      <Modal
        open={confirmCloseKey !== null}
        title={t('workbench.editor.dirty_title')}
        onClose={() => setConfirmCloseKey(null)}
        width={420}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmCloseKey(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (confirmCloseKey) closeTab(confirmCloseKey);
                setConfirmCloseKey(null);
              }}
            >
              {t('workbench.editor.discard')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!confirmCloseKey) return;
                const path = confirmCloseKey.slice('editor:'.length);
                void saveEditorFile(path).then((ok) => {
                  // Only close on a successful write — a failed save keeps
                  // the tab (and its buffer) intact.
                  if (ok) closeTab(confirmCloseKey);
                  setConfirmCloseKey(null);
                });
              }}
            >
              {t('workbench.editor.save_and_close')}
            </button>
          </>
        }
      >
        <p className="modal-message">{t('workbench.editor.dirty_message')}</p>
      </Modal>
      </div>
      {/* Science readout sits BELOW the viewfinder, in normal flow — the
          plugin host itself is position:absolute (out of flow), so keeping
          the strip inside `.central` made it the only flex child and it
          floated over the canvas (vertically centered, full-bleed). */}
      <ScienceOutputStrip />
    </div>
  );
}
