import { Modal } from './Modal';
import { useT } from '@/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body message. May contain a highlighted target name via `name`. */
  message: string;
  /** Bold target appended after the message (file / project / record name). */
  name?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling for the confirm button (destructive actions). */
  danger?: boolean;
  width?: number;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Project-wide destructive-action confirmation. Every delete/clear action
 * must route through this dialog (UI design guide §0.4): one rule, one
 * look, ESC / focus-trap / scroll-lock inherited from <Modal>.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  name,
  confirmLabel,
  cancelLabel,
  danger = true,
  width = 420,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="confirm-dialog-message" style={{ margin: 0 }}>
        {message}
        {name ? <strong> {name}</strong> : null}
      </p>
    </Modal>
  );
}
