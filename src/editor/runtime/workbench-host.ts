// ==========================================================================
// Ergalics Studio — workbench studio runtime host (shared)
//
// Block mode and code mode (R / JavaScript) both execute the canonical IR
// through `interpret(program, studioApi)`. This module builds that StudioApi
// with the workbench's plugin bridge, data-file resolution and console/notify
// sinks, so every mode runs programs against exactly the same environment.
// ==========================================================================

import { renderView, type ViewRenderHost } from '@/blocks/render';
import { createStudioApi, type StudioApi } from '@/editor/runtime/studio-api';
import { resolveDataFile, listDataFiles } from '@/core/dataFiles';
import { usePluginStore, rerenderActivePlugin } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';

/** Build the StudioApi used by IR interpretation in block/code modes. */
export function createWorkbenchStudioApi(): StudioApi {
  const viewHost: ViewRenderHost = {
    activate: async (pluginId) => {
      const store = usePluginStore.getState();
      if (store.activeId !== pluginId) {
        await store.activate(pluginId);
      } else {
        // Already active — its cached container may point at a detached
        // canvas after a remount; rebind + redraw before loading data.
        rerenderActivePlugin();
      }
      return store.getActive();
    },
  };

  return createStudioApi({
    loadText: async (path) => {
      const text = resolveDataFile(path);
      if (text === undefined) {
        throw new Error(`file "${path}" not found (available: ${listDataFiles().join(', ')})`);
      }
      return text;
    },
    renderView: (view) => renderView(view, viewHost),
    notify: (kind, message) => useAppStore.getState().notify(kind, message),
    print: (text) => useEditorStore.getState().appendConsole({ stream: 'stdout', text }),
  });
}
