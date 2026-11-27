// ==========================================================================
// Ergalics Studio — surface toolbar portal
//
// Renders a code / block surface's run-save-status toolbar into the workbench
// right sidebar (see stores/surfaceChromeStore.ts) so the central area holds
// nothing but the canvas. Without a registered host — the sidebar is collapsed
// or this surface is rendered outside the workbench — the toolbar renders in
// place so its controls never disappear.
// ==========================================================================

import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useSurfaceChrome } from '@/stores/surfaceChromeStore';

export function SurfaceToolbar({ children }: { children: ReactNode }) {
  const host = useSurfaceChrome((s) => s.host);
  return host ? createPortal(children, host) : <>{children}</>;
}
