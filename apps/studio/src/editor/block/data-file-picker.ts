// ==========================================================================
// Ergalics Studio — data-file picker bridge (block mode)
//
// A Blockly field cannot render a React dialog, and this module must stay
// free of Blockly/React imports so the workbench dialog can listen for the
// request without pulling the Blockly runtime into its bundle.
//
// The custom `field_data_file` dispatches PICK_DATA_FILE_EVENT on `window`;
// the workbench-mounted dialog answers by calling `select(name)`, which writes
// the name back into the field (and therefore into the IR via Blockly's own
// change event).
// ==========================================================================

/** Window event used to ask the workbench to show the data-file picker. */
export const PICK_DATA_FILE_EVENT = 'ergalics:pick-data-file';

export interface DataFilePickRequest {
  /** Current field value, highlighted in the dialog. */
  value: string;
  /** Called with the chosen file name; closes the dialog afterwards. */
  select: (name: string) => void;
}

/** Open the two-column data-file picker for a block field. */
export function requestDataFilePick(request: DataFilePickRequest): void {
  window.dispatchEvent(
    new CustomEvent<DataFilePickRequest>(PICK_DATA_FILE_EVENT, { detail: request }),
  );
}
