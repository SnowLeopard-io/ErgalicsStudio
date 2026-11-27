// ==========================================================================
// Ergalics Studio — block-graph store injection (block system)
//
// The flow-mode components (canvas / palette / param editor) read the global
// blockStore by default. File-editor tabs (design doc P4) render the same
// components against a per-tab local store so a `.flow.json` buffer never
// touches the flow-mode graph: the tab wraps them in `GraphStoreProvider`
// and every component resolves its store through `useGraphStore`.
// ==========================================================================

import { createContext, useContext, type ReactNode } from 'react';
import { useBlockStore, type BlockGraphStoreApi } from '@/stores/blockStore';

const GraphStoreContext = createContext<BlockGraphStoreApi | null>(null);

/** Resolve the nearest provided graph store — defaults to the flow-mode
 *  singleton so existing call sites keep working without a provider. */
export function useGraphStore(): BlockGraphStoreApi {
  return useContext(GraphStoreContext) ?? useBlockStore;
}

/** Provider that scopes every child block component to `store`. */
export function GraphStoreProvider({
  store,
  children,
}: {
  store: BlockGraphStoreApi;
  children: ReactNode;
}) {
  return <GraphStoreContext.Provider value={store}>{children}</GraphStoreContext.Provider>;
}
