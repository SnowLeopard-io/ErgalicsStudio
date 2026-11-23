// ==========================================================================
// Ergalics Studio — Dual-Mode Online Data Editor Shell (Docked / Modal)
//
// Mounts the shared TabularDataEditor / TextDataEditor lazily (keeping `zod`
// and Monaco JSON workers out of the first-screen bundle):
//  - `DataEditorDock` renders inside CentralArea below ScienceOutputStrip as
//    a drag-resizable bottom drawer (default for plugin live-sync editing).
//  - `DataEditorModalHost` renders inside WorkbenchPage as a 980px floating
//    Modal (default when opened from the global Data modal, or when the user
//    clicks "Expand" from the dock).
// Switching between docked and modal preserves all unsaved draft edits.
// ==========================================================================

import { lazy, Suspense, useRef, type PointerEvent } from 'react';
import { useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useDataEditorStore, type DataEditorSession } from '@/stores/dataEditorStore';

const LazyTabularDataEditor = lazy(() =>
  import('./TabularDataEditor').then((m) => ({ default: m.TabularDataEditor })),
);
const LazyTextDataEditor = lazy(() =>
  import('./TextDataEditor').then((m) => ({ default: m.TextDataEditor })),
);

function isTabularSession(session: DataEditorSession): boolean {
  if (session.schema) return session.schema.kind === 'tabular';
  const lower = session.fileName.toLowerCase();
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    lower.endsWith('.tab') ||
    lower.endsWith('.dat')
  );
}

function EditorBody({ session }: { session: DataEditorSession }) {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  return (
    <Suspense
      fallback={
        <div className="pds-editor-loading">
          <span className="spinner" />
          <span>{zh ? '正在加载在线数据编辑器…' : 'Loading data editor…'}</span>
        </div>
      }
    >
      {isTabularSession(session) ? (
        <LazyTabularDataEditor session={session} />
      ) : (
        <LazyTextDataEditor session={session} />
      )}
    </Suspense>
  );
}

/** Docked bottom drawer mounted in CentralArea right below ScienceOutputStrip. */
export function DataEditorDock() {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const session = useDataEditorStore((s) => s.editorSession);
  const dockHeight = useDataEditorStore((s) => s.dockHeight);
  const setDockHeight = useDataEditorStore((s) => s.setDockHeight);
  const setEditorLayout = useDataEditorStore((s) => s.setEditorLayout);
  const setEditorLiveSync = useDataEditorStore((s) => s.setEditorLiveSync);
  const closeEditor = useDataEditorStore((s) => s.closeEditor);

  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  if (!session || session.layout !== 'docked') return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { y: e.clientY, h: dockHeight };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dy = dragStartRef.current.y - e.clientY;
    setDockHeight(dragStartRef.current.h + dy);
  };
  const onPointerUp = () => {
    dragStartRef.current = null;
  };

  return (
    <section
      className="pds-dock"
      style={{ height: dockHeight }}
      aria-label={zh ? '在线数据编辑器' : 'Online Data Editor'}
    >
      <div
        className="pds-dock-resize"
        role="separator"
        aria-orientation="horizontal"
        title={zh ? '拖拽调整高度' : 'Drag to resize'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="pds-dock-head">
        <div className="pds-dock-title">
          <span className="pds-card-dot" aria-hidden="true" />
          <strong>{zh ? '在线数据编辑器' : 'Data Editor'}</strong>
          <span className="pds-dock-file">{session.fileName}</span>
          {session.schema && (
            <span className="tag tag-muted">
              {session.schema.titleI18n?.[locale] ?? session.schema.title}
            </span>
          )}
        </div>
        <div className="pds-dock-controls">
          {session.pluginId && (
            <label className="pds-livesync-toggle" title={zh ? '修改单元格 300ms 后自动刷新画布' : 'Auto-refresh canvas 300ms after valid edits'}>
              <input
                type="checkbox"
                checked={session.liveSync}
                onChange={(e) => setEditorLiveSync(e.target.checked)}
              />
              <span>{zh ? '实时联动' : 'Live Sync'}</span>
            </label>
          )}
          <button
            type="button"
            className="btn btn-xs"
            title={zh ? '展开为大浮窗' : 'Expand to Modal'}
            onClick={() => setEditorLayout('modal')}
          >
            ⤢ {zh ? '展开浮窗' : 'Expand'}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={zh ? '关闭编辑器' : 'Close editor'}
            onClick={closeEditor}
          >
            ×
          </button>
        </div>
      </div>
      <div className="pds-dock-body">
        <EditorBody session={session} />
      </div>
    </section>
  );
}

/** Floating modal variant mounted in WorkbenchPage. */
export function DataEditorModalHost() {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const session = useDataEditorStore((s) => s.editorSession);
  const setEditorLayout = useDataEditorStore((s) => s.setEditorLayout);
  const setEditorLiveSync = useDataEditorStore((s) => s.setEditorLiveSync);
  const closeEditor = useDataEditorStore((s) => s.closeEditor);

  if (!session || session.layout !== 'modal') return null;

  return (
    <Modal
      open
      onClose={closeEditor}
      title={`${zh ? '在线数据编辑器' : 'Online Data Editor'} · ${session.fileName}`}
      width={980}
    >
      <div className="pds-modal-editor-wrap">
        <div className="pds-modal-editor-bar">
          <div className="pds-dock-title">
            {session.schema && (
              <span className="tag tag-muted">
                {session.schema.titleI18n?.[locale] ?? session.schema.title}
              </span>
            )}
          </div>
          <div className="pds-dock-controls">
            {session.pluginId && (
              <>
                <label className="pds-livesync-toggle">
                  <input
                    type="checkbox"
                    checked={session.liveSync}
                    onChange={(e) => setEditorLiveSync(e.target.checked)}
                  />
                  <span>{zh ? '实时联动' : 'Live Sync'}</span>
                </label>
                <button
                  type="button"
                  className="btn btn-xs"
                  title={zh ? '停靠到画布底部边改边看' : 'Dock below canvas'}
                  onClick={() => setEditorLayout('docked')}
                >
                  ⤡ {zh ? '停靠底部' : 'Dock Bottom'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="pds-modal-editor-body">
          <EditorBody session={session} />
        </div>
      </div>
    </Modal>
  );
}
