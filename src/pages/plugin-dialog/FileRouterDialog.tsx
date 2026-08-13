import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { pluginName } from '@/stores/pluginStore';

interface FileRouterDialogProps {
  open: boolean;
  file: File | null;
  pluginIds: string[];
  onClose: () => void;
  onPick: (pluginId: string) => void;
}

export function FileRouterDialog({ open, file, pluginIds, onClose, onPick }: FileRouterDialogProps) {
  const t = useT();

  return (
    <Modal open={open} onClose={onClose} title={t('error.file_unsupported')} width={480}>
      <p>{file?.name} — {t('error.file_unsupported')}</p>
      <p className="empty-hint">{t('plugin.loaded_list')}</p>
      <div className="file-router-options">
        {pluginIds.map((id) => (
          <button key={id} type="button" className="btn btn-block" onClick={() => onPick(id)}>
            {pluginName(id)}
          </button>
        ))}
      </div>
    </Modal>
  );
}