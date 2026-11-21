// ==========================================================================
// Ergalics Studio — shared file-manager floating window shell
//
// One shell for every "manage project files" surface (data files, industrial
// engineering files): same Modal chrome, same width, same close footer and
// the same `.project-files` body layout. Domains only supply toolbar, warning
// banners and the two-column FilePickerPanel as children, so the windows can
// never drift apart in style or behaviour again.
// ==========================================================================

import type { HTMLAttributes, ReactNode } from 'react';
import { useT } from '@/i18n';
import { Modal } from './Modal';

interface FilesManagerModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Modal width in px (default 920 — shared by all file windows). */
  width?: number;
  /** Body classes, e.g. `project-files data-file-manager` or a drag state. */
  bodyClassName?: string;
  /** Spread onto the body div (drag handlers, …). */
  bodyProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

export function FilesManagerModal({
  open,
  title,
  onClose,
  width = 920,
  bodyClassName = 'project-files',
  bodyProps,
  children,
}: FilesManagerModalProps) {
  const t = useT();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className={bodyClassName} {...bodyProps}>
        {children}
      </div>
    </Modal>
  );
}
