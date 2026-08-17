import { useEffect, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore } from '@/stores/pluginStore';
import { getGpuBackend, subscribeGpu, type GpuBackend } from '@/core/gpu';

function formatBytesMiB(mb: number): string {
  if (mb <= 0) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GiB`;
  return `${mb} MB`;
}

function formatUptime(sec: number): string {
  if (sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function PerfOverlay() {
  const t = useT();
  const { locale } = useLocale();
  const perf = useAppStore((s) => s.perf);
  const mode = useAppStore((s) => s.mode);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);
  const [gpu, setGpu] = useState<GpuBackend>(() => getGpuBackend());

  // Reflect late GPU init (device request resolves after the dialog opens).
  useEffect(() => subscribeGpu(() => setGpu(getGpuBackend())), []);

  const {
    fps,
    frameMs,
    gpuMs,
    memoryMb,
    dataScale,
    jsHeapMb,
    deviceMemoryMb,
    totalFrames,
    avgFps,
    maxFrameMs,
    uptimeSec,
    warnings,
  } = perf;

  const warningsList = [
    warnings.fps && t('perf.warning.fps'),
    warnings.memory && t('perf.warning.memory'),
    warnings.compute && t('perf.warning.compute'),
  ].filter(Boolean) as string[];

  const activeEntry = registry.find((e) => e.id === activeId) ?? null;
  const activeName = activeEntry?.nameI18n?.[locale] ?? activeEntry?.name;
  const gpuBackendLabel = gpu.available
    ? gpu.backend === 'wasm'
      ? 'WASM'
      : 'WebGPU'
    : gpu.fallback
      ? 'CPU'
      : '—';
  const gpuName = gpu.available && gpu.name ? gpu.name : '—';

  return (
    <div className="perf-overlay" aria-label={t('workbench.perf.title')}>
      <div className="perf-grid">
        <section className="perf-section">
          <h4 className="perf-section-title">{t('workbench.perf.section.perf')}</h4>
          <div className="perf-row">
            <span>{t('workbench.perf.fps')}</span>
            <strong className={warnings.fps && fps > 0 ? 'perf-warn' : ''}>{fps}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.avg_fps')}</span>
            <strong>{avgFps}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.frame')}</span>
            <strong>{frameMs} ms</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.max_frame')}</span>
            <strong>{maxFrameMs} ms</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.total_frames')}</span>
            <strong>{totalFrames.toLocaleString()}</strong>
          </div>
        </section>

        <section className="perf-section">
          <h4 className="perf-section-title">{t('workbench.perf.section.gpu')}</h4>
          <div className="perf-row">
            <span>{t('workbench.perf.backend')}</span>
            <strong>{gpuBackendLabel}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.device')}</span>
            <strong className="perf-value-ellipsis" title={gpuName}>{gpuName}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.gpu')}</span>
            <strong className={warnings.compute ? 'perf-warn' : ''}>{gpuMs} ms</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.memory')}</span>
            <strong className={warnings.memory ? 'perf-warn' : ''}>
              {memoryMb > 0 ? formatBytesMiB(memoryMb) : '—'}
            </strong>
          </div>
        </section>

        <section className="perf-section">
          <h4 className="perf-section-title">{t('workbench.perf.section.memory')}</h4>
          <div className="perf-row">
            <span>{t('workbench.perf.js_heap')}</span>
            <strong>{jsHeapMb > 0 ? formatBytesMiB(jsHeapMb) : '—'}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.device_ram')}</span>
            <strong>{deviceMemoryMb > 0 ? formatBytesMiB(deviceMemoryMb) : '—'}</strong>
          </div>
        </section>

        <section className="perf-section">
          <h4 className="perf-section-title">{t('workbench.perf.section.runtime')}</h4>
          <div className="perf-row">
            <span>{t('workbench.perf.uptime')}</span>
            <strong>{formatUptime(uptimeSec)}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.data')}</span>
            <strong>{dataScale.toLocaleString()}</strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.active_plugin')}</span>
            <strong className="perf-value-ellipsis" title={activeName ?? ''}>
              {activeName ?? t('workbench.perf.no_plugin')}
            </strong>
          </div>
          <div className="perf-row">
            <span>{t('workbench.perf.mode')}</span>
            <strong className="perf-value-cap">{t(`workbench.mode.${mode}`)}</strong>
          </div>
        </section>
      </div>

      {warningsList.length > 0 && (
        <div className="perf-warnings">
          {warningsList.map((w) => (
            <div key={w} className="perf-warning-badge">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
