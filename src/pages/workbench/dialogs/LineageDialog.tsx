import { useEffect } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { LineageCanvas } from '@/components/LineageCanvas';
import { useLineageStore } from '@/stores/lineageStore';

interface LineageDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Data lineage viewer: files → runs → artifacts. Rebuilds on open and keeps
 * live-updating while a run finishes underneath (LINEAGE_CHANGED → version).
 */
export function LineageDialog({ open, onClose }: LineageDialogProps) {
  const t = useT();
  const graph = useLineageStore((s) => s.graph);
  const version = useLineageStore((s) => s.version);
  const loading = useLineageStore((s) => s.loading);
  const rebuild = useLineageStore((s) => s.rebuild);

  useEffect(() => {
    if (open) void rebuild();
  }, [open, rebuild]);

  return (
    <Modal open={open} onClose={onClose} title={t('lineage.title')} width={860}>
      <div className="lineage-dialog">
        {graph.nodes.length === 0 && !loading && <p className="lineage-empty">{t('lineage.empty')}</p>}
        {graph.nodes.length > 0 && (
          <>
            <div className="lineage-legend">
              <span className="lineage-legend-file">{t('lineage.legend_file')}</span>
              <span className="lineage-legend-run">{t('lineage.legend_run')}</span>
              <span className="lineage-legend-failed">{t('research.runs.failed')}</span>
              <span className="lineage-legend-meta">
                {t('lineage.files', { files: graph.nodes.filter((n) => n.kind === 'file').length })}
                {' · '}
                {t('lineage.runs', { runs: graph.nodes.filter((n) => n.kind === 'run').length })}
              </span>
            </div>
            <div className="lineage-scroll" key={version}>
              <LineageCanvas graph={graph} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
