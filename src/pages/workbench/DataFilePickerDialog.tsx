// ==========================================================================
// Ergalics Studio — data file picker dialog (block mode source fields)
//
// Mounted once by the workbench. Blockly's custom `field_data_file` cannot
// render a React dialog, so it dispatches PICK_DATA_FILE_EVENT; this host
// answers with the shared two-column picker (project data / bundled
// examples) and writes the choice back through the request's `select`
// callback.
// ==========================================================================

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { DataFilePickerBody } from '@/components/DataFilePickerModal';
import { PICK_DATA_FILE_EVENT, type DataFilePickRequest } from '@/editor/block/data-file-picker';

export function DataFilePickerDialog() {
  const t = useT();
  const [request, setRequest] = useState<DataFilePickRequest | null>(null);

  useEffect(() => {
    const onPick = (event: Event) => {
      const detail = (event as CustomEvent<DataFilePickRequest>).detail;
      if (!detail) return;
      setRequest(detail);
    };
    window.addEventListener(PICK_DATA_FILE_EVENT, onPick);
    return () => window.removeEventListener(PICK_DATA_FILE_EVENT, onPick);
  }, []);

  return (
    <Modal
      open={request !== null}
      title={t('block.data_file.title')}
      onClose={() => setRequest(null)}
      width={680}
    >
      <DataFilePickerBody
        value={request?.value}
        onChoose={(name) => {
          request?.select(name);
          setRequest(null);
        }}
      />
    </Modal>
  );
}
