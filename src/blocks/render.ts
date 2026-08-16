// ==========================================================================
// Ergalics Studio — RenderedView → plugin bridge (block system)
//
// The only side-effectful step of the visualize path. A `viz.*` block emits
// a RenderedView (pure data); this module hands that handle to a plugin via
// the injected host, so the block system itself stays free of DOM/plugin
// coupling and the bridge is trivially testable.
// ==========================================================================

import type { RenderedView } from '@/types/datatable';
import type { Plugin } from '@/types/plugin';
import type { VizPayload } from './catalog/visualize';

export interface ViewRenderHost {
  /** Activate (or fetch) a plugin by id and return its instance, or null. */
  activate(pluginId: string): Promise<Plugin | null>;
}

export async function renderView(view: RenderedView, host: ViewRenderHost): Promise<void> {
  const payload = view.data as VizPayload | undefined;
  if (!payload?.pluginId) return;
  const plugin = await host.activate(payload.pluginId);
  if (!plugin?.loadData) return;
  const file = new File([payload.text], 'data.txt', { type: 'text/plain' });
  await plugin.loadData(file);
}
