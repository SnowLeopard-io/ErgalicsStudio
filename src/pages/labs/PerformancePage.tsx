// ==========================================================================
// Ergalics Studio — Performance dashboard (research tool)
//
// Pulls together three previously scattered views of "where did the time go":
//   • live frame / memory counters from appStore (populated by perfMonitor);
//   • the recent GPU/CPU kernel sample ring from core/perf;
//   • the last Flow run's per-node build timings from blockStore.
// Everything is read-only except the explicit "clear kernel samples" action.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { useAppStore } from '@/stores/appStore';
import { useBlockStore } from '@/stores/blockStore';
import { blockRegistry } from '@/blocks/registry';
import { blockName } from '@/blocks/l10n';
import { clearKernelExecutions, kernelExecutions } from '@/core/perf';
import { formatBytes } from '@/core/storage';
import type { FlowBuildStepInfo } from '@/stores/blockStore';

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value * 100) / 100} ms`;
}

interface KernelAggregate {
  kernel: string;
  calls: number;
  totalMs: number;
  gpuMs: number;
  bytes: number;
}

export default function PerformancePage() {
  const t = useT();
  const { locale } = useLocale();
  const perf = useAppStore((s) => s.perf);
  const notify = useAppStore((s) => s.notify);
  const lastBuild = useBlockStore((s) => s.lastBuild);
  const buildSteps = useBlockStore((s) => s.buildSteps);
  const instances = useBlockStore((s) => s.instances);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // The kernel ring is module-level (intentionally not a store) — `tick` is a
  // deliberate poll trigger so the snapshot refreshes once a second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kernels = useMemo(() => kernelExecutions(), [tick]);
  const aggregates = useMemo(() => {
    const map = new Map<string, KernelAggregate>();
    for (const sample of kernels) {
      const entry = map.get(sample.kernel) ?? {
        kernel: sample.kernel, calls: 0, totalMs: 0, gpuMs: 0, bytes: 0,
      };
      entry.calls += 1;
      entry.totalMs += sample.durationMs;
      if (sample.engine === 'gpu') entry.gpuMs += sample.durationMs;
      entry.bytes += sample.memoryBytes;
      map.set(sample.kernel, entry);
    }
    return [...map.values()].sort((a, b) => b.totalMs - a.totalMs);
  }, [kernels]);

  const steps = useMemo(() => {
    const rows = Object.entries(buildSteps).map(([id, info]) => {
      const instance = instances.find((item) => item.id === id);
      const meta = instance ? blockRegistry.get(instance.blockId) : undefined;
      return { id, info: info as FlowBuildStepInfo, name: meta ? blockName(meta, locale) : id };
    });
    return rows.sort((a, b) => b.info.durationMs - a.info.durationMs);
  }, [buildSteps, instances, locale]);
  const maxStepMs = Math.max(1, ...steps.map((row) => row.info.durationMs));
  const maxKernelMs = Math.max(1, ...aggregates.map((row) => row.totalMs));
  const ran = lastBuild ? lastBuild.cached + lastBuild.computed : 0;
  const hitRate = lastBuild && ran > 0 ? Math.round((lastBuild.cached / ran) * 100) : 0;

  const liveCells = [
    [t('perfLab.fps'), String(perf.fps)],
    [t('perfLab.frame'), `${perf.frameMs} ms`],
    [t('perfLab.avg_fps'), String(perf.avgFps)],
    [t('perfLab.max_frame'), `${perf.maxFrameMs} ms`],
    [t('perfLab.frames'), perf.totalFrames.toLocaleString()],
    [t('perfLab.uptime'), t('perfLab.seconds', { n: perf.uptimeSec })],
    [t('perfLab.gpu_ms'), `${perf.gpuMs} ms`],
    [t('perfLab.js_heap'), `${perf.jsHeapMb} MB`],
    [t('perfLab.device_ram'), `${perf.deviceMemoryMb} MB`],
  ];

  return (
    <ToolShell toolId="performance">
      <div className="analysis-body">
        <div className="analysis-row">
          <button type="button" className="btn btn-primary" onClick={() => setTick((value) => value + 1)}>
            {t('perfLab.refresh')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={kernels.length === 0}
            onClick={() => {
              clearKernelExecutions();
              setTick((value) => value + 1);
              notify('success', t('perfLab.cleared'));
            }}
          >
            {t('perfLab.clear_samples')}
          </button>
        </div>

        <h4 className="share-section-title">{t('perfLab.live')}</h4>
        <div className="sweep-table-wrap">
          <table className="sweep-table">
            <tbody>
              {liveCells.map(([label, value]) => (
                <tr key={label}><th>{label}</th><td className="util-mono">{value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="share-section-title">{t('perfLab.build')}</h4>
        {!lastBuild || steps.length === 0 ? (
          <p className="analysis-note">{t('perfLab.build_none')}</p>
        ) : (
          <>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <tbody>
                  <tr><th>{t('perfLab.total')}</th><td className="util-mono">{ms(lastBuild.durationMs)}</td></tr>
                  <tr><th>{t('perfLab.hit_rate')}</th><td className="util-mono">{hitRate}%</td></tr>
                  <tr><th>{t('perfLab.plan')}</th><td className="util-mono">{lastBuild.planHash.slice(0, 12)}</td></tr>
                  <tr><th>{t('perfLab.environment')}</th><td className="util-mono">{lastBuild.environment.slice(0, 12)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="perf-timeline">
              {steps.map((row) => (
                <div key={row.id} className="perf-timeline-row">
                  <span className="perf-timeline-name">{row.name}</span>
                  <span className={`perf-timeline-bar is-${row.info.status}`}
                    style={{ width: `${Math.max(2, (row.info.durationMs / maxStepMs) * 100)}%` }}
                  />
                  <span className="util-mono perf-timeline-value">{ms(row.info.durationMs)}</span>
                  <span className="perf-timeline-status">{t(`blocks.build.node_${row.info.status}`)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <h4 className="share-section-title">{t('perfLab.kernels')}</h4>
        {aggregates.length === 0 ? (
          <p className="analysis-note">{t('perfLab.kernels_none')}</p>
        ) : (
          <>
            <div className="sweep-table-wrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('perfLab.kernel')}</th>
                    <th>{t('perfLab.duration')}</th>
                    <th>{t('perfLab.count')}</th>
                    <th>{t('perfLab.memory')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregates.map((row) => (
                    <tr key={row.kernel}>
                      <td>{row.kernel}</td>
                      <td className="util-mono">{ms(row.totalMs)}</td>
                      <td className="util-mono">{row.calls}</td>
                      <td className="util-mono">{formatBytes(row.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="perf-timeline">
              {aggregates.map((row) => (
                <div key={row.kernel} className="perf-timeline-row">
                  <span className="perf-timeline-name">{row.kernel}</span>
                  <span className="perf-timeline-bar is-kernel"
                    style={{ width: `${Math.max(2, (row.totalMs / maxKernelMs) * 100)}%` }}
                  />
                  <span className="util-mono perf-timeline-value">{ms(row.totalMs)}</span>
                  <span className="perf-timeline-status">
                    {row.gpuMs > 0 ? `${row.gpuMs.toFixed(1)} ms GPU` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}
