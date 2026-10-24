// ==========================================================================
// Ergalics Studio — performance dashboard dialog (性能看板弹窗)
//
// The perf monitor lives in the top bar; clicking the entry opens this
// dialog with the full live metric grid (see PerfOverlay).
// ==========================================================================

import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { PerfOverlay } from '@/components/PerfOverlay';

interface PerfDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PerfDialog({ open, onClose }: PerfDialogProps) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workbench.perf.title')}
      width={560}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="perf-dialog">
        <PerfOverlay />
      </div>
    </Modal>
  );
}
