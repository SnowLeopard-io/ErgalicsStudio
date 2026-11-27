// ==========================================================================
// Ergalics Studio — Host IoC Bridge Registration
//
// Wires the workstation's stores and host services into `@ergalics/plugin-sdk`
// bridges at startup (and in test setup). Keeping this wiring in one place
// guarantees `packages/plugins` and `packages/sci-kernels` never import host
// stores, i18n, ambience, pyodide, or theme modules directly.
// ==========================================================================

import {
  setChartPaletteProvider,
  setFigureSheetHost,
  setHostAudioBridge,
  setPythonRuntimeBridge,
} from '@ergalics/plugin-sdk/bridges';
import { getLocale } from '@/i18n';
import { useFigureStore } from '@/stores/figureStore';
import { setHostAudioActive, setHostAudioPluginOpen } from '@/core/ambience/audio';
import { assertPythonRuntimeAssets } from '@/core/pyodide/preflight';
import {
  pythonRuntimeBegin,
  pythonRuntimeCancel,
  pythonRuntimeFail,
  pythonRuntimeReady,
  registerPythonRuntimeRetry,
} from '@/core/pyodide/runtime-status';
import { chartColorAt } from '@/core/theme-pack/apply';

let registered = false;

export function registerPluginBridges(): void {
  if (registered) return;
  registered = true;

  setFigureSheetHost({
    getActiveSheetId: () => useFigureStore.getState().activeSheetId,
    getLocale: () => getLocale(),
    createSheet: (title) => useFigureStore.getState().createSheet(title),
    addPanel: (sheetId, spec, placement) => useFigureStore.getState().addPanel(sheetId, spec, placement),
    updateSheet: (sheetId, patch) => useFigureStore.getState().updateSheet(sheetId, patch),
  });

  setHostAudioBridge({
    setHostAudioPluginOpen,
    setHostAudioActive,
  });

  setPythonRuntimeBridge({
    assertPythonRuntimeAssets,
    begin: pythonRuntimeBegin,
    ready: pythonRuntimeReady,
    cancel: pythonRuntimeCancel,
    fail: pythonRuntimeFail,
    registerRetry: registerPythonRuntimeRetry,
  });

  setChartPaletteProvider(chartColorAt);
}
