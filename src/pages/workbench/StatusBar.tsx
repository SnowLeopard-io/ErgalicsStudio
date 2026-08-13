import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { getGpuBackend } from '@/core/gpu';

export function StatusBar() {
  const t = useT();
  const status = useAppStore((s) => s.status);
  const perf = useAppStore((s) => s.perf);
  const projectStatus = useProjectStore((s) => s.status);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);

  const gpu = getGpuBackend();
  const activePlugin = registry.find((e) => e.id === activeId);

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
        {gpu.name} · {gpu.available ? 'WebGPU' : 'CPU'} · {perf.fps} FPS
      </div>
      <div className="statusbar-right">
        {activePlugin ? <span>{activePlugin.name}</span> : <span>{t('workbench.right.no_plugin')}</span>}
      </div>
    </footer>
  );
}