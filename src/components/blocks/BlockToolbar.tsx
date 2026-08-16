// ==========================================================================
// Ergalics Studio — block canvas toolbar (block system)
//
// Run / clear controls plus an inline diagnostics strip so compile and
// runtime errors are visible instead of failing silently.
// ==========================================================================

import { useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';

export function BlockToolbar() {
  const t = useT();
  const run = useBlockStore((s) => s.run);
  const isRunning = useBlockStore((s) => s.isRunning);
  const clear = useBlockStore((s) => s.clear);
  const count = useBlockStore((s) => s.instances.length);
  const compileDiagnostics = useBlockStore((s) => s.compileDiagnostics);
  const executionErrors = useBlockStore((s) => s.executionErrors);

  const compileErrors = compileDiagnostics.filter((d) => d.severity === 'error');
  const runErrors = Object.entries(executionErrors);

  return (
    <div className="block-toolbar-wrap">
      <div className="block-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={isRunning || count === 0}
          onClick={() => void run()}
        >
          {isRunning ? t('blocks.running') : t('blocks.run')}
        </button>
        <button type="button" className="btn" disabled={count === 0} onClick={clear}>
          {t('blocks.clear')}
        </button>
      </div>

      {(compileErrors.length > 0 || runErrors.length > 0) && (
        <div className="block-diagnostics">
          {compileErrors.map((d, i) => (
            <div key={`c${i}`} className="block-diagnostic">
              {t('blocks.compile_error', {
                nodeId: d.nodeId ? `（${d.nodeId}）` : '',
                message: d.message,
              })}
            </div>
          ))}
          {runErrors.map(([nodeId, msg]) => (
            <div key={nodeId} className="block-diagnostic">
              {t('blocks.run_error', { nodeId, message: msg })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
