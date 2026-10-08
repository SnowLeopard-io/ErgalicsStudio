import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { useAppStore, type FilePreviewState } from '@/stores/appStore';
import { CloseIcon } from '@/components/icons';
import { logger } from '@/core/logger';
import { mdToHtml } from '@/core/notebook/notebook';
import { downloadBlob } from '@/core/download';
import { getGitAdapter } from '@/core/git';
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
import { ScienceOutputStrip } from '@/components/ScienceOutputStrip';
import { useFileRouting } from './useFileRouting';
import { WorkbenchModeCards } from '@/components/WorkbenchModes';

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const MD_VIEWS = ['edit', 'preview', 'split'] as const;
type MdView = (typeof MD_VIEWS)[number];

/**
 * File preview overlay (VS Code editor-area style). Renders by kind:
 * text → monospace `<pre>`; markdown → editable preview/split with save-back
 * to the working tree; image/pdf/video/audio → binary blob URL embed;
 * unknown → info placeholder + download. The canvas stays mounted underneath.
 */
function PreviewOverlay({
  preview,
  onClose,
}: {
  preview: FilePreviewState;
  onClose: () => void;
}) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const bumpFileOps = useAppStore((s) => s.bumpFileOps);

  const [view, setView] = useState<MdView>('preview');
  const [mdText, setMdText] = useState(preview.content ?? '');

  // Re-arm the draft + view whenever a different file is opened.
  useEffect(() => {
    setMdText(preview.content ?? '');
    setView('preview');
  }, [preview.path, preview.kind]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    try {
      await adapter.writeFile(repoPath, preview.path, mdText);
      notify('success', t('workbench.preview.saved'));
      bumpFileOps(); // let the explorer refresh its listings
    } catch {
      notify('error', t('workbench.preview.save_failed'));
    }
  };

  const downloadFile = async () => {
    if (!project) return;
    const adapter = getGitAdapter();
    const repoPath = getProjectRepoPath(project);
    try {
      const blob = preview.blobUrl
        ? await (await fetch(preview.blobUrl)).blob()
        : new Blob([(await adapter.readFileBinary(repoPath, preview.path)) as BlobPart], {
            type: preview.mimeType,
          });
      downloadBlob(preview.name, blob, preview.mimeType);
    } catch {
      notify('error', t('workbench.preview.download_failed'));
    }
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
            <button type="button" className="btn btn-sm central-md-save" onClick={() => void saveMarkdown()}>
              {t('workbench.preview.save')}
            </button>
          </div>
          <div className={`central-md-body mode-${view}`}>
            {(view === 'edit' || view === 'split') && (
              <textarea
                className="central-md-edit"
                value={mdText}
                spellCheck={false}
                onChange={(e) => setMdText(e.target.value)}
              />
            )}
            {(view === 'preview' || view === 'split') && (
              <div
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
          <img src={preview.blobUrl} alt={preview.name} />
        </div>
      );
      break;
    case 'pdf':
      body = (
        <div className="central-file-media">
          <iframe src={preview.blobUrl} title={preview.name} />
        </div>
      );
      break;
    case 'video':
      body = (
        <div className="central-file-media">
          <video src={preview.blobUrl} controls />
        </div>
      );
      break;
    case 'audio':
      body = (
        <div className="central-file-media">
          <audio src={preview.blobUrl} controls />
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

  return (
    <div className="central-file-preview">
      <header className="central-file-preview-tab">
        <span className="central-file-preview-name" title={preview.path}>
          {preview.name}
        </span>
        {preview.kind !== 'markdown' && (
          <span className="central-file-preview-readonly">{t('workbench.preview.readonly')}</span>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </header>
      {body}
    </div>
  );
}

export function CentralArea() {
  const t = useT();
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const status = useAppStore((s) => s.status);
  // Plugin that started the in-flight computation (null = host-driven, e.g.
  // a project load). The overlay only masks the owning plugin's own viewport:
  // a background compute must never cover the plugin the user switched to.
  // `activeId` is selected further below (viewport-reset hook).
  const computingId = usePluginStore((s) => s.computingId);
  // Explorer-driven read-only file preview: rendered as an opaque overlay over
  // the canvas (VS Code editor-area style). The plugin surface stays mounted
  // underneath, so closing the preview never re-initializes a scene.
  const filePreview = useAppStore((s) => s.filePreview);
  const setFilePreview = useAppStore((s) => s.setFilePreview);

  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const v = getViewport2d();
    drag2d.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: v.x,
      baseY: v.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    if (!drag2d.current) return;
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
    });
    // If a plugin is still active (e.g. CentralArea just remounted after a
    // block-mode toggle), redraw it into the fresh container elements.
    rerenderActivePlugin();
    return () => {
      setHostContainers(null);
      scene3dRef.current?.dispose();
      scene3dRef.current = null;
    };
  }, []);

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
    <div className="central-wrap">
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
      </div>
      {/* 文件预览浮层（来自文件资源管理器）：类似 VS Code 编辑区。
          盖在画布上方但画布保持挂载，关闭预览不触发场景重建。 */}
      {filePreview && (
        <PreviewOverlay
          key={filePreview.path}
          preview={filePreview}
          onClose={() => setFilePreview(null)}
        />
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
            <WorkbenchModeCards onMode={(m) => useAppStore.getState().setMode(m)} />
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
      </div>
      {/* Science readout sits BELOW the viewfinder, in normal flow — the
          plugin host itself is position:absolute (out of flow), so keeping
          the strip inside `.central` made it the only flex child and it
          floated over the canvas (vertically centered, full-bleed). */}
      <ScienceOutputStrip />
    </div>
  );
}
