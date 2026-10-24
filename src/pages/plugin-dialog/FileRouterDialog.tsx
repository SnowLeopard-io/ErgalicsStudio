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
    <Modal open={open} onClose={onClose} title={t('io.choose_plugin_title')} width={480}>
      <p>{file?.name}</p>
      <p className="empty-hint">{t('io.choose_plugin_hint')}</p>
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