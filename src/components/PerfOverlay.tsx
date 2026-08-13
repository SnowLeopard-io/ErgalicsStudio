import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';

export function PerfOverlay() {
  const t = useT();
  const perf = useAppStore((s) => s.perf);

  const { fps, frameMs, gpuMs, memoryMb, dataScale, warnings } = perf;

  const warningsList = [
    warnings.fps && t('perf.warning.fps'),
    warnings.memory && t('perf.warning.memory'),
    warnings.compute && t('perf.warning.compute'),
  ].filter(Boolean) as string[];

  return (
    <div className="perf-overlay" aria-label={t('workbench.perf.title')}>
      <div className="perf-row">
        <span>{t('workbench.perf.fps')}</span>
        <strong className={warnings.fps && fps > 0 ? 'perf-warn' : ''}>{fps}</strong>
      </div>
      <div className="perf-row">
        <span>{t('workbench.perf.frame')}</span>
        <strong>{frameMs} ms</strong>
      </div>
      <div className="perf-row">
        <span>{t('workbench.perf.gpu')}</span>
        <strong className={warnings.compute ? 'perf-warn' : ''}>{gpuMs} ms</strong>
      </div>
      <div className="perf-row">
        <span>{t('workbench.perf.memory')}</span>
        <strong className={warnings.memory ? 'perf-warn' : ''}>
          {memoryMb > 0 ? `${memoryMb} MB` : '—'}
        </strong>
      </div>
      <div className="perf-row">
        <span>{t('workbench.perf.data')}</span>
        <strong>{dataScale.toLocaleString()}</strong>
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