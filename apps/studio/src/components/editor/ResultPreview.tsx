// ==========================================================================
// Ergalics Studio — result preview surface (code / block modes)
//
// The preview used to live inside CodeEditor/BlockEditor. It now renders in
// the workbench's right sidebar so the editor area stays purely editing and
// the console dock keeps full width.
//
// This component owns the plugin host containers (2D canvas + DOM overlay) and
// re-binds them on mount, so switching modes/files never leaves a plugin
// pointing at a detached canvas.
// ==========================================================================

import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import { rerenderActivePlugin, setHostContainers } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';

export function ResultPreview() {
  const t = useT();
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Identity used to claim/release the shared plugin render host (the
   *  workbench canvas registers the same host while it is in front). */
  const hostOwnerRef = useRef({});

  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;
    setHostContainers(
      {
        dom: domRef.current,
        canvas2d: canvasRef.current,
        reportDataScale: (n) => useAppStore.getState().setDataScale(n),
        clearCanvas2d: () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        },
      },
      hostOwnerRef.current,
    );
    rerenderActivePlugin();
    // Capture the owner now: `hostOwnerRef.current` may point elsewhere by
    // the time the cleanup runs.
    const owner = hostOwnerRef.current;
    return () => setHostContainers(null, owner);
  }, []);

  return (
    <div className="block-editor-preview rp-result-preview">
      <div className="block-editor-preview-label">{t('editor.preview.title')}</div>
      <div ref={domRef} className="block-editor-preview-dom" />
      <canvas ref={canvasRef} className="block-editor-preview-canvas" />
    </div>
  );
}
