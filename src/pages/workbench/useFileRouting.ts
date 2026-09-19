import { useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, runTracked, refreshParamDefs } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import {
  detectFormats,
  matchesFormats,
  collectSupportedExtensions,
  detectScientificFormat,
  scientificFormatFromName,
  isSupportedDataFileName,
} from '@/core/fileFormat';
import {
  loadScientificData,
  toDataset,
  dataTableToCSV,
  sanitizeName,
  type RawVariable,
} from '@/core/io/scientific';
import { datasetToTable } from '@/types/datatable';
import { logger } from '@/core/logger';

export interface ChooserState {
  open: boolean;
  file: File | null;
  pluginIds: string[];
}

const CLOSED_CHOOSER: ChooserState = { open: false, file: null, pluginIds: [] };

const readHead = async (file: File, n = 512): Promise<Uint8Array | null> => {
  try {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf).subarray(0, n);
  } catch {
    return null;
  }
};

/**
 * File ingestion pipeline shared by the drop handler and future entry points:
 * magic-byte sniffing → scientific binary import (HDF5/Parquet/FITS/NetCDF/
 * Zarr) → plugin format matching, with an ambiguity chooser as the fallback.
 * Extracted from CentralArea so the viewport component stays focused on
 * pan/zoom/rendering and this logic can be unit-tested in isolation.
 */
export function useFileRouting() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const [chooser, setChooser] = useState<ChooserState>(CLOSED_CHOOSER);

  const closeChooser = () => setChooser(CLOSED_CHOOSER);

  /**
   * Activate a plugin and hand it a file, recording the import in the run
   * history. A throwing `loadData()` used to escape as an unhandled
   * rejection from the drop handler, leaving the user with no feedback.
   */
  const loadIntoPlugin = async (id: string, file: File) => {
    const pluginStore = usePluginStore.getState();
    if (pluginStore.activeId !== id) await pluginStore.activate(id);
    // Register the dropped file in the project's data-file list so the top
    // data area (TopBar count + ProjectFilesDialog) reflects the import.
    // Binary formats (.npz/.npy) cannot be stored as text FileEntry content,
    // so they stay unlisted and flow straight into the plugin.
    if (isSupportedDataFileName(file.name)) {
      try {
        const duplicate = useProjectStore
          .getState()
          .project?.data.files.some((f) => f.name === file.name);
        await useProjectStore.getState().addDataFile(file);
        if (duplicate) {
          // Drag-drop bypasses the project-files dialog, so its inline
          // duplicate banner can't show — use a toast instead.
          notify('warning', t('project.data_file_replaced', { name: file.name }));
        }
      } catch (err) {
        logger.warn('io', 'data file registration failed', err);
      }
    }
    try {
      await runTracked(
        {
          pluginId: id,
          kind: 'data-import',
          label: file.name,
          detail: { bytes: file.size, type: file.type || undefined },
        },
        async () => {
          await pluginStore.registry.find((e) => e.id === id)?.plugin?.loadData?.(file);
        },
      );
      // An import can change the parameter set itself (new select options,
      // new slider bounds) — tell the panel to re-read the definitions.
      refreshParamDefs(id);
    } catch (err) {
      logger.error('plugin', 'loadData failed', { id, file: file.name }, err);
      notify('error', t('plugin.load_failed'));
    }
  };

  const routeFile = async (file: File): Promise<void> => {
    // Scientific binary formats (HDF5/Parquet/FITS/NetCDF/Zarr) cannot flow
    // through the text-based plugin router. Parse them into variables, inject
    // each as a CSV project data file, and let the first one take the normal
    // Standard render path so the user sees the data immediately.
    const head = await readHead(file);
    const sciFmt = (head && detectScientificFormat(head)) ?? scientificFormatFromName(file.name);
    if (sciFmt) {
      try {
        const datasets = await loadScientificData(file);
        const loaded: { raw: RawVariable; table: ReturnType<typeof datasetToTable> }[] = [];
        for (const raw of datasets) {
          try {
            loaded.push({ raw, table: datasetToTable(toDataset(raw, raw.source)) });
          } catch (err) {
            logger.warn('io', `skipping non-flattenable variable "${raw.name}"`, err);
          }
        }
        if (loaded.length === 0) {
          notify('warning', t('io.no_numeric_variables'));
          return;
        }
        for (const { raw, table } of loaded) {
          await useProjectStore
            .getState()
            .addDataFile(new File([dataTableToCSV(table)], `${sanitizeName(raw.name)}.csv`, { type: 'text/csv' }));
        }
        notify('success', t('io.import_scientific_ok', { count: loaded.length, total: datasets.length }));
        // Re-route the first variable's CSV through the normal plugin pipeline.
        const first = loaded[0]!;
        await routeFile(
          new File([dataTableToCSV(first.table)], `${sanitizeName(first.raw.name)}.csv`, { type: 'text/csv' }),
        );
      } catch (err) {
        logger.error('io', 'scientific load failed', err);
        notify('error', t('io.parse_failed'));
      }
      return;
    }

    const detected = await detectFormats(file);
    const pluginStore = usePluginStore.getState();
    const matches = pluginStore
      .getFormats()
      .filter(({ formats }) => matchesFormats(detected, formats))
      .map(({ pluginId }) => pluginId);

    if (matches.length === 0) {
      const supported = collectSupportedExtensions(pluginStore.getFormats());
      useAppStore.getState().setBanner(
        `error.file_unsupported${supported.length ? `: ${supported.join(', ')}` : ''}`,
      );
      return;
    }
    if (matches.length === 1) {
      const id = matches[0] as string;
      await loadIntoPlugin(id, file);
      return;
    }
    setChooser({ open: true, file, pluginIds: matches });
  };

  return { chooser, routeFile, loadIntoPlugin, closeChooser };
}
