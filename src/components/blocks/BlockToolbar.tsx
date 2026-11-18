// ==========================================================================
// Ergalics Studio — block canvas toolbar (block system)
//
// Run / clear controls plus an inline diagnostics strip so compile and
// runtime errors are visible instead of failing silently.
// ==========================================================================

import { useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';
import type { FlowBuildStats } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { DownloadIcon } from '@/components/icons';
import { translateBlockError } from '@/blocks/errorL10n';

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Multi-line tooltip explaining where the numbers came from. */
function buildTitle(
  build: FlowBuildStats,
  t: ReturnType<typeof useT>,
): string {
  return [
    t('blocks.build.total', { total: build.total }),
    t('blocks.build.cached', { cached: build.cached }),
    t('blocks.build.computed', { computed: build.computed }),
    t('blocks.build.blocked', { count: build.blocked }),
    t('blocks.build.failed', { count: build.failed }),
    t('blocks.build.duration', { duration: formatDuration(build.durationMs) }),
    t('blocks.build.plan', { hash: build.planHash.slice(0, 16) }),
    t('blocks.build.environment', { hash: build.environment.slice(0, 16) }),
  ].join('\n');
}

export function BlockToolbar() {
  const t = useT();
  const run = useBlockStore((s) => s.run);
  const isRunning = useBlockStore((s) => s.isRunning);
  const clear = useBlockStore((s) => s.clear);
  const count = useBlockStore((s) => s.instances.length);
  const compileDiagnostics = useBlockStore((s) => s.compileDiagnostics);
  const executionErrors = useBlockStore((s) => s.executionErrors);
  const lastBuild = useBlockStore((s) => s.lastBuild);
  // `.flow.json` opened from the explorer binds this canvas to that file.
  const boundPath = useEditorStore(
    (s) => s.sessions.find((session) => session.id === s.activeSessionId)?.filePath ?? null,
  );

  const saveBoundFile = async () => {
    if (!boundPath) return;
    const payload = JSON.stringify(
      { version: 1, kind: 'ergalics-flow', graph: useBlockStore.getState().toJSON() },
      null,
      2,
    );
    await useAppStore.getState().saveWorkspaceFile(boundPath, payload);
  };

  const compileErrors = compileDiagnostics.filter((d) => d.severity === 'error');
  const runErrors = Object.entries(executionErrors);
  const ran = lastBuild ? lastBuild.cached + lastBuild.computed : 0;
  const hitRate =
    lastBuild && ran > 0 ? Math.round((lastBuild.cached / ran) * 100) : 0;

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
        {boundPath && (
          <button type="button" className="btn" onClick={() => void saveBoundFile()}>
            <DownloadIcon size={12} />
            {t('workbench.editor.save')}
          </button>
        )}
        {lastBuild && (
          <div
            className={`block-build-summary${hitRate === 100 ? ' is-all-hit' : ''}`}
            role="status"
            aria-live="polite"
            title={buildTitle(lastBuild, t)}
          >
            <span className="block-build-rate">
              {t('blocks.build.hit_rate', { rate: hitRate })}
            </span>
            <span className="block-build-counts">
              {t('blocks.build.summary', {
                cached: lastBuild.cached,
                computed: lastBuild.computed,
              })}
            </span>
          </div>
        )}
      </div>

      {(compileErrors.length > 0 || runErrors.length > 0) && (
        <div className="block-diagnostics">
          {compileErrors.map((d, i) => (
            <div key={`c${i}`} className="block-diagnostic">
              {t('blocks.compile_error', {
                nodeId: d.nodeId ? `（${d.nodeId}）` : '',
                message: translateBlockError(d.message, t),
              })}
            </div>
          ))}
          {runErrors.map(([nodeId, msg]) => (
            <div key={nodeId} className="block-diagnostic">
              {t('blocks.run_error', { nodeId, message: translateBlockError(msg, t) })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
