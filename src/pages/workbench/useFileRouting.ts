import { useState } from 'react';
import { useT } from '@/i18n';
import { usePluginStore, runTracked, refreshParamDefs } from '@/stores/pluginStore';
import { useProjectStore, getProjectRepoPath } from '@/stores/projectStore';
import { getVfs, safeVfsRelPath } from '@/core/vfs';
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
import { sha256Blob } from '@/core/result/hash';
import { setCurrentDataSource, setPluginDataSource } from '@/core/result/activeData';
import { isEngineeringExtension, isGeometryExtension } from '@/core/engineering';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { resolvePluginDataSchemas } from '@/core/data-schema/presets';
import { useDataEditorStore } from '@/stores/dataEditorStore';

interface ChooserState {
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
    // FR-1: fingerprint the bytes actually handed to the plugin. Binary/
    // plugin-native files bypass addDataFile entirely, so this is their only
    // provenance capture point; for text data files addDataFile records the
    // same file and this simply re-asserts it. Non-fatal on failure.
    try {
      const hash = await sha256Blob(file);
      const source = { name: file.name, hash, bytes: file.size };
      setCurrentDataSource(source);
      // Bind the fingerprint to the target plugin as well, so a second
      // plugin running on another dataset cannot inherit this file's hash.
      setPluginDataSource(id, source);
    } catch (err) {
      logger.warn('io', 'ingest sha256 failed', err);
    }
    // Register the dropped file so both import surfaces reflect it:
    //  - text data files → project data list (top-bar count + dialog) AND a
    //    workspace data/ mirror for the file explorer (addDataFile does both);
    //  - binary/plugin-native files (images, .npz, …) → a raw-bytes mirror in
    //    the workspace data/ folder only. They cannot join the data list,
    //    whose entries are text-parsed everywhere (chunk store, CSV preview,
    //    studio.load()), but anything dropped on the canvas must still land
    //    in the project's data folder.
    let registeredFileId: string | undefined;
    if (isSupportedDataFileName(file.name)) {
      try {
        const duplicate = useProjectStore
          .getState()
          .project?.data.files.some((f) => f.name === file.name);
        registeredFileId = (await useProjectStore.getState().addDataFile(file)) ?? undefined;
        if (duplicate) {
          // Drag-drop bypasses the project-files dialog, so its inline
          // duplicate banner can't show — use a toast instead.
          notify('warning', t('project.data_file_replaced', { name: file.name }));
        }
      } catch (err) {
        logger.warn('io', 'data file registration failed', err);
      }
    } else {
      try {
        const project = useProjectStore.getState().project;
        if (project) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await getVfs().writeFileBinary(
            getProjectRepoPath(project),
            safeVfsRelPath(`data/${file.name}`),
            bytes,
          );
          useAppStore.getState().bumpFileOps(); // refresh the sidebar explorer
        }
      } catch (err) {
        logger.warn('io', 'data/ binary mirror failed', err);
      }
    }
    const targetPlugin = usePluginStore.getState().registry.find((e) => e.id === id)?.plugin;
    const schemas = resolvePluginDataSchemas(targetPlugin?.manifest);
    if (targetPlugin && schemas.length > 0 && isSupportedDataFileName(file.name)) {
      const text = await file.text();
      await useDataEditorStore.getState().ingestForPlugin({
        pluginId: id,
        fileName: file.name,
        text,
        origin: registeredFileId ? 'project-file' : 'upload',
        fileId: registeredFileId,
      });
      return;
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
          await usePluginStore.getState().registry.find((e) => e.id === id)?.plugin?.loadData?.(file);
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
    // Industrial CAD/CAE files bypass the plugin router: they belong to the
    // engineering suite, whose neutral model drives every industrial tool.
    if (isEngineeringExtension(file.name)) {
      try {
        const study = await useEngineeringStore.getState().importFile(file);
        if (study) {
          const geometry = isGeometryExtension(file.name);
          useAppStore.getState().setMode('standard');
          useAppStore.getState().setEmbeddedTool(geometry ? 'geometry-import' : 'mesh-viewer');
          // Make the industrial tool list visible, not the research grid.
          useAppStore.getState().setSidebarView('industrial');
          notify('success', t('industrial.import'));
        } else {
          // A null study means the parser rejected the file: surface the
          // store's parse error instead of failing silently.
          notify('error', useEngineeringStore.getState().error ?? t('industrial.no_study'));
        }
      } catch (err) {
        logger.error('engineering', 'import failed', err);
        notify('error', useEngineeringStore.getState().error ?? t('industrial.no_study'));
      }
      return;
    }
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
