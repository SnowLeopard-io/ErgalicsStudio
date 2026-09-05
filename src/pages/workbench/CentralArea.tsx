import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, setHostContainers, rerenderActivePlugin } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { detectFormats, matchesFormats, collectSupportedExtensions, detectScientificFormat, scientificFormatFromName } from '@/core/fileFormat';
import { loadScientificData, toDataset, dataTableToCSV, sanitizeName, type RawVariable } from '@/core/io/scientific';
import { datasetToTable } from '@/types/datatable';
import { logger } from '@/core/logger';
import { createScene3D } from '@/core/scene3d';
import {
  getViewport2d,
  setViewport2d,
  resetViewport2d,
  wrapCanvas2d,
  clearCanvas2dInViewport,
} from '@/core/viewport2d';
import type { Scene3DHandle } from '@/types/plugin';
import { FileRouterDialog } from '../plugin-dialog/FileRouterDialog';
import { PluginDialog } from '../plugin-dialog/PluginDialog';
import { DataDialog } from './DataDialog';

interface ChooserState {
  open: boolean;
  file: File | null;
  pluginIds: string[];
}

export function CentralArea() {
  const t = useT();
  const activePlugin = usePluginStore(
    (s) => s.registry.find((e) => e.id === s.activeId)?.plugin ?? null,
  );
  const status = useAppStore((s) => s.status);
  const notify = useAppStore((s) => s.notify);

  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scene3dRef = useRef<Scene3DHandle | null>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [chooser, setChooser] = useState<ChooserState>({ open: false, file: null, pluginIds: [] });
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false);
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false);

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
      setViewport2d({
        x: drag.baseX + (e.clientX - drag.startX),
        y: drag.baseY + (e.clientY - drag.startY),
        scale: v.scale,
      });
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
    rerenderActivePlugin();
  };

  // Wheel is attached natively with passive:false so preventDefault works.
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (scene3dRef.current?.isVisible()) return;
      if (e.target !== domRef.current) return;
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
      setViewport2d({
        x: px - (px - v.x) * k,
        y: py - (py - v.y) * k,
        scale: next,
      });
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
    rerenderActivePlugin();
  }, [activeId]);

  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;
    // Inject the 2D viewport transform into the shared canvas context before
    // any plugin draws into it.
    wrapCanvas2d(canvasRef.current);
    setHostContainers({
      dom: domRef.current,
      canvas2d: canvasRef.current,
      reportDataScale: (n) => useAppStore.getState().setDataScale(n),
      // Lazily create the 3D scene on first demand; cached for the session.
      getThree: () => {
        if (!scene3dRef.current && domRef.current) {
          scene3dRef.current = createScene3D(domRef.current);
        }
        return scene3dRef.current ?? undefined;
      },
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
    const obs = new ResizeObserver(() => {
      if (canvasRef.current) {
        canvasRef.current.style.width = '100%';
        canvasRef.current.style.height = '100%';
      }
    });
    obs.observe(canvasRef.current);
    return () => obs.disconnect();
  }, []);

  const readHead = async (file: File, n = 512): Promise<Uint8Array | null> => {
    try {
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf).subarray(0, n);
    } catch {
      return null;
    }
  };

  const routeFile = async (file: File) => {
    // Scientific binary formats (HDF5/Parquet/FITS/NetCDF/Zarr) cannot flow
    // through the text-based plugin router. Parse them into variables, inject
    // each as a CSV project data file, and let the first one take the normal
    // Standard render path so the user sees the data immediately.
    const head = await readHead(file);
    const sciFmt = (head && detectScientificFormat(head)) ?? scientificFormatFromName(file.name);
    if (sciFmt) {
      try {
        const datasets = await loadScientificData(file);
        const loaded: { raw: RawVariable; table: ReturnType<typeof datasetToTable> }[] = [];
        for (const raw of datasets) {
          try {
            loaded.push({ raw, table: datasetToTable(toDataset(raw, raw.source)) });
          } catch (err) {
            logger.warn('io', `skipping non-flattenable variable "${raw.name}"`, err);
          }
        }
        if (loaded.length === 0) {
          notify('warning', '文件中没有可预览为表格的数值变量');
          return;
        }
        for (const { raw, table } of loaded) {
          await useProjectStore
            .getState()
            .addDataFile(new File([dataTableToCSV(table)], `${sanitizeName(raw.name)}.csv`, { type: 'text/csv' }));
        }
        notify('success', `已导入 ${loaded.length} 个科学数据变量（共 ${datasets.length} 个）`);
        // Re-route the first variable's CSV through the normal plugin pipeline.
        const first = loaded[0]!;
        await routeFile(
          new File([dataTableToCSV(first.table)], `${sanitizeName(first.raw.name)}.csv`, { type: 'text/csv' }),
        );
      } catch (err) {
        logger.error('io', 'scientific load failed', err);
        notify('error', '科学数据解析失败，请确认文件格式是否正确');
      }
      return;
    }

    const detected = await detectFormats(file);
    const pluginStore = usePluginStore.getState();
    const matches = pluginStore
      .getFormats()
      .filter(({ formats }) => matchesFormats(detected, formats))
      .map(({ pluginId }) => pluginId);

    if (matches.length === 0) {
      const supported = collectSupportedExtensions(pluginStore.getFormats());
      useAppStore.getState().setBanner(
        `error.file_unsupported${supported.length ? `: ${supported.join(', ')}` : ''}`,
      );
      return;
    }
    if (matches.length === 1) {
      const id = matches[0] as string;
      const pluginStore2 = usePluginStore.getState();
      if (usePluginStore.getState().activeId !== id) await pluginStore2.activate(id);
      await pluginStore2.registry.find((e) => e.id === id)?.plugin?.loadData?.(file);
      return;
    }
    setChooser({ open: true, file, pluginIds: matches });
  };

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
            notify('error', t('project.open_failed'));
          });
      }
    };
    input.click();
  };

  return (
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
        {(status === 'computing' || status === 'loading') && activePlugin && (
          <div className="central-progress">
            <span className="spinner" />
            <span>{t(`status.${status}`)}</span>
          </div>
        )}
      </div>
      {!activePlugin && (
        <div className="central-empty">
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
          <div className="central-dropzone">{t('workbench.empty.drag_file')}</div>
        </div>
      )}

      {dragOver && <div className="central-drop-hint">{t('workbench.drag_hint')}</div>}

      <FileRouterDialog
        open={chooser.open}
        file={chooser.file}
        pluginIds={chooser.pluginIds}
        onClose={() => setChooser({ open: false, file: null, pluginIds: [] })}
        onPick={async (id) => {
          const file = chooser.file;
          if (file) {
            const store = usePluginStore.getState();
            if (usePluginStore.getState().activeId !== id) await store.activate(id);
            await store.registry.find((e) => e.id === id)?.plugin?.loadData?.(file);
          }
          setChooser({ open: false, file: null, pluginIds: [] });
        }}
      />

      <PluginDialog open={pluginDialogOpen} onClose={() => setPluginDialogOpen(false)} />
      <DataDialog open={exampleDialogOpen} onClose={() => setExampleDialogOpen(false)} />
    </div>
  );
}