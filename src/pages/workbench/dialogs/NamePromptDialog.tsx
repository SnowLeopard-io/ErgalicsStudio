import { useEffect, useRef } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';

interface NamePromptDialogProps {
  open: boolean;
  title: string;
  message: string;
  initial: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export function NamePromptDialog({ open, title, message, initial, onClose, onConfirm }: NamePromptDialogProps) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
    }
  }, [open]);

  const submit = () => {
    void onConfirm(ref.current?.value ?? '');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {t('common.confirm')}
          </button>
        </>
      }
    >
      <label className="field-label">{message}</label>
      <input
        ref={ref}
        className="input"
        defaultValue={initial}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
    </Modal>
  );
}