import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';

interface NamePromptDialogProps {
  open: boolean;
  title: string;
  message: string;
  initial: string;
  onClose: () => void;
  /** Async confirms get a `report` callback as second argument for live
   *  progress (git clone streams phase/loaded/total) — rendered as a hint
   *  line under the input while pending. Existing short-confirm callers
   *  simply ignore it. */
  onConfirm: (value: string, report: (status: string) => void) => void | Promise<void>;
}

export function NamePromptDialog({
  open,
  title,
  message,
  initial,
  onClose,
  onConfirm,
}: NamePromptDialogProps) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  /** Confirm is async (clone can run for tens of seconds): while pending the
   *  footer is locked and a spinner shows, otherwise the dialog looks dead. */
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    if (open) {
      setPending(false);
      setStatusText('');
      const raf = requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  const submit = () => {
    if (pending) return;
    const result = onConfirm(ref.current?.value ?? '', setStatusText);
    if (result && typeof result.then === 'function') {
      setPending(true);
      // Keep the last status line after settle: on failure the confirm
      // handler reports the error through `report`, and wiping it here
      // would leave the dialog looking like nothing happened.
      result.finally(() => setPending(false));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        // A running confirm must not be dismissed into a silent background
        // task — wait for it (or let it fail into the error toast).
        if (!pending) onClose();
      }}
      title={title}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose()} disabled={pending}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
            {pending && <span className="spinner" />}
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
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
        }}
      />
      {pending && statusText && <p className="git-panel-hint">{statusText}</p>}
    </Modal>
  );
}
