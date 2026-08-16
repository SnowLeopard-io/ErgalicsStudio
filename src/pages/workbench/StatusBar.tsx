import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
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

  const statusKey: Record<string, string> = {
    ready: 'status.ready',
    computing: 'status.computing',
    paused: 'status.paused',
    loading: 'status.loading',
    saving: 'status.saving',
    error: 'status.error',
  };

  const leftText =
    projectStatus === 'saved'
      ? t('project.saved')
      : projectStatus === 'saving'
        ? t('status.saving')
        : t(statusKey[status] ?? 'status.ready');

  return (
    <footer className="statusbar">
      <div className="statusbar-left">{leftText}</div>
      <div className="statusbar-center">
        <span className={`gpu-chip${gpuActive ? ' gpu-active' : ''}`}>
          {gpu.name} · {gpu.available ? 'WebGPU' : 'CPU'}
          {gpuActive && perf.gpuMs > 0 ? ` · ${perf.gpuMs.toFixed(1)} ms` : ''}
        </span>
        <span>{perf.fps} FPS</span>
      </div>
      <div className="statusbar-right">
        {activePlugin ? <span>{activePlugin.name}</span> : <span>{t('workbench.right.no_plugin')}</span>}
      </div>
    </footer>
  );
}