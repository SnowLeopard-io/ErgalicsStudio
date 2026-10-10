import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useBlockStore } from '@/stores/blockStore';
import { getGpuBackend } from '@/core/gpu';
import { subscribeGpuActivity } from '@/core/compute';

export function StatusBar() {
  const t = useT();
  const status = useAppStore((s) => s.status);
  const perf = useAppStore((s) => s.perf);
  const projectStatus = useProjectStore((s) => s.status);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);

  const gpu = getGpuBackend();
  const activePlugin = registry.find((e) => e.id === activeId);

  // Transient "GPU is computing right now" pulse. Driven by real device
  // dispatches (subscribeGpuActivity), not by the reportGpuTime metric which
  // also fires for CPU fallback — so the chip lights up exactly when a kernel
  // is submitted to the device, even for sub-millisecond bursts.
  const [gpuActive, setGpuActive] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeGpuActivity(() => {
      setGpuActive(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setGpuActive(false), 1200);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Inline performance popover anchored above the center cluster.
  const [perfOpen, setPerfOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!perfOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPerfOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPerfOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [perfOpen]);

  const lowFps = perf.fps > 0 && perf.fps < 30;
  const highGpu = perf.gpuMs > 16;
  const highMemory =
    perf.deviceMemoryMb > 0 && perf.memoryMb > 0.85 * perf.deviceMemoryMb;
  const perfWarnings = (lowFps ? 1 : 0) + (highGpu ? 1 : 0) + (highMemory ? 1 : 0);

  const statusKey: Record<string, string> = {
    ready: 'status.ready',
    computing: 'status.computing',
    paused: 'status.paused',
    loading: 'status.loading',
    saving: 'status.saving',
    error: 'status.error',
  };

  const leftText =
    // EG3-111: a failed save used to fall through to the host status ("Ready"),
    // silently hiding data that only lives in memory. Render it explicitly.
    projectStatus === 'error'
      ? t('project.save_failed')
      : projectStatus === 'saved'
        ? t('project.saved')
        : projectStatus === 'saving'
          ? t('status.saving')
          : t(statusKey[status] ?? 'status.ready');

  // Long-running task indicator: visible while the host computes, loads or
  // saves. The cancel button is capability-aware: it only appears when the
  // plugin that started the in-flight computation registered an `api.onCancel`
  // handler (nbody, EM eigensolver, …). Plain loads/saves and computes in
  // plugins without cancellation support show the progress bar alone — an
  // unconditional button would promise a cancel that cannot happen.
  const canCancel = usePluginStore((s) => s.canCancelActive);
  const busy = status === 'computing' || status === 'loading' || projectStatus === 'saving';
  const busyLabel = projectStatus === 'saving'
    ? t('ux.progress.saving')
    : status === 'loading'
      ? t('ux.progress.loading')
      : t('ux.progress.computing');

  const cancelTask = () => {
    useBlockStore.getState().stop();
    usePluginStore.getState().cancelActiveTask?.();
  };

  return (
    <footer className="statusbar">
      <div className={`statusbar-left${projectStatus === 'error' ? ' statusbar-error' : ''}`}>{leftText}</div>
      <div className="statusbar-center">
        {busy ? (
          <div className="statusbar-progress" role="status" aria-label={busyLabel}>
            <span className="statusbar-progress-label">{busyLabel}</span>
            <span className="statusbar-progress-track">
              <span className="statusbar-progress-bar" />
            </span>
            {canCancel ? (
              <button type="button" className="statusbar-progress-cancel" onClick={cancelTask}>
                {t('ux.progress.cancel')}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <button
              type="button"
              className={`gpu-chip statusbar-btn${gpuActive ? ' gpu-active' : ''}`}
              title={t('ux.perf.title')}
              aria-label={t('ux.perf.title')}
              aria-expanded={perfOpen}
              onClick={() => setPerfOpen((v) => !v)}
            >
              {gpu.name} · {gpu.available ? 'WebGPU' : 'CPU'}
              {gpuActive && perf.gpuMs > 0 ? ` · ${perf.gpuMs.toFixed(1)} ms` : ''}
            </button>
            <button
              type="button"
              className={`statusbar-btn statusbar-fps${lowFps ? ' is-warn' : ''}`}
              title={t('ux.perf.title')}
              aria-label={t('ux.perf.title')}
              aria-expanded={perfOpen}
              onClick={() => setPerfOpen((v) => !v)}
            >
              {perf.fps} FPS
            </button>
          </>
        )}
      </div>
      <div className="statusbar-right">
        {activePlugin ? <span>{activePlugin.name}</span> : <span>{t('workbench.right.no_plugin')}</span>}
      </div>

      {perfOpen && !busy && (
        <div className="statusbar-popover" ref={popoverRef} role="dialog" aria-label={t('ux.perf.title')}>
          <div className="statusbar-popover-title">{t('ux.perf.title')}</div>
          <dl className="statusbar-popover-grid">
            <dt>{t('ux.perf.fps')}</dt>
            <dd className={lowFps ? 'is-warn' : ''}>
              {perf.fps.toFixed(0)} <span className="statusbar-popover-unit">fps</span>
              {lowFps && <span className="statusbar-popover-warn">{t('ux.perf.warn_fps')}</span>}
            </dd>
            <dt>{t('ux.perf.gpu')}</dt>
            <dd className={highGpu ? 'is-warn' : ''}>
              {perf.gpuMs.toFixed(1)} <span className="statusbar-popover-unit">ms</span>
              {highGpu && <span className="statusbar-popover-warn">{t('ux.perf.warn_compute')}</span>}
            </dd>
            <dt>{t('ux.perf.memory')}</dt>
            <dd className={highMemory ? 'is-warn' : ''}>
              {perf.memoryMb.toFixed(0)} <span className="statusbar-popover-unit">MB</span>
              {highMemory && <span className="statusbar-popover-warn">{t('ux.perf.warn_memory')}</span>}
            </dd>
            <dt>{t('ux.perf.jsheap')}</dt>
            <dd>
              {perf.jsHeapMb.toFixed(0)} <span className="statusbar-popover-unit">MB</span>
            </dd>
          </dl>
          {perfWarnings > 0 && (
            <div className="statusbar-popover-footer is-warn">
              {perfWarnings} {t('ux.perf.issues')}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}
